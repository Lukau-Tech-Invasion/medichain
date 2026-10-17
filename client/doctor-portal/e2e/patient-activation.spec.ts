import { test, expect } from '@playwright/test';
import {
  api,
  apiLogin,
  apiRedeem,
  errorCodeOf,
  fixtureStaff,
  fixtureToken,
  registerPatientViaApi,
  stamp,
} from './identity';
import { settle, signInWithCredentials } from './support';

/**
 * How a patient gets an account: a doctor registers them, the clinic hands over a
 * one-time activation code, and the patient turns it into a username and password.
 *
 * The clinic never learns the password. The code is shown once, on the doctor's
 * screen, in the XXXX-XXXX-XXXX shape the patient app's form normalises to; the
 * server keeps only a keyed hash of it. Five wrong tries kill the grant, and an
 * administrator re-issues one in person.
 *
 * The patient-app half of this -- the activation form itself, its messages and
 * the first sign-in -- is `client/patient-app/e2e/activation.spec.ts`. This file
 * is the clinician's half, plus the API rules both halves rest on.
 *
 * Run alone: registration and each redemption derive a 210,000-round proof and
 * spend a request from the anonymous 60-a-minute budget.
 */

const CODE_SHAPE = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;
const PATIENT_PASSWORD = 'Patient-Long-Passphrase-5';
const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';

test('a doctor registers a patient; the code is shown once, on the screen, and it works', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const doctor = fixtureStaff('Doctor');
  const tag = stamp();
  const name = `Activation Screen ${tag}`;

  await signInWithCredentials(page, doctor.login_id, doctor.password);
  await settle(page, '/register');
  await page.locator('#register-full-name').fill(name);
  await page.locator('#register-date-of-birth').fill('1990-04-12');
  await page.locator('#register-national-id').fill(`90041${String(Date.now()).slice(-8)}`);
  await page.locator('#register-blood-type').selectOption('A+');
  await page.locator('#register-emergency-contact-name').fill('Sipho Activation');
  await page.locator('#register-emergency-contact-phone').fill('+27821234567');
  await page.locator('#register-emergency-contact-relationship').fill('Brother');
  await page.getByRole('button', { name: /register patient/i }).click();
  await expect(page.getByText(/patient registered/i).first()).toBeVisible({ timeout: 30000 });

  // The patient's id, then the code beside it.
  const patientId = (
    await page.getByText('Patient ID', { exact: true }).first().locator('xpath=following-sibling::p[1]').innerText()
  ).trim();
  expect(patientId).toBeTruthy();

  const codeElement = page.getByTestId('one-time-code');
  await expect(codeElement).toBeVisible();
  const code = (await codeElement.innerText()).trim();
  expect(code, 'the activation code has the XXXX-XXXX-XXXX shape').toMatch(CODE_SHAPE);
  await expect(page.getByText(/valid until/i).first()).toBeVisible();
  await expect(page.getByText(/shown once/i).first()).toBeVisible();
  // The clinic is told it never sees the password.
  await expect(page.getByText(/never sees the password/i)).toBeVisible();
  // No sign of the retired identity material beside the code.
  expect(await page.locator('main').innerText()).not.toMatch(/wallet|recovery phrase|seed phrase/i);

  // Leaving the screen ends it: nothing brings the code back.
  await page.getByRole('button', { name: /register another/i }).click();
  await expect(codeElement).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toContain(code);

  // The code the screen showed is a real one: the patient redeems it, choosing
  // their own username and password, and is bound to the record just registered.
  const username = `e2e.pt.${tag}`;
  const redeemed = await apiRedeem(request, {
    identifier: patientId,
    code,
    username,
    password: PATIENT_PASSWORD,
  });
  expect(redeemed.status).toBe(200);
  expect(redeemed.body?.user?.role).toBe('Patient');
  expect(redeemed.body?.user?.linked_patient_id).toBe(patientId);
  expect(redeemed.body?.access_token).toBeTruthy();

  const signedIn = await apiLogin(request, username, PATIENT_PASSWORD);
  expect(signedIn.status).toBe(200);
  expect(signedIn.body?.user?.linked_patient_id).toBe(patientId);

  // Spent. The same code, presented again, is refused as invalid -- not as "already used".
  const again = await apiRedeem(request, {
    identifier: patientId,
    code,
    username: `${username}.b`,
    password: PATIENT_PASSWORD,
  });
  expect(again.status).toBe(401);
  expect(errorCodeOf(again.body)).toBe('INVALID_GRANT');
});

