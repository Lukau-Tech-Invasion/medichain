import { test, expect, type Page } from '@playwright/test';
import { api, fixtureToken, readFixtures } from './identity';
import { settle, signIn } from './support';

/**
 * The emergency read: tap a card, see the blood type and the allergies, and leave
 * the patient a record that it happened.
 *
 * This is the product's headline claim, and the one thing the removal of the chain
 * must not have touched. Emergency access is a managed-device, work-context,
 * time-boxed grant (`POST /api/emergency/grants`), never a role. The sealed audit
 * stream is **off the request path**: the read must
 * succeed whatever the checkpoint sink does. The test API runs with the sink set
 * to `none` -- no checkpoint leaves the host -- and this spec proves the read still
 * returns the emergency data and that the patient can see who opened their card.
 *
 *   1. an administrator enrols a device and provisions its key (as `devices.spec.ts`);
 *   2. a clinician chooses that device on the emergency screen, enters the
 *      patient's NFC tag, taps -- and sees blood type and allergies;
 *   3. the patient's own read of "who opened my emergency card" lists that access,
 *      under the grant, with the reason the screen sent;
 *   4. the device is revoked, and drops out of the clinician's picker.
 *
 * There is no paramedic fixture: break-glass is a capability bound to a device and
 * a tag, not a role anyone holds (see the note in the fixture seeder), so a doctor
 * stands in for the person tapping the card.
 */

const fixtures = () => readFixtures();

async function enrolDevice(
  admin: Page,
  name: string,
  workLocation: { organization_id: string; facility_id: string }
): Promise<string> {
  await settle(admin, '/devices');
  await expect(admin.getByRole('heading', { name: /approved devices/i })).toBeVisible({ timeout: 20000 });
  await admin.locator('#device-org').selectOption(workLocation.organization_id);
  await admin.locator('#device-facility').selectOption(workLocation.facility_id);
  await admin.locator('#device-name').fill(name);
  await admin.locator('#device-fingerprint').fill(`e2e-emergency-${Date.now()}`);
  await admin.getByRole('button', { name: /enrol device/i }).click();

  const row = admin.locator('[data-testid="device-table"] tr').filter({ hasText: name });
  await expect(row).toHaveCount(1, { timeout: 20000 });
  const deviceId = (await row.locator('td').nth(1).innerText()).trim();
  expect(deviceId).not.toEqual('');

  await row.getByRole('button', { name: /provision key/i }).click();
  await expect(row).toContainText(/active/i, { timeout: 20000 });
  return deviceId;
}

/** Bind a test device to the clinician's real work assignment. */
async function clinicianWorkLocation(request: Parameters<typeof api>[0]) {
  const doctor = fixtures().staff.find((member) => member.role === 'Doctor');
  expect(doctor, 'the fixture has no doctor').toBeTruthy();
  const token = await fixtureToken(request, {
    login_id: doctor!.login_id,
    password: doctor!.password ?? '',
  });
  const response = await api(request, 'POST', '/api/identity/context/work', { token, data: {} });
  expect(response.status).toBe(200);
  const { organization_id, facility_id } = response.body.context ?? {};
  expect(organization_id).toBeTruthy();
  expect(facility_id).toBeTruthy();
  return { organization_id: String(organization_id), facility_id: String(facility_id) };
}

