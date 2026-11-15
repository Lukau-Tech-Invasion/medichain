import { test, expect } from '@playwright/test';
import { readFixtures } from './identity';
import { pickPatientById, settle, signIn } from './support';

/**
 * Workflow 6 — surgical: an operative note is written once even when the
 * save is pressed twice, is read by another surgeon, and reaches the patient.
 *
 * `procedure-readback.spec.ts` covers intubation, splint and anaesthesia
 * read-back. This covers the operative note and the failure branches the ledger
 * names:
 *
 *   doctor A   is refused without both diagnoses (the difference between them
 *              is what the operation found), then saves; a second press while
 *              the first is in flight does not write a second note
 *   doctor B   a different account, finds exactly one note for this procedure
 *              in the patient's history
 *   patient    reads "Operative note" with the procedure in My Records
 */

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';
const fixtures = () => readFixtures();

test('an operative note is saved once, read by a colleague, and read by the patient', async ({ browser }) => {
  test.setTimeout(360_000);
  const patient = fixtures().patient;
  const run = Date.now().toString(36).slice(-6).toUpperCase();
  const procedure = `Laparoscopic appendicectomy QA${run}`;

  const first = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(first, 'Doctor', 0);
  await settle(first, '/operative-note');
  await pickPatientById(first, '#opnote-patient', patient.linked_patient_id);
  await first.locator('#opnote-procedure-name').fill(procedure);
  await first.locator('#opnote-pre-op-diagnosis').fill('Acute appendicitis');

  // Refused with one diagnosis: the message sits on the missing field.
  const save = first.getByRole('button', { name: /save operative note/i });
  await save.click();
  await expect(first.locator('#opnote-post-op-diagnosis')).toHaveAttribute('aria-invalid', 'true', { timeout: 10000 });

  await first.locator('#opnote-post-op-diagnosis').fill('Perforated appendicitis');
  // Two presses: the guard must hold the second while the first is in flight.
  await save.click();
  // Short timeout: once the first save lands the form gives way to History.
  await save.click({ force: true, timeout: 2000 }).catch(() => undefined);
  await expect(first.getByText('Operative note saved!')).toBeVisible({ timeout: 30000 });
  await first.close();

  // A colleague sees exactly one note for this procedure.
  const second = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(second, 'Doctor', 1);
  await settle(second, '/operative-note');
  await pickPatientById(second, '#opnote-patient', patient.linked_patient_id);
  await second.getByRole('button', { name: /^history$/i }).click();
  // One line per note names the procedure; the saved details repeat it, so
  // count the summary lines, not every mention.
  const notes = second.locator('main p').filter({ hasText: /^Procedure:/ }).filter({ hasText: procedure });
  await expect(notes.first(), 'the colleague cannot find the operative note').toBeVisible({ timeout: 30000 });
  expect(await notes.count(), 'a double press wrote the note twice').toBe(1);
  await second.close();

  // The patient reads it.
  const context = await browser.newContext();
  const reader = await context.newPage();
  await reader.goto(`${PATIENT_APP}/login`);
  await reader.locator('input#username').fill(patient.login_id);
  await reader.locator('input#password').fill(patient.password ?? '');
  await reader.locator('button[type="submit"]').click();
  await expect(reader).toHaveURL(/\/dashboard$/, { timeout: 30000 });
  await reader.goto(`${PATIENT_APP}/records`);
  await expect(reader.locator('main').getByText(procedure).first(), 'the patient cannot read the operative note').toBeVisible({
    timeout: 45000,
  });
  await context.close();
});
