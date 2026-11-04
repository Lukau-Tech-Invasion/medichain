import { test, expect } from '@playwright/test';
import { readFixtures } from './identity';
import { declareAccessReason, pickPatientById, settle, signIn } from './support';

/**
 * Working without signal (owner request, 2026-11-04).
 *
 *   doctor    signs in; today's patients are downloaded to the device
 *   no signal records vital signs: kept on the device, shown as waiting, and
 *             not reported as a failure or as recorded
 *   signal    the reading is sent by itself and the waiting count clears
 *   doctor    sees the reading on the flowsheet once it is on the server
 *   patient   reads it in the patient app
 */

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';

test('vital signs saved without signal reach the server, the chart and the patient', async ({ browser }) => {
  test.setTimeout(300_000);
  const patient = readFixtures().patient;
  const patientId = patient.linked_patient_id;
  // A heart rate nobody else will have entered, to find this reading again.
  const heartRate = String(60 + (Date.now() % 39));

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const day = page.waitForResponse((r) => r.url().includes('/api/clinician/offline-bundle'), { timeout: 60000 });
  await signIn(page, 'Doctor', 0);
  expect((await day).status(), 'the day was not downloaded').toBe(200);

  await settle(page, '/vitals');
  await pickPatientById(page, '#vitals-patient-select', patientId);
  await page.getByRole('button', { name: 'Record Vitals' }).click();
  await page.locator('#vitals-heart-rate').fill(heartRate);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save Vitals' }).click();
  await expect(page.getByText('No signal — saved on this device', { exact: false }).first(),
    'an offline save was not kept on the device').toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Vital signs recorded successfully'), 'an offline save claimed to be recorded').toHaveCount(0);
  await expect(page.getByText('1 waiting to send'), 'the waiting count is missing').toBeVisible({ timeout: 20000 });

  await context.setOffline(false);
  await expect(page.getByText('reached the server', { exact: false }).first(),
    'the reading was not sent when signal returned').toBeVisible({ timeout: 90000 });
  await expect(page.getByText('waiting to send')).toHaveCount(0);

  await page.reload();
  // A reload starts a new chart session: the reason is asked again.
  await expect(page.getByTestId('access-reason-gate')).toBeVisible({ timeout: 30000 });
  await declareAccessReason(page);
  await expect(page.locator('main').getByText(heartRate).first(), 'the reading is not on the flowsheet').toBeVisible({ timeout: 30000 });
  await context.close();

  const patientContext = await browser.newContext();
  const reader = await patientContext.newPage();
  await reader.goto(`${PATIENT_APP}/login`);
  await reader.locator('input#username').fill(patient.login_id);
  await reader.locator('input#password').fill(patient.password ?? '');
  await reader.locator('button[type="submit"]').click();
  await expect(reader).toHaveURL(/\/dashboard$/, { timeout: 30000 });
  await reader.goto(`${PATIENT_APP}/vitals`);
  await expect(reader.locator('main').getByText(heartRate).first(), 'the patient cannot see the reading').toBeVisible({ timeout: 45000 });
  await patientContext.close();
});
