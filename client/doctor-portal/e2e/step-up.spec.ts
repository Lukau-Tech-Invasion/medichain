import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  AdminApi,
  TotpDevice,
  api,
  apiContext,
  enrolTotp,
  errorCodeOf,
  provisionStaff,
  stamp,
  stepUp,
  type Throwaway,
} from './identity';
import { deriveAuthProof } from '../../shared/src/auth/proof';
import { settle, signInWithCredentials } from './support';

/**
 * Step-up: how a privileged action asks the person to prove it is them, again.
 *
 *   * Class B -- a session that is not freshly verified is asked for a code from
 *     its authenticator before an administrator-grade action (creating staff,
 *     resetting a credential, assigning a role). The action is HELD while the
 *     dialog is up and runs once, after a good code.
 *   * Class C -- authorising one exact request. The challenge names the factor:
 *     the authenticator's code when there is one, the account password when
 *     there is not. Nothing in the portals calls Class C yet (see the coverage
 *     map), so it is proved over the API, where it is real.
 *
 * # Demo mode
 *
 * The Class B gate is exempt when the API runs with `IS_DEMO=true`, which is how
 * `scripts/run-browser-e2e-api.sh` starts it: there the dialog can never appear,
 * and the UI tests below assert the action simply succeeds and record that they
 * ran on the exempt path. Set `E2E_STEP_UP_ENFORCED=1` when the API under test
 * is not in demo mode and the dialog MUST appear; a missing dialog then fails.
 *
 * Ordering matters, and is why this file is serial: the administrator signs in
 * to the browser FIRST, while not enrolled, so that session carries no
 * verified-second-factor claim. Only then is the administrator enrolled (by the
 * first provisioning call), which is what makes the next privileged action ask.
 */

test.describe.configure({ mode: 'serial' });

const ENFORCED = process.env.E2E_STEP_UP_ENFORCED === '1';

let api_: APIRequestContext;
let admin: AdminApi;
let adminPage: Page;
let target: Throwaway;
let classUser: Throwaway;
let classUserDevice: TotpDevice;

test.beforeAll(async ({ browser, playwright }, testInfo) => {
  test.setTimeout(420_000);
  api_ = await apiContext(playwright, testInfo);
  admin = await AdminApi.signIn(api_);

  // Signed in to the browser before any enrolment: no second-factor claim.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  adminPage = await context.newPage();
  await signInWithCredentials(adminPage, admin.loginId, admin.password);
});

test.afterAll(async () => {
  await adminPage?.context().close();
  await admin?.release();
  await api_?.dispose();
});

/** The step-up dialog, when it is showing. */
const stepUpDialog = (page: Page) => page.getByRole('dialog').filter({ hasText: /confirm it is you/i });

test('an administrator with no authenticator is told to enrol, not asked for a code', async () => {
  test.setTimeout(180_000);
  const loginId = `e2e.enrol.${stamp()}`;

  await settle(adminPage, '/user-management');
  await adminPage.getByRole('button', { name: /^new user$/i }).click();
  await adminPage.locator('#new-user-login-id').fill(loginId);
  await adminPage.locator('#new-user-name').fill(`E2E Enrol ${loginId}`);
  await adminPage.locator('#new-user-email').fill(`${loginId}@example.test`);
  await adminPage.getByRole('button', { name: /^create user$/i }).click();

  const dialog = stepUpDialog(adminPage);
  const panel = adminPage.getByTestId('one-time-code');
  const outcome = await Promise.race([
    dialog.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'dialog' as const),
    panel.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'created' as const),
  ]).catch(() => 'nothing' as const);

  if (outcome === 'dialog') {
    // Enrolment, not a code: a code cannot fix "no authenticator" and asking
    // for one would be a dead end dressed as a prompt.
    await expect(dialog).toContainText(/none is set up|set it up in settings/i);
    await expect(dialog.locator('#step-up-code')).toHaveCount(0);
    await dialog.getByRole('button', { name: /^close$/i }).click();
    await expect(dialog).toHaveCount(0);
    test.info().annotations.push({ type: 'path', description: 'Class B enforced: enrolment demanded' });
    return;
  }

  expect(
    ENFORCED,
    'E2E_STEP_UP_ENFORCED=1 but the privileged action ran with no step-up demanded at all'
  ).toBe(false);
  expect(outcome, 'neither a step-up dialog nor the created account appeared').toBe('created');
  test.info().annotations.push({
    type: 'path',
    description: 'Class B exempt (demo-mode API): the action succeeded without a prompt',
  });
});

