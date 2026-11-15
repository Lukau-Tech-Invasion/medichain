import { portalPath } from '../../doctor-portal/e2e/portal-path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { deriveAuthProof } from '../../shared/src/auth/proof';
import {
  TotpDevice,
  api,
  apiContext,
  apiLogin,
  apiRedeem,
  enrolTotp,
  errorCodeOf,
  fixtureStaff,
  fixtureToken,
  registerPatientViaApi,
  stamp,
  tokenOf,
} from '../../doctor-portal/e2e/identity';
import { expectSignedOut, signInWithCredentials, signOut } from './support';

/**
 * Patient sign-in after activation: username and password, an authenticator code
 * when they have chosen to add one, and the messages the form gives when it says no.
 *
 * Three patients are activated for this file (through the API, as the clinic and
 * the patient would): one to sign in with, one to lock out, one to enrol in
 * two-factor. Locking or enrolling the seeded fixture patient would break every
 * other suite that signs in as it.
 *
 * There is no "change password" screen in the patient app: the Settings row for
 * it is informational, and a forgotten password is an administrator's in-person
 * reset (see the coverage map). Changing a password is therefore proved over the
 * API, which is where the patient's own change lives.
 *
 * Desktop project only: these create accounts and spend the sign-in budget.
 */

test.skip(({ isMobile }) => isMobile, 'account-creating flows run on the desktop project only');
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'Patient-Long-Passphrase-5';

interface ActivePatient {
  patientId: string;
  username: string;
  password: string;
  token: string;
}

let api_: APIRequestContext;
let basic: ActivePatient;
let lockTarget: ActivePatient;
let totpTarget: ActivePatient;
let totpDevice: TotpDevice;

async function activatePatient(label: string): Promise<ActivePatient> {
  const doctorToken = await fixtureToken(api_, fixtureStaff('Doctor'));
  const registered = await registerPatientViaApi(api_, doctorToken, label);
  const username = `e2e.${label.toLowerCase().replace(/\W+/g, '')}.${stamp()}`;
  const redeemed = await apiRedeem(api_, {
    identifier: registered.patientId,
    code: registered.activationCode,
    username,
    password: PASSWORD,
  });
  return {
    patientId: registered.patientId,
    username,
    password: PASSWORD,
    token: tokenOf(redeemed, `activate ${username}`),
  };
}

test.beforeAll(async ({ playwright }, testInfo) => {
  test.setTimeout(300_000);
  api_ = await apiContext(playwright, testInfo);
  basic = await activatePatient('LoginBasic');
  lockTarget = await activatePatient('LoginLock');
  totpTarget = await activatePatient('LoginTotp');
  totpDevice = await enrolTotp(api_, totpTarget.token);
});

test.afterAll(async () => {
  await api_?.dispose();
});

test('a patient signs in with a username and password, and the password never travels', async ({ page }) => {
  test.setTimeout(120_000);
  const loginRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/auth/login') && request.method() === 'POST'
  );
  await signInWithCredentials(page, basic.username, basic.password);
  const sent = (await loginRequest).postData() ?? '';

  const body = JSON.parse(sent) as Record<string, unknown>;
  expect(body.identifier).toBe(basic.username);
  expect(String(body.auth_proof)).toMatch(/^[0-9a-f]{64}$/);
  expect(sent, 'the password itself was in the request body').not.toContain(basic.password);
  expect(Object.keys(body).sort()).toEqual(['auth_proof', 'identifier']);
});

test('a session survives a reload; signing out ends it, and a protected page sends them to sign-in', async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithCredentials(page, basic.username, basic.password);

  await page.reload();
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
  await expect(page).toHaveURL(/\/dashboard/);

  await signOut(page);
  await page.reload();
  await expectSignedOut(page);

  await page.goto(portalPath('/records'));
  await expectSignedOut(page);
});

test('a wrong password and an unknown username get the same generic message', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(portalPath('/login'));

  const attempt = async (username: string, password: string): Promise<string> => {
    await page.locator('input#username').fill(username);
    await page.locator('input#password').fill(password);
    await page.locator('button[type="submit"]').click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 30000 });
    return (await alert.innerText()).replace(/\s+/g, ' ').trim();
  };

  const wrongPassword = await attempt(basic.username, `${basic.password}-wrong`);
  const unknownUser = await attempt(`nobody.${stamp()}`, `${basic.password}-wrong`);
  expect(wrongPassword).toMatch(/not correct/i);
  expect(unknownUser).toBe(wrongPassword);
  expect(wrongPassword).not.toMatch(/lock/i);

  // An empty form is refused before anything is sent.
  await page.locator('input#username').fill('');
  await page.locator('input#password').fill('');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText(/enter your username and password/i);
});

test('repeated failures lock the account and the form says so, even for the right password', async ({ page }) => {
  test.setTimeout(240_000);

  let lockedAfter = 0;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await apiLogin(api_, lockTarget.username, `${lockTarget.password}-wrong`);
    if (result.status === 429) {
      expect(errorCodeOf(result.body)).toBe('ACCOUNT_LOCKED');
      lockedAfter = attempt;
      break;
    }
    expect(result.status, `attempt ${attempt} before the lock`).toBe(401);
    expect(errorCodeOf(result.body)).toBe('INVALID_CREDENTIALS');
  }
  expect(lockedAfter, 'twelve wrong passwords never locked the account').toBeGreaterThan(1);

  await page.goto(portalPath('/login'));
  await page.locator('input#username').fill(lockTarget.username);
  await page.locator('input#password').fill(lockTarget.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toContainText(/temporarily locked/i, { timeout: 30000 });
  await expectSignedOut(page);
});

test('a patient with an authenticator is asked for its code; a wrong code is refused', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto(portalPath('/login'));
  await page.locator('input#username').fill(totpTarget.username);
  await page.locator('input#password').fill(totpTarget.password);
  await page.locator('button[type="submit"]').click();

  const codeField = page.locator('input#totp-code');
  await expect(codeField).toBeVisible({ timeout: 30000 });
  await expect(page.locator('main').first()).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await codeField.fill('000000');
  await page.locator('button[type="submit"]').click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/login/);

  // After a failure the form clears the password; it is typed again with the right code.
  await page.locator('input#password').fill(totpTarget.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input#totp-code')).toBeVisible({ timeout: 30000 });
  await page.locator('input#totp-code').fill(await totpDevice.code());
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });
});

test('a patient changes their password over the API: other sessions end, the old one stops', async () => {
  test.setTimeout(180_000);
  const patient = await activatePatient('LoginChange');
  const other = tokenOf(await apiLogin(api_, patient.username, patient.password), 'open a second session');
  const changed = 'Changed-Patient-Passphrase-8';

  const wrongCurrent = await api(api_, 'POST', '/api/auth/credentials/change', {
    token: patient.token,
    data: {
      current_auth_proof: await deriveAuthProof(`${patient.password}-wrong`, patient.username),
      new_password: changed,
    },
  });
  expect(wrongCurrent.status).toBeGreaterThanOrEqual(400);

  const change = await api(api_, 'POST', '/api/auth/credentials/change', {
    token: patient.token,
    data: {
      current_auth_proof: await deriveAuthProof(patient.password, patient.username),
      new_password: changed,
    },
  });
  expect(change.status).toBe(200);

  expect((await api(api_, 'GET', '/api/auth/me', { token: other })).status).toBe(401);
  expect((await apiLogin(api_, patient.username, patient.password)).status).toBe(401);
  expect((await apiLogin(api_, patient.username, changed)).status).toBe(200);
});