test('wrong codes kill the grant, an unknown patient looks the same, and re-issue restores it', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const doctor = fixtureStaff('Doctor');
  const token = await fixtureToken(request, doctor);
  const registered = await registerPatientViaApi(request, token, 'Activation Lockout');
  const username = `e2e.lock.${stamp()}`;

  const nurseToken = await fixtureToken(request, fixtureStaff('Nurse'));
  const unrelated = await api(request, 'POST', `/api/patients/${registered.patientId}/activation-code`, {
    token: nurseToken,
    data: {},
  });
  expect(unrelated.status, 'another clinician must not reissue this patient’s code').toBe(403);

  // An unknown patient id gets the same answer as a wrong code, so the form
  // cannot be used to discover which patient ids exist.
  const unknown = await apiRedeem(request, {
    identifier: `PAT-NO-SUCH-${stamp()}`,
    code: 'ZZZZ-ZZZZ-ZZZZ',
    username,
    password: PATIENT_PASSWORD,
  });
  expect(unknown.status).toBe(401);
  expect(errorCodeOf(unknown.body)).toBe('INVALID_GRANT');

  // The fifth wrong code kills the grant. The response stays generic even
  // when locked, so this endpoint cannot reveal whether a patient ID exists.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const wrong = await apiRedeem(request, {
      identifier: registered.patientId,
      code: 'ZZZZ-ZZZZ-ZZZZ',
      username,
      password: PATIENT_PASSWORD,
    });
    expect(wrong.status, `wrong code #${attempt}`).toBe(401);
    expect(errorCodeOf(wrong.body)).toBe('INVALID_GRANT');
  }

  // A dead grant does not redeem even with the right code.
  const rightButDead = await apiRedeem(request, {
    identifier: registered.patientId,
    code: registered.activationCode,
    username,
    password: PATIENT_PASSWORD,
  });
  expect(rightButDead.status).toBeGreaterThanOrEqual(400);
  expect(rightButDead.body?.access_token).toBeUndefined();

  // A clinician re-issues a code; the new one works and the old one stays dead.
  const reissued = await api(request, 'POST', `/api/patients/${registered.patientId}/activation-code`, {
    token,
    data: {},
  });
  expect(reissued.status).toBe(200);
  const freshCode = String(reissued.body?.activation_code ?? reissued.body?.activation?.code ?? '');
  expect(freshCode).toMatch(CODE_SHAPE);
  expect(freshCode).not.toBe(registered.activationCode);

  const stale = await apiRedeem(request, {
    identifier: registered.patientId,
    code: registered.activationCode,
    username,
    password: PATIENT_PASSWORD,
  });
  expect(stale.status).toBeGreaterThanOrEqual(400);

  const good = await apiRedeem(request, {
    identifier: registered.patientId,
    code: freshCode,
    username,
    password: PATIENT_PASSWORD,
  });
  expect(good.status).toBe(200);

  // Once activated there is nothing to re-issue.
  const late = await api(request, 'POST', `/api/patients/${registered.patientId}/activation-code`, {
    token,
    data: {},
  });
  expect(late.status).toBe(409);
  expect(errorCodeOf(late.body)).toBe('ALREADY_ACTIVATED');
});

test('the patient signs in to the patient app with the username and password they chose', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const reachable = await request
    .get(`${PATIENT_APP}/login`, { timeout: 5000 })
    .then((response) => response.ok())
    .catch(() => false);
  test.skip(
    !reachable,
    `the patient app is not reachable at ${PATIENT_APP}; set PATIENT_APP_URL (the patient-app project runs this flow from its own side)`
  );

  const doctor = fixtureStaff('Doctor');
  const token = await fixtureToken(request, doctor);
  const registered = await registerPatientViaApi(request, token, 'Activation CrossApp');
  const username = `e2e.app.${stamp()}`;

  const context = await browser.newContext();
  const patient = await context.newPage();
  await patient.goto(`${PATIENT_APP}/activate`);
  await patient.locator('#activate-identifier').fill(registered.patientId);
  await patient.locator('#activate-code').fill(registered.activationCode);
  await patient.locator('#activate-username').fill(username);
  await patient.locator('#activate-password').fill(PATIENT_PASSWORD);
  await patient.locator('#activate-confirm').fill(PATIENT_PASSWORD);
  await patient.getByRole('button', { name: /activate and sign in/i }).click();
  await patient.locator('main').first().waitFor({ state: 'visible', timeout: 45000 });
  await expect(patient).toHaveURL(/dashboard/, { timeout: 30000 });
  await context.close();
});