test('a privileged action is held until a good code is given, then runs once', async () => {
  test.setTimeout(420_000);

  // From here the administrator is enrolled, so the browser session -- signed in
  // before that -- is no longer sufficient. Provisioning enrols on the API side.
  target = await provisionStaff(api_, admin, 'Nurse');
  await admin.ensureEnrolled();

  // The previous case leaves this SPA on User Management. Re-enter it so its
  // directory fetch includes the account just provisioned through the API.
  await settle(adminPage, '/dashboard');
  await settle(adminPage, '/user-management');
  await adminPage.locator('#user-search').fill(target.name);
  const card = adminPage
    .locator('div.shadow-sm')
    .filter({ has: adminPage.getByRole('heading', { name: target.name, exact: true }) })
    .last();
  await expect(card).toBeVisible({ timeout: 30000 });
  await card.getByRole('button', { name: 'Reset credential' }).click();
  await adminPage.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();

  const dialog = stepUpDialog(adminPage);
  const panel = adminPage.getByTestId('one-time-code');
  const outcome = await Promise.race([
    dialog.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'dialog' as const),
    panel.waitFor({ state: 'visible', timeout: 20000 }).then(() => 'ran' as const),
  ]).catch(() => 'nothing' as const);

  if (outcome === 'ran') {
    expect(ENFORCED, 'E2E_STEP_UP_ENFORCED=1 but no step-up was demanded').toBe(false);
    test.info().annotations.push({
      type: 'path',
      description: 'Class B exempt (demo-mode API): the reset ran without a prompt',
    });
    return;
  }
  expect(outcome, 'neither the step-up dialog nor the reset code appeared').toBe('dialog');

  // The action is HELD: no code exists yet, so nothing has been reset.
  await expect(dialog).toContainText(/six-digit code/i);
  await expect(panel).toHaveCount(0);

  // A wrong code is refused inside the dialog, which stays up.
  await dialog.locator('#step-up-code').fill('000000');
  await dialog.getByRole('button', { name: /^confirm$/i }).click();
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 30000 });
  await expect(panel).toHaveCount(0);

  // A good code releases the held action, exactly once.
  await dialog.locator('#step-up-code').fill((await admin.uiCode()) as string);
  await dialog.getByRole('button', { name: /^confirm$/i }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(adminPage.getByTestId('one-time-code')).toHaveCount(1);
  test.info().annotations.push({ type: 'path', description: 'Class B enforced: held, refused, released' });
});

