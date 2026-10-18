import { test, expect } from '@playwright/test';
import { readFixtures } from './identity';
import { pickPatientById, settle, signIn } from './support';

/**
 * Workflow 4 — emergency: a resuscitation is run, finalised, reviewed by a
 * colleague and read by the patient.
 *
 * `emergency-read.spec.ts` and `emergency-capsule.spec.ts` cover break-glass
 * access and the capsule. This covers a protocol record:
 *
 *   doctor A   starts a code, logs a CPR cycle and a shock, stops it, and is
 *              not allowed to finalise until an outcome is chosen (it used to
 *              default to "ongoing" and store that as the finding)
 *   doctor B   a different account, finds the event in the patient's emergency
 *              protocol history
 *   patient    reads "Resuscitation (code blue)" in My Records (the code-blue
 *              list used to refuse the patient outright)
 */

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';
const fixtures = () => readFixtures();

test('a code blue is finalised with a chosen outcome, seen by a colleague, and read by the patient', async ({
  browser,
}) => {
  test.setTimeout(360_000);
  const patient = fixtures().patient;
  const run = Date.now().toString(36).slice(-6).toUpperCase();
  const location = `Ward QA${run}`;

  const first = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(first, 'Doctor', 0);
  await settle(first, '/code-blue');
  await pickPatientById(first, '#code-blue-patient', patient.linked_patient_id);
  await first.getByRole('button', { name: /start code/i }).click();
  await first.getByRole('button', { name: /cpr cycle/i }).click();
  await first.getByRole('button', { name: /shock/i }).first().click();
  await first.getByRole('button', { name: /stop code/i }).click();
  await first.locator('#code-blue-location').fill(location);

  const finalize = first.getByRole('button', { name: /finalize record/i });
  await expect(finalize, 'a record can be finalised with no outcome chosen').toBeDisabled();
  await first.locator('#code-blue-outcome').selectOption('rosc');
  await expect(finalize).toBeEnabled();
  await finalize.click();
  await expect(first).toHaveURL(/\/dashboard/, { timeout: 30000 });
  await first.close();

  // A colleague reads it in the patient's protocol history.
  const second = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(second, 'Doctor', 1);
  await settle(second, '/emergency-protocols');
  await pickPatientById(second, '#emergency-protocols-patient', patient.linked_patient_id);
  await expect(
    second.locator('main').getByText(location).first(),
    'the code blue is not in the protocol history'
  ).toBeVisible({ timeout: 30000 });
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
  await expect(
    reader.getByRole('heading', { name: 'Resuscitation (code blue)' }).first(),
    'the patient cannot see the resuscitation'
  ).toBeVisible({ timeout: 45000 });
  await context.close();
});
