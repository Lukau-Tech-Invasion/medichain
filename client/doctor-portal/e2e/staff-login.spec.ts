import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  AdminApi,
  FIXTURE_PASSWORD,
  TotpDevice,
  api,
  apiContext,
  apiLogin,
  enrolTotp,
  errorCodeOf,
  fixtureStaff,
  provisionStaff,
  stamp,
  tokenOf,
  type Throwaway,
} from './identity';
import { expectSignedOut, signInWithCredentials, signOut, skipFirstVisitReload } from './support';

/**
 * Staff sign-in: Employee ID and password, an authenticator code when the
 * account has one, and what the form says when it refuses.
 *
 * There is no wallet, no recovery phrase and no keystore any more (ADR-0010).
 * A clinician types the Employee ID an administrator gave them and a password
 * they chose when they redeemed their one-time code. The password is stretched
 * in the browser and only a proof of it travels; the server holds an Argon2id
 * verifier over the proof.
 *
 * # Who these tests sign in as
 *
 * The seeded doctor for the plain sign-in, and two throwaway accounts created
 * for this file for the two cases that damage an account: one is locked out for
 * fifteen minutes, one is enrolled in two-factor. Locking or enrolling a fixture
 * would break every other suite that signs in as it.
 *
 * Run alone: sign-in is several requests against a 60-a-minute budget.
 */

test.describe.configure({ mode: 'serial' });

let api_: APIRequestContext;
let admin: AdminApi;
let lockTarget: Throwaway;
let totpTarget: Throwaway;
let totpDevice: TotpDevice;

test.beforeAll(async ({ playwright }, testInfo) => {
  test.setTimeout(240_000);
  api_ = await apiContext(playwright, testInfo);
  admin = await AdminApi.signIn(api_);
  lockTarget = await provisionStaff(api_, admin, 'Doctor');
  totpTarget = await provisionStaff(api_, admin, 'Nurse');
  totpDevice = await enrolTotp(api_, totpTarget.token);
});

test.afterAll(async () => {
  // Releases the administrator's own authenticator if this run had to pair one.
  await admin?.release();
  await api_?.dispose();
});

test('a clinician signs in with Employee ID and password, and the password never travels', async ({ page }) => {
  test.setTimeout(120_000);
  const doctor = fixtureStaff('Doctor');

  const loginRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/auth/login') && request.method() === 'POST'
  );
  await signInWithCredentials(page, doctor.login_id, doctor.password);
  const sent = (await loginRequest).postData() ?? '';

  const body = JSON.parse(sent) as Record<string, unknown>;
  expect(body.identifier).toBe(doctor.login_id);
  expect(String(body.auth_proof), 'a hex proof of the password, not the password').toMatch(/^[0-9a-f]{64}$/);
  expect(sent, 'the password itself was in the request body').not.toContain(doctor.password);
  expect(Object.keys(body).sort(), 'only the identifier and the proof are sent').toEqual(['auth_proof', 'identifier']);

  await expect(page.locator('main h1')).toContainText(/welcome back/i);
});

test('a session survives a reload, and signing out ends it for good', async ({ page }) => {
  test.setTimeout(120_000);
  const doctor = fixtureStaff('Doctor');
  await signInWithCredentials(page, doctor.login_id, doctor.password);

  // The access token lives in memory only; a reload restores the session from
  // the HttpOnly refresh cookie or not at all.
  await page.reload();
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toBeVisible({ timeout: 30000 });

  await signOut(page);
  await page.reload();
  await expectSignedOut(page);

  // A protected route no longer opens; it sends the visitor back to sign-in.
  await page.goto('/dashboard');
  await expectSignedOut(page);
  await expect(page).toHaveURL(/\/login/);
});