test('Class C over the API asks for the password when there is no authenticator', async () => {
  test.setTimeout(240_000);
  classUser = await provisionStaff(api_, admin, 'Doctor');

  const challenge = await api(api_, 'POST', '/api/auth/transaction/challenge', {
    token: classUser.token,
    data: { action: 'e2e.probe', method: 'POST', path: '/api/e2e/probe' },
  });
  expect(challenge.status).toBe(200);
  const issued = challenge.body?.challenge ?? challenge.body;
  expect(issued.required_factor, 'no authenticator, so the password is the factor').toBe('password');
  expect(String(issued.challenge_id)).toBeTruthy();

  // The wrong password is refused.
  const wrongProof = await deriveAuthProof(`${classUser.password}-wrong`, classUser.loginId);
  const wrong = await api(api_, 'POST', '/api/auth/transaction/verify', {
    token: classUser.token,
    data: { challenge_id: issued.challenge_id, auth_proof: wrongProof },
  });
  expect(wrong.status).toBeGreaterThanOrEqual(400);

  // The right one authorises it -- and only once.
  const proof = await deriveAuthProof(classUser.password, classUser.loginId);
  const fresh = await api(api_, 'POST', '/api/auth/transaction/challenge', {
    token: classUser.token,
    data: { action: 'e2e.probe', method: 'POST', path: '/api/e2e/probe' },
  });
  const freshIssued = fresh.body?.challenge ?? fresh.body;
  const good = await api(api_, 'POST', '/api/auth/transaction/verify', {
    token: classUser.token,
    data: { challenge_id: freshIssued.challenge_id, auth_proof: proof },
  });
  expect(good.status).toBe(200);
  expect(good.body?.success).toBe(true);

  const replay = await api(api_, 'POST', '/api/auth/transaction/verify', {
    token: classUser.token,
    data: { challenge_id: freshIssued.challenge_id, auth_proof: proof },
  });
  expect(replay.status, 'a challenge authorised a second request').toBeGreaterThanOrEqual(400);

  // A challenge cannot be completed with the wrong kind of evidence.
  const third = await api(api_, 'POST', '/api/auth/transaction/challenge', {
    token: classUser.token,
    data: { action: 'e2e.probe', method: 'POST', path: '/api/e2e/probe' },
  });
  const thirdIssued = third.body?.challenge ?? third.body;
  const wrongKind = await api(api_, 'POST', '/api/auth/transaction/verify', {
    token: classUser.token,
    data: { challenge_id: thirdIssued.challenge_id, code: '123456' },
  });
  expect(wrongKind.status).toBeGreaterThanOrEqual(400);
});

test('Class B over the API: assurance rises with a code, and Class C then asks for it', async () => {
  test.setTimeout(300_000);
  classUser = await provisionStaff(api_, admin, 'Doctor');
  classUserDevice = await enrolTotp(api_, classUser.token);

  // Enrolled but not stepped up: the session is not elevated.
  const before = await api(api_, 'GET', '/api/auth/assurance', { token: classUser.token });
  expect(before.status).toBe(200);
  expect(before.body?.class_a).toBe(true);
  expect(before.body?.class_b).toBe(false);

  // A code raises it. The new token is what carries the elevation.
  const elevated = await stepUp(api_, classUser.token, classUserDevice);
  const after = await api(api_, 'GET', '/api/auth/assurance', { token: elevated });
  expect(after.body?.class_b).toBe(true);

  // With an authenticator paired, a Class C challenge names the code, not the password.
  const challenge = await api(api_, 'POST', '/api/auth/transaction/challenge', {
    token: elevated,
    data: { action: 'e2e.probe', method: 'POST', path: '/api/e2e/probe' },
  });
  expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
  const issued = challenge.body?.challenge ?? challenge.body;
  expect(issued.required_factor).toBe('totp');

  const wrong = await api(api_, 'POST', '/api/auth/transaction/verify', {
    token: elevated,
    data: { challenge_id: issued.challenge_id, code: '000000' },
  });
  expect(wrong.status).toBeGreaterThanOrEqual(400);

  const good = await api(api_, 'POST', '/api/auth/transaction/verify', {
    token: elevated,
    data: { challenge_id: issued.challenge_id, code: await classUserDevice.code() },
  });
  expect(good.status).toBe(200);
  expect(good.body?.success).toBe(true);
});

test('a session that has ended cannot be stepped up or authorised', async () => {
  test.setTimeout(120_000);
  const out = await api(api_, 'POST', '/api/auth/logout', { token: classUser.token, data: {} });
  expect(out.status).toBeLessThan(300);

  const challenge = await api(api_, 'POST', '/api/auth/transaction/challenge', {
    token: classUser.token,
    data: { action: 'e2e.probe', method: 'POST', path: '/api/e2e/probe' },
  });
  expect(challenge.status).toBe(401);
  expect(['SESSION_REVOKED', 'SESSION_REQUIRED', 'UNAUTHORIZED']).toContain(errorCodeOf(challenge.body));
});
