import { test, expect } from '@playwright/test';
import { api, fixtureToken, readFixtures } from './identity';
import { settle, signIn, answerPasswordConfirmation, choose } from './support';
import { clinicianWorkLocation, enrolDevice, revokeDevice } from './emergency-device';

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
    await choose(picker, deviceId);

    await clinician.locator('#nfc-tag').fill(nfcTag as string);
    await clinician.getByRole('button', { name: /open emergency summary/i }).click();

    // Granted, and the emergency card is on screen: blood type, and the allergy
    // a clinician must know before touching the patient. The screen moves on to the
    // chart after a moment, so these are read straight away.
    await expect(clinician.getByText('Access Granted!')).toBeVisible({ timeout: 30000 });
    const card = clinician.getByText('Emergency Access Active');
    await expect(card).toBeVisible({ timeout: 10000 });
    // The card names the patient and their date of birth; a paramedic cannot
    // check a PAT- id against the person in front of them.
    await expect(clinician.locator('main')).toContainText(/\S+ · born [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(clinician.locator('main')).not.toContainText(patient.linked_patient_id);
    await expect(clinician.locator('main')).toContainText('O+');
    await expect(clinician.locator('main')).toContainText(/penicillin/i);

    const text = await clinician.locator('main').innerText();
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

    // The administrator's review: the grant is listed with who opened the card and
    // can be cut short. Break-glass access nobody can review or end is a log
    // nobody reads.
    await settle(admin, '/access-logs');
    const grants = admin.locator('[data-testid="grant-table"]');
    await expect(grants).toBeVisible({ timeout: 30000 });
    // Rows name the patient; the id is on the name.
    await expect(grants.locator('tr').filter({ has: admin.locator(`[data-patient-name-of="${patient.linked_patient_id}"]`) }).first()).toBeVisible();
    const endButtons = grants.getByRole('button', { name: /end now/i });
    const open = await endButtons.count();
    if (open > 0) {
      await endButtons.first().click();
      // Ending another person's emergency grant is ADR-0008 Class C: the
      // administrator confirms it.
      await answerPasswordConfirmation(admin, 'Admin');
      await expect.poll(() => endButtons.count(), { timeout: 30000 }).toBeLessThan(open);
    }
  } finally {
    // 4. Leave the fleet as it was found: revoke the device, and confirm it leaves the picker.
    await revokeDevice(admin, deviceName);
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
    await choose(clinician.locator('#approved-device'), deviceId);
    await clinician.locator('#nfc-tag').fill(`NFC-NO-SUCH-${Date.now()}`);
    await clinician.getByRole('button', { name: /open emergency summary/i }).click();

    // Not a blank card: a failure that says so, and no patient data.
    await expect(clinician.getByText('Access Failed')).toBeVisible({ timeout: 30000 });
    await expect(clinician.getByText('Emergency Access Active')).toHaveCount(0);
    await clinician.close();
  } finally {
    await revokeDevice(admin, deviceName);
    await admin.close();
  }
});
