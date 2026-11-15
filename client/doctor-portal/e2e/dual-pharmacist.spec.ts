import { test, expect, type Page } from '@playwright/test';
import { api, fixtureStaff, fixtureToken, readFixtures } from './identity';
import { signInWithCredentials } from './support';

/**
 * Second-pharmacist verification: the second pair of eyes on a risky fill.
 *
 * A prescription the policy marks for secondary verification cannot be dispensed
 * by the pharmacist who started the fill. That pharmacist asks a colleague; the
 * colleague -- someone else, never the requester -- approves or rejects; only a
 * verified prescription can be dispensed. The rule that one person cannot be both
 * halves of the check is the whole point, so this drives it with two real
 * pharmacist accounts (the seeder creates two for exactly this) and asserts the
 * buttons each of them is, and is not, offered.
 *
 * The prescription is created for this run through the API, as the doctor portal's
 * "Send prescription" does (create, sign, transmit), with `force_secondary_verification`
 * set. The seeder's own dual-check prescription is a single-use fixture; consuming
 * it here would make this spec pass once per database. The run's prescription is
 * found in the queue by its quantity, which is unique to the run.
 *
 * Run alone: two pharmacists and a doctor sign in and the queue reloads after
 * every action.
 */

/** The pharmacist's queue row for this run's prescription. */
function queueRow(page: Page, drug: string, quantity: number) {
  return page
    .locator('table tbody tr')
    .filter({ hasText: drug })
    .filter({ hasText: new RegExp(`of ${quantity} units`) })
    .first();
}

test('a verified prescription needs a second pharmacist, and the first cannot be that person', async ({
  browser,
  request,
}) => {
  test.setTimeout(420_000);
  const patientId = readFixtures().patient.linked_patient_id;
  const quantity = 301 + (Date.now() % 600);
  // A name no interaction table knows, like the seeder's own dual-check prescription.
  const drug = `Synthetic Dual Check ${Date.now().toString(36)}`;

  // The doctor sends it, over the API: create, sign, transmit.
  const doctorToken = await fixtureToken(request, fixtureStaff('Doctor'));
  const created = await api(request, 'POST', '/api/e-prescriptions', {
    token: doctorToken,
    data: {
      patient_id: patientId,
      medication_name: drug,
      strength: '5mg',
      form: 'tablet',
      quantity,
      days_supply: 30,
      directions: 'Synthetic dual-check test only',
      refills_allowed: 0,
      is_controlled: false,
      policy_category: 'organization-approved-category',
      force_secondary_verification: true,
      pharmacy_ncpdp: 'BROWSER-001',
      pharmacy_name: 'Browser Test Pharmacy',
      diagnosis_codes: ['Z00.0'],
      patient_instructions: 'Synthetic test only',
    },
  });
  expect(created.status, `create -> ${JSON.stringify(created.body)}`).toBeLessThan(300);
  const id = String(created.body?.prescription_id ?? '');
  expect(id).toBeTruthy();
  for (const [path, data] of [
    [`/api/e-prescriptions/${id}/sign`, { signature_method: 'password', attestation: 'Browser workflow' }],
    [`/api/e-prescriptions/${id}/transmit`, {}],
  ] as const) {
    const step = await api(request, 'POST', path, { token: doctorToken, data });
    expect(step.status, `${path} -> ${JSON.stringify(step.body)}`).toBeLessThan(300);
  }

  const first = fixtureStaff('Pharmacist', 0);
  const second = fixtureStaff('Pharmacist', 1);
  expect(first.login_id, 'the two pharmacist fixtures are the same account').not.toBe(second.login_id);

  // Pharmacist one: receives it, starts the fill, and is NOT offered Dispense.
  const one = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signInWithCredentials(one, first.login_id, first.password);
  const rowOne = queueRow(one, drug, quantity);
  await expect(rowOne, 'the sent prescription never reached the pharmacist queue').toBeVisible({ timeout: 45000 });

  await rowOne.getByRole('button', { name: /^receive$/i }).click();
  await expect(rowOne.getByRole('status')).toContainText(/received by the pharmacy/i, { timeout: 30000 });
  await rowOne.getByRole('button', { name: /^start fill$/i }).click();
  await expect(rowOne.getByRole('status')).toContainText(/fill started/i, { timeout: 30000 });

  await expect(rowOne.getByRole('button', { name: /^dispense$/i }), 'dispense was offered before the second check').toHaveCount(0);
  await rowOne.getByRole('button', { name: /request second pharmacist/i }).click();
  await expect(rowOne.getByRole('status')).toContainText(/second-pharmacist verification requested/i, {
    timeout: 30000,
  });

  // The requester cannot approve their own request; they can only withdraw it.
  await expect(rowOne.getByRole('button', { name: /approve verification/i })).toHaveCount(0);
  await expect(rowOne.getByRole('button', { name: /withdraw verification/i })).toBeVisible();

  // Pharmacist two: sees the pending check and approves it.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const two = await context.newPage();
  await signInWithCredentials(two, second.login_id, second.password);
  const rowTwo = queueRow(two, drug, quantity);
  await expect(rowTwo).toBeVisible({ timeout: 45000 });
  await expect(rowTwo.getByRole('button', { name: /^dispense$/i })).toHaveCount(0);
  await rowTwo.getByRole('button', { name: /approve verification/i }).click();
  await expect(rowTwo.getByRole('status')).toContainText(/verification approved/i, { timeout: 30000 });
  await context.close();

  // Verified: pharmacist one, reloading their queue, can now dispense, and does.
  await one.reload();
  await one.locator('main').first().waitFor({ state: 'visible', timeout: 45000 });
  const verifiedRow = queueRow(one, drug, quantity);
  await expect(verifiedRow).toBeVisible({ timeout: 45000 });
  await verifiedRow.getByRole('button', { name: /^dispense$/i }).click();
  const dialog = one.getByRole('dialog').filter({ hasText: /how many units/i });
  await dialog.locator('input').fill(String(quantity));
  await dialog.getByRole('button', { name: /^ok$/i }).click();
  await expect(verifiedRow.getByRole('status')).toContainText(/fully dispensed/i, { timeout: 30000 });
  await one.close();
});
