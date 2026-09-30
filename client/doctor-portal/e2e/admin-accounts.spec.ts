import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  AdminApi,
  NEW_PASSWORD,
  TotpDevice,
  api,
  apiContext,
  apiLogin,
  apiRedeem,
  enrolTotp,
  errorCodeOf,
  provisionStaff,
  stamp,
  type Throwaway,
} from './identity';
import { answerStepUp, expectSignedOut, settle, signInWithCredentials, signOut } from './support';

/**
 * An administrator's control of other people's accounts, through the screen an
 * administrator actually uses, and what each of those people can then do.
 *
 *   1. create a staff account -> the one-time code is shown once -> the person
 *      activates it at /activate, chooses a password and signs in;
 *   2. reset a credential -> every session the person had ends at once, their
 *      old password stops working, and the new code is the way back in;
 *   3. reset a lost authenticator -> the person signs in with a password alone.
 *
 * These are Class B operations: outside demo mode the API demands a paired
 * authenticator and a fresh code. `AdminApi` (API side) and `answerStepUp` (UI
 * side) meet that demand only when it is made, so this file passes against a
 * demo-mode API and a production-shaped one alike, and the administrator is
 * released from two-factor in `afterAll` either way.
 *
 * Run alone: an administrator sign-in, three provisioned people and a dozen UI
 * calls are well inside the 60-a-minute budget, but not beside another suite.
 */

test.describe.configure({ mode: 'serial' });

const RESET_PASSWORD = 'Another-Long-Passphrase-7';
const CODE_SHAPE = /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

let api_: APIRequestContext;
let admin: AdminApi;
let adminPage: Page;
let resetTarget: Throwaway;
let mfaTarget: Throwaway;
let mfaDevice: TotpDevice;

/** The administrator's code for the UI, or nothing when no authenticator is paired. */
const adminCode = () => admin.uiCode();

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  test.setTimeout(420_000);
  api_ = await apiContext(playwright, testInfo);
  admin = await AdminApi.signIn(api_);

  // Provisioning is privileged, so this is where a production-shaped API makes
  // the administrator pair an authenticator and step up.
  resetTarget = await provisionStaff(api_, admin, 'Nurse');
  mfaTarget = await provisionStaff(api_, admin, 'Pharmacist');
  mfaDevice = await enrolTotp(api_, mfaTarget.token);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  adminPage = await context.newPage();
  await signInWithCredentials(
    adminPage,
    admin.loginId,
    admin.password,
    admin.enrolled() ? async () => (await adminCode()) as string : undefined
  );
});

test.afterAll(async () => {
  await adminPage?.context().close();
  await admin?.release();
  await api_?.dispose();
});

/** One person's card on the user-management list, found by their (unique) name. */
async function userCard(page: Page, name: string): Promise<Locator> {
  await settle(page, '/user-management');
  await page.locator('#user-search').fill(name);
  const card = page
    .locator('div.shadow-sm')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .last();
  await expect(card).toBeVisible({ timeout: 30000 });
  return card;
}

/** Confirm the in-app confirmation dialog, then answer a step-up prompt if one follows. */
async function confirmThenStepUp(page: Page) {
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await answerStepUp(page, adminCode, 5000);
}

test('an administrator creates staff; the code is shown once; the person activates and signs in', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const tag = stamp();
  const loginId = `e2e.ui.${tag}`;
  const name = `E2E Created ${tag}`;

  await settle(adminPage, '/user-management');
  await adminPage.getByRole('button', { name: /^new user$/i }).click();
  await adminPage.locator('#new-user-login-id').fill(loginId);
  await adminPage.locator('#new-user-name').fill(name);
  await adminPage.locator('#new-user-role').selectOption('doctor');
  await adminPage.locator('#new-user-email').fill(`${loginId}@example.test`);
  await adminPage.getByRole('button', { name: /^create user$/i }).click();
  await answerStepUp(adminPage, adminCode, 6000);

  // The code is on the administrator's screen once, with who it is for.
  const codeElement = adminPage.getByTestId('one-time-code');
  await expect(codeElement).toBeVisible({ timeout: 30000 });
  const code = (await codeElement.innerText()).trim();
  expect(code, 'the one-time code has the XXXX-XXXX-XXXX shape the activation form expects').toMatch(CODE_SHAPE);
  await expect(adminPage.getByText(loginId, { exact: false }).first()).toBeVisible();
  await expect(adminPage.getByText(/valid until/i).first()).toBeVisible();

  // Shown once: dismissing it ends it, and nothing on the page brings it back.
  await adminPage.getByRole('button', { name: /i have given it to them/i }).click();
  await expect(codeElement).toHaveCount(0);
  expect(await adminPage.locator('main').innerText()).not.toContain(code);

  // The account waits, pending, until an administrator approves it.
  const card = await userCard(adminPage, name);
  await expect(card).toContainText(/pending/i);
  await card.getByRole('button', { name: /^approve$/i }).click();
  await expect(card).toContainText(/active/i, { timeout: 30000 });

  // The new person, on their own machine: activates with the code, choosing a password.
  const context = await browser.newContext();
  const person = await context.newPage();
  await person.goto('/activate');
  await person.locator('#activate-identifier').fill(loginId);
  await person.locator('#activate-code').fill(code);
  await person.locator('#activate-password').fill(NEW_PASSWORD);
  await person.locator('#activate-confirm').fill(NEW_PASSWORD);
  await person.getByRole('button', { name: /activate and sign in/i }).click();
  await expect(person.getByRole('navigation', { name: /sidebar/i })).toBeVisible({ timeout: 45000 });
  await expect(person).toHaveURL(/\/dashboard/);

  // ...and afterwards signs in the ordinary way with the password they chose.
  await signOut(person);
  await signInWithCredentials(person, loginId, NEW_PASSWORD);
  await expect(person.getByRole('navigation', { name: /sidebar/i })).toBeVisible();
  await context.close();

  // The code was one use. A second redemption is refused as spent.
  const again = await apiRedeem(api_, { identifier: loginId, code, password: NEW_PASSWORD });
  expect(again.status).toBeGreaterThanOrEqual(400);
  expect(errorCodeOf(again.body)).toBe('INVALID_GRANT');
});

