import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFixtures } from './identity';
import { pickPatientById, settle, signIn } from './support';

/**
 * Workflow 1 — medication: prescribe, dispense, give, and the patient reads it.
 *
 * `prescribe-dispense.spec.ts` stops at the pharmacy counter. This carries the
 * same prescription to the bedside and back to the patient:
 *
 *   doctor      sends it
 *   pharmacist  receives it and dispenses all of it
 *   nurse       finds it on the MAR AFTER dispensing (it used to vanish the
 *               moment the pharmacy received it), is refused without a route,
 *               records the dose, and finds it in the history after a reload
 *   patient     reads "Medication given" in My Records (they used to have no
 *               way to see a dose had been given)
 *
 * The drug name carries a run stamp so every screen is matched to this run's
 * prescription and nothing from an earlier run can satisfy an assertion.
 */

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';
const fixtures = () => readFixtures();

async function staff(browser: Browser, role: Parameters<typeof signIn>[1]): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(page, role, 0);
  return page;
}

test('a prescription reaches the bedside after dispensing, is given, and the patient can read that it was', async ({
  browser,
}) => {
  test.setTimeout(480_000);
  const patient = fixtures().patient;
  const run = Date.now().toString(36).slice(-6).toUpperCase();
  const drug = `Amlodipine QA${run}`;
  const quantity = 30;

  // Doctor: write and send.
  const doctor = await staff(browser, 'Doctor');
  await settle(doctor, '/e-prescribe');
  await pickPatientById(doctor, '#patient_id', patient.linked_patient_id);
  await doctor.locator('#medication_name').fill(drug);
  await doctor.locator('#strength').fill('5 mg');
  await doctor.locator('#quantity').fill(String(quantity));
  await doctor.locator('#directions').fill('One tablet by mouth once daily');
  await doctor.getByRole('button', { name: /send prescription/i }).click();
  await expect(doctor.getByText(/sent|success|created|signed/i).first()).toBeVisible({ timeout: 30000 });
  await doctor.close();

  // Pharmacist: receive, start the fill, dispense all of it.
  const pharmacist = await staff(browser, 'Pharmacist');
  await settle(pharmacist, '/dashboard');
  const row = pharmacist.locator('table tbody tr').filter({ hasText: drug }).first();
  await expect(row, 'the prescription never reached the pharmacy queue').toBeVisible({ timeout: 45000 });
  await row.getByRole('button', { name: /^receive$/i }).click();
  await expect(row.getByRole('status')).toContainText(/received by the pharmacy/i, { timeout: 30000 });
  await row.getByRole('button', { name: /^start fill$/i }).click();
  await expect(row.getByRole('status')).toContainText(/fill started/i, { timeout: 30000 });
  await row.getByRole('button', { name: /^dispense$/i }).click();
  const units = pharmacist.getByRole('dialog').filter({ hasText: /how many units/i });
  await units.locator('input').fill(String(quantity));
  await units.getByRole('button', { name: /^ok$/i }).click();
  await expect(row.getByRole('status')).toContainText(/fully dispensed/i, { timeout: 30000 });
  await pharmacist.close();

  // Nurse: the dispensed drug is on the MAR.
  const nurse = await staff(browser, 'Nurse');
  await settle(nurse, '/mar');
  await pickPatientById(nurse, '#medadmin-patient', patient.linked_patient_id);
  await nurse.locator('#medadmin-search').fill(drug);
  const marRow = nurse.locator('table tbody tr').filter({ hasText: drug }).first();
  await expect(marRow, 'a dispensed prescription is missing from the MAR').toBeVisible({ timeout: 30000 });
  await marRow.getByRole('button', { name: /^administer$/i }).click();

  // Refused without a route: the prescription records a form, never a route.
  await nurse.locator('#medadmin-five-rights').check();
  await nurse.getByRole('button', { name: /record administration/i }).click();
  await expect(nurse.getByText(/record the route the dose was given by/i).first()).toBeVisible({ timeout: 10000 });

  await nurse.locator('#medadmin-route').selectOption('PO');
  await nurse.getByRole('button', { name: /record administration/i }).click();
  await expect(nurse.getByText(/administration recorded successfully/i).first()).toBeVisible({ timeout: 30000 });

  // The history holds it after a full reload: it was stored, not just shown.
  await nurse.reload();
  await nurse.getByRole('button', { name: /^history$/i }).click();
  await nurse.locator('#medadmin-search').fill(drug);
  await expect(nurse.locator('main').getByText(drug).first()).toBeVisible({ timeout: 30000 });
  await nurse.close();

  // Patient: reads that the dose was given, as themselves.
  const context = await browser.newContext();
  const reader = await context.newPage();
  await reader.goto(`${PATIENT_APP}/login`);
  await reader.locator('input#username').fill(patient.login_id);
  await reader.locator('input#password').fill(patient.password ?? '');
  await reader.locator('button[type="submit"]').click();
  await expect(reader).toHaveURL(/\/dashboard$/, { timeout: 30000 });
  await reader.goto(`${PATIENT_APP}/records`);
  await expect(
    reader.getByRole('heading', { name: `Medication given: ${drug}` }),
    'the patient cannot see that the dose was given'
  ).toBeVisible({ timeout: 45000 });
  await context.close();
});
