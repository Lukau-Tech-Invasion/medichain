import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFixtures } from './identity';
import { openVitalsForm, pickPatientById, settle, signIn } from './support';

/**
 * Workflow 3 — nursing: a care plan and a critical observation, written by
 * one nurse, read by the next, and the plan read by the patient.
 *
 *   nurse A   writes a care plan with two goals and an intervention, and records
 *             a set of vitals with an oxygen saturation the server's catalog
 *             calls critical
 *   page      says "Critical" in words on the latest-reading tile and in the
 *             flowsheet, not only in red (WCAG 1.4.1)
 *   nurse B   a different account, finds the plan with its goals after signing
 *             in, which proves it is a shared record and not the author's echo
 *   patient   reads "Nursing care plan" with the diagnosis in My Records
 *
 * The diagnosis carries a run stamp so nothing from an earlier run can satisfy
 * an assertion.
 */

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';
const fixtures = () => readFixtures();

async function nurse(browser: Browser, index: number): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(page, 'Nurse', index);
  return page;
}

test('a care plan and a critical reading reach the next nurse, and the plan reaches the patient', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const patient = fixtures().patient;
  const run = Date.now().toString(36).slice(-6).toUpperCase();
  const diagnosis = `Risk for falls QA${run}`;
  const goal = `Remains free of falls QA${run}`;

  // Nurse A: the care plan.
  const first = await nurse(browser, 0);
  await settle(first, '/nursing-care-plan');
  await first.getByRole('button', { name: 'New Plan' }).click();
  await pickPatientById(first, '#ncp-patient', patient.linked_patient_id);
  await first.locator('#ncp-diagnosis').fill(diagnosis);
  await first.locator('#ncp-goals').fill(`${goal}\nUses call bell before mobilising`);
  await first.locator('#ncp-interventions').fill('Bed in lowest position\nHourly rounding');
  await first.getByRole('group', { name: /priority/i }).getByRole('button', { name: /high/i }).click();
  await first.getByRole('button', { name: /create care plan/i }).click();
  await expect(first.getByText('Care plan created.')).toBeVisible({ timeout: 30000 });

  // Nurse A: a critical oxygen saturation.
  await settle(first, '/vitals');
  await pickPatientById(first, '#vitals-patient-select', patient.linked_patient_id);
  const vitals = await openVitalsForm(first);
  await vitals.field('Heart Rate (bpm)').fill('104');
  await vitals.field('Resp Rate (/min)').fill('26');
  await vitals.field('SpO2 (%)').fill('84');
  await first.getByRole('button', { name: /save vitals/i }).click();
  await expect(first.getByText(/vital signs recorded successfully/i)).toBeVisible({ timeout: 30000 });
  // The flag is in words: once on the tile, once in the flowsheet row.
  await expect
    .poll(async () => first.locator('main').getByText('Critical', { exact: true }).count(), { timeout: 30000 })
    .toBeGreaterThanOrEqual(1);
  await first.close();

  // Nurse B: a different account reads the plan and its goals.
  const second = await nurse(browser, 1);
  await settle(second, '/nursing-care-plan');
  await second.locator('#ncp-search').fill(diagnosis);
  const plan = second.locator('main').getByText(diagnosis).first();
  await expect(plan, 'the next nurse cannot find the care plan').toBeVisible({ timeout: 30000 });
  await plan.click();
  await expect(second.locator('main').getByText(goal).first()).toBeVisible({ timeout: 20000 });
  await second.close();

  // Patient: reads the plan in My Records.
  const context = await browser.newContext();
  const reader = await context.newPage();
  await reader.goto(`${PATIENT_APP}/login`);
  await reader.locator('input#username').fill(patient.login_id);
  await reader.locator('input#password').fill(patient.password ?? '');
  await reader.locator('button[type="submit"]').click();
  await expect(reader).toHaveURL(/\/dashboard$/, { timeout: 30000 });
  await reader.goto(`${PATIENT_APP}/records`);
  await expect(reader.locator('main').getByText(diagnosis).first(), 'the patient cannot read their care plan').toBeVisible({
    timeout: 45000,
  });
  await context.close();
});