test('a wrong password and an unknown Employee ID get the same generic error', async ({ page }) => {
  test.setTimeout(120_000);
  const doctor = fixtureStaff('Doctor');
  await skipFirstVisitReload(page);
  await page.goto('/login');

  const attempt = async (loginId: string, password: string): Promise<string> => {
    await page.locator('input#identifier').fill(loginId);
    await page.locator('input#password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const alert = page.locator('form [role="alert"]');
    await expect(alert).toBeVisible({ timeout: 30000 });
    return (await alert.innerText()).replace(/\s+/g, ' ').trim();
  };

  const wrongPassword = await attempt(doctor.login_id, `${FIXTURE_PASSWORD}-wrong`);
  const unknownId = await attempt(`nobody.${stamp()}`, `${FIXTURE_PASSWORD}-wrong`);

  expect(wrongPassword).toMatch(/not correct/i);
  // Anything that differed would let the form be used to find which Employee IDs exist.
  expect(unknownId).toBe(wrongPassword);
  // One failed attempt is not a lockout, and the message must not claim one.
  expect(wrongPassword).not.toMatch(/lock/i);
  await expectSignedOut(page);
});

test('repeated failures lock the account and the form says so, even for the right password', async ({ page }) => {
  test.setTimeout(240_000);

  // Through the API, which is what a credential-stuffing script would use, and
  // fast. The threshold is the server's; the loop is bounded and asserts that
  // every refusal before the lock is the ordinary one.
  let lockedAfter = 0;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await apiLogin(api_, lockTarget.loginId, `${lockTarget.password}-wrong`);
    if (result.status === 429) {
      expect(errorCodeOf(result.body)).toBe('ACCOUNT_LOCKED');
      lockedAfter = attempt;
      break;
    }
    expect(result.status, `attempt ${attempt} before the lock`).toBe(401);
    expect(errorCodeOf(result.body)).toBe('INVALID_CREDENTIALS');
  }
  expect(lockedAfter, 'twelve wrong passwords never locked the account').toBeGreaterThan(1);

  // The right password does not get in while the lock stands.
  const correct = await apiLogin(api_, lockTarget.loginId, lockTarget.password);
  expect(correct.status).toBe(429);
  expect(correct.body?.access_token).toBeUndefined();

  // And the form tells the person, in words, rather than showing "not correct".
  await skipFirstVisitReload(page);
  await page.goto('/login');
  await page.locator('input#identifier').fill(lockTarget.loginId);
  await page.locator('input#password').fill(lockTarget.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const alert = page.locator('form [role="alert"]');
  await expect(alert).toBeVisible({ timeout: 30000 });
  await expect(alert).toContainText(/temporarily locked/i);
  await expectSignedOut(page);
});

test('an account with an authenticator is asked for its code; a wrong code is refused', async ({ page }) => {
  test.setTimeout(240_000);
  await skipFirstVisitReload(page);
  await page.goto('/login');

  // Password first: no session yet, only a request for the code.
  await page.locator('input#identifier').fill(totpTarget.loginId);
  await page.locator('input#password').fill(totpTarget.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const codeField = page.locator('input#totp-code');
  await expect(codeField).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toHaveCount(0);

  // A wrong code is refused and nobody is signed in.
  await codeField.fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toHaveCount(0);

  // The right code, from a fresh step, signs in. The form clears the password
  // after a failure, so it is typed again.
  await page.locator('input#password').fill(totpTarget.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('input#totp-code')).toBeVisible({ timeout: 30000 });
  await page.locator('input#totp-code').fill(await totpDevice.code());
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toBeVisible({ timeout: 30000 });
});

test('signing out revokes the session on the server, not only in the page', async () => {
  test.setTimeout(120_000);
  const doctor = fixtureStaff('Doctor');
  const token = tokenOf(await apiLogin(api_, doctor.login_id, doctor.password), 'sign in the doctor');

  const before = await api(api_, 'GET', '/api/auth/me', { token });
  expect(before.status).toBe(200);

  const out = await api(api_, 'POST', '/api/auth/logout', { token, data: {} });
  expect(out.status).toBeLessThan(300);

  // The access token is still a valid signature, and is refused anyway.
  const after = await api(api_, 'GET', '/api/auth/me', { token });
  expect(after.status).toBe(401);
});