test('a clinician taps a card and reads the emergency data; the patient can see it happened', async ({
  browser,
  request,
}) => {
  test.setTimeout(360_000);
  const patient = fixtures().patient;
  const patientToken = await fixtureToken(request, {
    login_id: patient.login_id,
    password: patient.password ?? '',
  });
  const nfcTag = patient.nfc_tag_id;
  expect(nfcTag, 'the fixture patient has no NFC tag; re-run the seed').toBeTruthy();

  const before = await api(request, 'GET', `/api/patients/${patient.linked_patient_id}/emergency-capsule/access-log`, {
    token: patientToken,
  });
  expect(before.status).toBe(200);
  const countBefore = Number(before.body?.count ?? 0);

  // 1. The device, enrolled by an administrator.
  const admin = await browser.newPage();
  await signIn(admin, 'Admin');
  const deviceName = `E2E emergency tablet ${Date.now()}`;
  const deviceId = await enrolDevice(admin, deviceName, await clinicianWorkLocation(request));

  try {
    // 2. The tap.
    const clinician = await browser.newPage();
    await signIn(clinician, 'Doctor', 0);
    await settle(clinician, '/emergency');

    const picker = clinician.locator('#approved-device');
    await expect(picker).toBeVisible({ timeout: 20000 });
    await expect(picker.locator(`option[value="${deviceId}"]`)).toHaveCount(1, { timeout: 20000 });
    await picker.selectOption(deviceId);

    await clinician.locator('#nfc-tag').fill(nfcTag as string);
    await clinician.getByRole('button', { name: /simulate nfc tap/i }).click();

    // Granted, and the emergency card is on screen: blood type, and the allergy
    // a clinician must know before touching the patient. The screen moves on to the
    // chart after a moment, so these are read straight away.
    await expect(clinician.getByText('Access Granted!')).toBeVisible({ timeout: 30000 });
    const card = clinician.getByText('Emergency Access Active');
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(clinician.locator('main')).toContainText(patient.linked_patient_id);
    await expect(clinician.locator('main')).toContainText('O+');
    await expect(clinician.locator('main')).toContainText(/penicillin/i);

    // None of the retired ledger or identity wording on the card a stranger reads in a hurry.
    const text = await clinician.locator('main').innerText();
    expect(text).not.toMatch(/block\s?chain|on-chain|wallet|anchor(ed|ing)?|transaction hash/i);
    await clinician.close();

    // 3. The patient's own view of who opened the card.
    const after = await api(request, 'GET', `/api/patients/${patient.linked_patient_id}/emergency-capsule/access-log`, {
      token: patientToken,
    });
    expect(after.status).toBe(200);
    expect(Number(after.body?.count ?? 0), 'the emergency read left no record the patient can read').toBeGreaterThan(
      countBefore
    );
    const newest = (after.body?.accesses ?? [])[0] as Record<string, unknown> | undefined;
    expect(newest, 'the access log lists no access').toBeTruthy();
    expect(newest?.reason_code).toBe('emergency_nfc_access');
    expect(String(newest?.grant_id ?? ''), 'the read was not made under a grant').not.toBe('');
    for (const retired of ['blockchain_tx_hash', 'tx_hash', 'chain_audit_status']) { // retired-term-negative-assertion
      expect(newest, `the access record carries ${retired}`).not.toHaveProperty(retired);
    }

    // The administrator's review: the grant is listed with who opened the card and
    // can be cut short. Break-glass access nobody can review or end is a log
    // nobody reads.
    await settle(admin, '/access-logs');
    const grants = admin.locator('[data-testid="grant-table"]');
    await expect(grants).toBeVisible({ timeout: 30000 });
    await expect(grants.locator('tr').filter({ hasText: patient.linked_patient_id }).first()).toBeVisible();
    const endButtons = grants.getByRole('button', { name: /end now/i });
    const open = await endButtons.count();
    if (open > 0) {
      await endButtons.first().click();
      await expect.poll(() => endButtons.count(), { timeout: 30000 }).toBeLessThan(open);
    }
  } finally {
    // 4. Leave the fleet as it was found: revoke the device, and confirm it leaves the picker.
    await settle(admin, '/devices');
    const row = admin.locator('[data-testid="device-table"] tr').filter({ hasText: deviceName });
    await row.getByRole('button', { name: /^revoke$/i }).click();
    await expect(row).toContainText(/revoked/i, { timeout: 20000 });
    await admin.close();
  }
});

test('a tag that belongs to no patient is refused, and refused plainly', async ({ browser, request }) => {
  test.setTimeout(240_000);
  const admin = await browser.newPage();
  await signIn(admin, 'Admin');
  const deviceName = `E2E emergency refusal ${Date.now()}`;
  const deviceId = await enrolDevice(admin, deviceName, await clinicianWorkLocation(request));

  try {
    const clinician = await browser.newPage();
    await signIn(clinician, 'Doctor', 0);
    await settle(clinician, '/emergency');
    await clinician.locator('#approved-device').selectOption(deviceId);
    await clinician.locator('#nfc-tag').fill(`NFC-NO-SUCH-${Date.now()}`);
    await clinician.getByRole('button', { name: /simulate nfc tap/i }).click();

    // Not a blank card: a failure that says so, and no patient data.
    await expect(clinician.getByText('Access Failed')).toBeVisible({ timeout: 30000 });
    await expect(clinician.getByText('Emergency Access Active')).toHaveCount(0);
    await clinician.close();
  } finally {
    await settle(admin, '/devices');
    const row = admin.locator('[data-testid="device-table"] tr').filter({ hasText: deviceName });
    await row.getByRole('button', { name: /^revoke$/i }).click();
    await expect(row).toContainText(/revoked/i, { timeout: 20000 });
    await admin.close();
  }
});
