import { test, expect, type Page } from '@playwright/test';
import { api, fixtureToken, readFixtures } from './identity';
import { pickPatientById, settle, signIn } from './support';

/**
 * A prescription's whole life, by the three people who touch it.
 *
 *   doctor      writes and sends it (create, sign, transmit in one click)
 *   pharmacist  receives it, starts the fill, hands over part of it, then the rest
 *   patient     can read it, and what has been dispensed
 *
 * `workflows.spec.ts` proves the first hop (the pharmacist SEES it, the patient
 * sees it). This proves the part it stops short of: the pharmacist's state machine
 * -- Transmitted, Received, InProgress, PartialFill, Dispensed -- driven through the
 * buttons a pharmacist has, with the quantity dialog that a suppressed native
 * `prompt()` once made a dead button, and the append-only dispense trail.
 *
 * The prescription is found in the pharmacist's queue by its quantity, which is
 * unique to the run: drug and strength repeat across runs, so they identify nothing.
 *
 * Run alone. Three roles sign in, and the pharmacist dashboard reloads its queue
 * after every action.
 */

const DRUG = 'Amlodipine';

const fixtures = () => readFixtures();

/** The pharmacist's queue row for this run's prescription. */
function queueRow(page: Page, quantity: number) {
  return page
    .locator('table tbody tr')
    .filter({ hasText: DRUG })
    .filter({ hasText: new RegExp(`of ${quantity} units`) })
    .first();
}

/** Answer the "how many units" dialog. */
async function dispenseUnits(page: Page, units: number) {
  const dialog = page.getByRole('dialog').filter({ hasText: /how many units/i });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await dialog.locator('input').fill(String(units));
  await dialog.getByRole('button', { name: /^ok$/i }).click();
  await expect(dialog).toHaveCount(0);
}

test('a prescription is sent, received, filled in two parts, and the patient can read what was dispensed', async ({
  browser,
  request,
}) => {
  test.setTimeout(420_000);
  const patient = fixtures().patient;
  const quantity = 101 + (Date.now() % 800);
  const firstPart = 5;

  // Doctor: write and send.
  const doctor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(doctor, 'Doctor', 0);
  await settle(doctor, '/e-prescribe');
  await pickPatientById(doctor, '#patient_id', patient.linked_patient_id);
  await doctor.locator('#medication_name').fill(DRUG);
  await doctor.locator('#strength').fill('5 mg');
  await doctor.locator('#quantity').fill(String(quantity));
  await doctor.locator('#directions').fill('One tablet by mouth once daily');
  await doctor.getByRole('button', { name: /send prescription/i }).click();
  await expect(doctor.getByText(/sent|success|created|signed/i).first()).toBeVisible({ timeout: 30000 });
  await doctor.close();

  // Pharmacist: receive, start the fill, dispense part, then the rest.
  const pharmacist = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(pharmacist, 'Pharmacist');
  await settle(pharmacist, '/dashboard');
  const row = queueRow(pharmacist, quantity);
  await expect(row, 'the sent prescription never reached the pharmacist queue').toBeVisible({ timeout: 45000 });
  await expect(row).toContainText(/transmitted/i);

  await row.getByRole('button', { name: /^receive$/i }).click();
  await expect(row.getByRole('status')).toContainText(/received by the pharmacy/i, { timeout: 30000 });
  await expect(row).toContainText(/received/i);

  await row.getByRole('button', { name: /^start fill$/i }).click();
  await expect(row.getByRole('status')).toContainText(/fill started/i, { timeout: 30000 });

  // A part: the queue says how much is still owed and the row stays open.
  await row.getByRole('button', { name: /^dispense$/i }).click();
  await dispenseUnits(pharmacist, firstPart);
  await expect(row.getByRole('status')).toContainText(/partially filled/i, { timeout: 30000 });
  await expect(row).toContainText(new RegExp(`${firstPart} of ${quantity} units`));
  await expect(row.getByRole('button', { name: /^dispense$/i })).toBeVisible();

  // More than is owed is refused, in words, and changes nothing.
  await row.getByRole('button', { name: /^dispense$/i }).click();
  await dispenseUnits(pharmacist, quantity);
  await expect(row.getByRole('status')).not.toContainText(/fully dispensed/i);
  await expect(row).toContainText(new RegExp(`${firstPart} of ${quantity} units`));

  // The rest: the row closes.
  await row.getByRole('button', { name: /^dispense$/i }).click();
  await dispenseUnits(pharmacist, quantity - firstPart);
  await expect(row.getByRole('status')).toContainText(/fully dispensed/i, { timeout: 30000 });
  await expect(row).toContainText(/dispensed/i);
  await expect(row).toContainText(new RegExp(`${quantity} of ${quantity} units`));

  // The append-only trail lists both hand-overs, and neither was overwritten.
  await row.getByRole('button', { name: /^history$/i }).click();
  const trail = row.getByRole('list', { name: new RegExp(`history for ${DRUG}`, 'i') });
  await expect(trail).toBeVisible({ timeout: 20000 });
  await expect(trail.getByRole('listitem')).toHaveCount(2);
  await pharmacist.close();

  // Patient: reads the prescription and what was dispensed, as themselves.
  const patientToken = await fixtureToken(request, {
    login_id: patient.login_id,
    password: patient.password ?? '',
  });
  const mine = await api(request, 'GET', `/api/e-prescriptions/patient/${patient.linked_patient_id}`, {
    token: patientToken,
  });
  expect(mine.status).toBe(200);
  const prescriptions = (mine.body?.prescriptions ?? []) as Array<Record<string, unknown>>;
  const quantityField = new RegExp(`"(prescribed_)?quantity"\\s*:\\s*${quantity}\\b`);
  const found = prescriptions.find((rx) => quantityField.test(JSON.stringify(rx)));
  expect(found, `the patient cannot read the prescription for ${quantity} units`).toBeTruthy();
  expect(JSON.stringify(found), 'the patient does not see it as dispensed').toMatch(/dispensed/i);
});
