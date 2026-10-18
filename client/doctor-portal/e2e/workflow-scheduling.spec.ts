import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFixtures } from './identity';
import { pickPatientById, settle, signIn } from './support';

/**
 * Workflow 7 — scheduling: an appointment proposed by the clinic is
 * confirmed by the patient, checked in, started and completed; a second is
 * recorded as missed only after the clinician confirms it.
 *
 *   doctor    books two appointments for later today
 *   patient   confirms both in the patient app (a booking is a proposal until
 *             the other party agrees, and the server refuses to skip that step)
 *   doctor    checks the first in, starts and completes it; marks the second a
 *             no-show, which asks first (it used to happen on a single click)
 *   patient   reads one as Completed and the other as Missed
 *
 * Real two-party audio/video telehealth is out of scope here: the QA stack has
 * no telehealth provider configured, and the API refuses honestly
 * (`TELEHEALTH_UNAVAILABLE`). That remains a release gate against the real
 * provider.
 */

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';
const fixtures = () => readFixtures();

function laterToday(minutesAhead: number): { date: string; time: string } {
  const now = new Date();
  let at = new Date(now.getTime() + minutesAhead * 60_000);
  // Past midnight would land on tomorrow, outside the Today tab: stay on today.
  if (at.getDate() !== now.getDate()) {
    at = new Date(now);
    at.setHours(23, 30, 0, 0);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

async function book(page: Page, patientId: string, reason: string, minutesAhead: number) {
  await page.getByRole('button', { name: /new appointment/i }).first().click();
  await pickPatientById(page, '#patient_id', patientId);
  await page.locator('#appointment_type').selectOption('consultation');
  await page.locator('#reason').fill(reason);
  // A slot an earlier run already took is refused (409, the double-booking
  // guard); move along the day rather than calling that a failure.
  const booked = page.getByText('Appointment booked!');
  // A toast from the previous booking would read as this one's success.
  await expect(booked).toHaveCount(0, { timeout: 30000 });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const when = laterToday(minutesAhead + attempt * 37);
    await page.locator('#preferred_date').fill(when.date);
    await page.locator('#preferred_time').fill(when.time);
    await page.getByRole('button', { name: /^book appointment$/i }).click();
    const ok = await booked.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    if (ok) return;
    // Refused: let the error toast clear before trying the next slot.
    await page.waitForTimeout(1000);
  }
  await expect(booked, 'no free slot was found for the booking').toBeVisible();
}

async function patientApp(browser: Browser): Promise<Page> {
  const patient = fixtures().patient;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${PATIENT_APP}/login`);
  await page.locator('input#username').fill(patient.login_id);
  await page.locator('input#password').fill(patient.password ?? '');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30000 });
  await page.goto(`${PATIENT_APP}/appointments`);
  return page;
}

function card(page: Page, reason: string) {
  return page.locator('main div').filter({ hasText: reason }).filter({ has: page.getByRole('button') }).last();
}

test('an appointment is confirmed by the patient and completed; another is recorded as missed only on confirmation', async ({
  browser,
}) => {
  test.setTimeout(480_000);
  // Both visits must fall today (the Today tab drives the workflow), with room
  // for two non-overlapping 30-minute slots and a retry or two.
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  test.skip(midnight.getTime() - Date.now() < 75 * 60_000, 'too late in the day for two of today’s slots');
  const patient = fixtures().patient;
  const run = Date.now().toString(36).slice(-6).toUpperCase();
  const kept = `Follow-up review QA${run}`;
  const missed = `Blood pressure check QA${run}`;

  const doctor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // The second fixture doctor: each run books two of today's slots, and the
  // first doctor's evening fills up across repeated runs.
  await signIn(doctor, 'Doctor', 1);
  await settle(doctor, '/appointments');
  await book(doctor, patient.linked_patient_id, kept, 10);
  await book(doctor, patient.linked_patient_id, missed, 45);

  // The patient agrees to both.
  const reader = await patientApp(browser);
  for (const reason of [kept, missed]) {
    const row = card(reader, reason);
    await expect(row, `the patient does not see "${reason}"`).toBeVisible({ timeout: 30000 });
    await row.getByRole('button', { name: /^confirm$/i }).click();
    await expect(row.getByRole('button', { name: /^confirm$/i })).toHaveCount(0, { timeout: 30000 });
  }

  // The clinician runs the first visit through to completion.
  await doctor.reload();
  await doctor.getByRole('tab', { name: /today/i }).click();
  const visit = card(doctor, kept);
  for (const step of [/^check in$/i, /^start$/i, /^complete$/i]) {
    await expect(visit.getByRole('button', { name: step })).toBeVisible({ timeout: 30000 });
    await visit.getByRole('button', { name: step }).click();
  }

  // The second is a no-show, and the screen asks before recording it.
  const absent = card(doctor, missed);
  await absent.getByRole('button', { name: /^no show$/i }).click();
  const ask = doctor.getByRole('alertdialog').filter({ hasText: /did not attend/i });
  await expect(ask, 'a no-show was recorded without asking').toBeVisible({ timeout: 10000 });
  await ask.getByRole('button', { name: /cancel/i }).click();
  await expect(absent.getByRole('button', { name: /^no show$/i })).toBeVisible();
  await absent.getByRole('button', { name: /^no show$/i }).click();
  await doctor.getByRole('alertdialog').getByRole('button', { name: /^(confirm|ok|yes)$/i }).click();
  await doctor.close();

  // The patient reads both outcomes.
  // Both visits are over, so they are listed under Past, not Upcoming.
  await reader.reload();
  await reader.getByRole('button', { name: /^past/i }).first().click();
  await expect(reader.locator('main').getByText(kept).first()).toBeVisible({ timeout: 30000 });
  await expect(reader.locator('.patient-card').filter({ hasText: kept })).toContainText(/completed/i, {
    timeout: 30000,
  });
  await expect(reader.locator('.patient-card').filter({ hasText: missed })).toContainText(/missed/i, { timeout: 30000 });
  await reader.context().close();
});