test('a credential reset ends every session, stops the old password, and the new code works', async ({
  browser,
}) => {
  test.setTimeout(300_000);

  // The person is signed in in two places before the reset.
  const secondSession = await apiLogin(api_, resetTarget.loginId, resetTarget.password);
  const secondToken = secondSession.body?.access_token as string;
  expect(secondToken, 'the second session could not be opened').toBeTruthy();
  expect((await api(api_, 'GET', '/api/auth/me', { token: resetTarget.token })).status).toBe(200);
  expect((await api(api_, 'GET', '/api/auth/me', { token: secondToken })).status).toBe(200);

  const card = await userCard(adminPage, resetTarget.name);
  await card.getByRole('button', { name: 'Reset credential' }).click();
  await confirmThenStepUp(adminPage);

  const codeElement = adminPage.getByTestId('one-time-code');
  await expect(codeElement).toBeVisible({ timeout: 30000 });
  await expect(adminPage.getByText(/one-time reset code/i)).toBeVisible();
  const code = (await codeElement.innerText()).trim();
  expect(code).toMatch(CODE_SHAPE);

  // Both sessions ended at once, on the server, not at their next refresh.
  expect((await api(api_, 'GET', '/api/auth/me', { token: resetTarget.token })).status).toBe(401);
  expect((await api(api_, 'GET', '/api/auth/me', { token: secondToken })).status).toBe(401);

  // The old password no longer works: the reset is the only way back in.
  const oldPassword = await apiLogin(api_, resetTarget.loginId, resetTarget.password);
  expect(oldPassword.status).toBe(401);
  expect(oldPassword.body?.access_token).toBeUndefined();

  // The person redeems the new code, choosing a password, in the browser.
  const context = await browser.newContext();
  const person = await context.newPage();
  await person.goto('/activate');
  await person.locator('#activate-identifier').fill(resetTarget.loginId);
  await person.locator('#activate-code').fill(code);
  await person.locator('#activate-password').fill(RESET_PASSWORD);
  await person.locator('#activate-confirm').fill(RESET_PASSWORD);
  await person.getByRole('button', { name: /activate and sign in/i }).click();
  await expect(person.getByRole('navigation', { name: /sidebar/i })).toBeVisible({ timeout: 45000 });
  await context.close();

  // The new password works and the one the person had before still does not.
  expect((await apiLogin(api_, resetTarget.loginId, RESET_PASSWORD)).status).toBe(200);
  expect((await apiLogin(api_, resetTarget.loginId, resetTarget.password)).status).toBe(401);

  // Nobody can redeem the same reset code twice.
  const replay = await apiRedeem(api_, {
    identifier: resetTarget.loginId,
    code,
    password: `${RESET_PASSWORD}-again`,
  });
  expect(errorCodeOf(replay.body)).toBe('INVALID_GRANT');
});

test('an administrator resets a lost authenticator and the person signs in with a password alone', async () => {
  test.setTimeout(300_000);

  // Before: the password alone is not enough.
  const before = await apiLogin(api_, mfaTarget.loginId, mfaTarget.password);
  expect(before.body?.access_token, 'an account with an authenticator was let in without its code').toBeUndefined();
  expect(before.body?.mfa_required === true || before.status === 401 || before.status === 403).toBe(true);
  // With the paired device it does work, which is what makes the reset a real remedy.
  expect((await apiLogin(api_, mfaTarget.loginId, mfaTarget.password, await mfaDevice.code())).status).toBe(200);

  const card = await userCard(adminPage, mfaTarget.name);
  await card.getByRole('button', { name: 'Reset two-factor authentication' }).click();
  await confirmThenStepUp(adminPage);
  await expect(adminPage.getByText(/two-factor authentication removed for/i)).toBeVisible({ timeout: 30000 });

  // After: a password alone is a sign-in, and the account reports no authenticator.
  const after = await apiLogin(api_, mfaTarget.loginId, mfaTarget.password);
  expect(after.status).toBe(200);
  const token = after.body?.access_token as string;
  expect(token).toBeTruthy();
  const status = await api(api_, 'GET', '/api/auth/mfa/status', { token });
  expect(status.status).toBe(200);
  expect(status.body?.enrolled ?? status.body?.enabled).toBe(false);
});

test('a person the administrator suspends can no longer sign in', async ({ browser }) => {
  test.setTimeout(240_000);
  const target = await provisionStaff(api_, admin, 'LabTechnician');
  expect((await apiLogin(api_, target.loginId, target.password)).status).toBe(200);

  const card = await userCard(adminPage, target.name);
  await card.getByRole('button', { name: /^suspend$/i }).click();
  await expect(card).toContainText(/suspended/i, { timeout: 30000 });

  // Refused with the same generic answer as a wrong password: the form must not
  // reveal that the account exists but is suspended.
  const refused = await apiLogin(api_, target.loginId, target.password);
  expect(refused.status).toBe(401);
  expect(errorCodeOf(refused.body)).toBe('INVALID_CREDENTIALS');

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('input#identifier').fill(target.loginId);
  await page.locator('input#password').fill(target.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText(/not correct/i, { timeout: 30000 });
  await expectSignedOut(page);
  await context.close();
});
