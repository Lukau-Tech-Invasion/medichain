import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  AdminApi,
  NEW_PASSWORD,
  api,
  apiContext,
  apiLogin,
  provisionStaff,
  tokenOf,
  type Throwaway,
} from './identity';
import { settle, signInWithCredentials, signOut } from './support';

/**
 * A clinician changes their own password from Settings.
 *
 * The dialog needs the CURRENT password: both are stretched in the browser into
 * proofs, only the proofs are sent, and the server checks the current one against
 * its verifier, stores a verifier for the new one, and ends every OTHER session.
 * Someone who has forgotten their password does not come here; an administrator
 * issues a reset code (see admin-accounts.spec.ts).
 *
 * The person is a throwaway created for this file. Changing a fixture's password
 * would lock every other suite out of it.
 */

test.describe.configure({ mode: 'serial' });

const CHANGED_PASSWORD = 'A-Different-Long-Passphrase-3';

let api_: APIRequestContext;
let admin: AdminApi;
let person: Throwaway;

test.beforeAll(async ({ playwright }, testInfo) => {
  test.setTimeout(300_000);
  api_ = await apiContext(playwright, testInfo);
  admin = await AdminApi.signIn(api_);
  person = await provisionStaff(api_, admin, 'Doctor');
  // The administrator is not needed again; leave two-factor as it was found.
  await admin.release();
});

test.afterAll(async () => {
  await api_?.dispose();
});

test('the dialog refuses a wrong current password, a short or mismatched new one, and a repeat', async ({ page }) => {
  test.setTimeout(240_000);
  await signInWithCredentials(page, person.loginId, person.password);
  await settle(page, '/settings');
  await page.getByRole('button', { name: /security/i }).first().click();
  await page.getByRole('button', { name: /^change password$/i }).click();

  const alert = page.getByRole('alert');
  const submit = page.getByRole('button', { name: /^change password$/i }).last();

  // Client-side rules first: nothing is sent for these.
  await page.locator('#pw-current').fill(person.password);
  await page.locator('#pw-new').fill('short');
  await page.locator('#pw-confirm').fill('short');
  await submit.click();
  await expect(alert).toContainText(/at least 12 characters/i);

  await page.locator('#pw-new').fill(CHANGED_PASSWORD);
  await page.locator('#pw-confirm').fill(`${CHANGED_PASSWORD}-typo`);
  await submit.click();
  await expect(alert).toContainText(/do not match/i);

  await page.locator('#pw-new').fill(person.password);
  await page.locator('#pw-confirm').fill(person.password);
  await submit.click();
  await expect(alert).toContainText(/different from your current/i);

  // The server refuses a wrong current password, and says the password was not changed.
  await page.locator('#pw-current').fill(`${person.password}-wrong`);
  await page.locator('#pw-new').fill(CHANGED_PASSWORD);
  await page.locator('#pw-confirm').fill(CHANGED_PASSWORD);
  await submit.click();
  await expect(alert).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/your password has been changed/i)).toHaveCount(0);

  // Nothing above changed anything: the original password still signs in.
  expect((await apiLogin(api_, person.loginId, person.password)).status).toBe(200);
});

test('changing it works, ends the other sessions, and the old password stops', async ({ page }) => {
  test.setTimeout(240_000);

  // A second session, which the change must end.
  const other = tokenOf(await apiLogin(api_, person.loginId, person.password), 'open a second session');
  expect((await api(api_, 'GET', '/api/auth/me', { token: other })).status).toBe(200);

  await signInWithCredentials(page, person.loginId, person.password);
  await settle(page, '/settings');
  await page.getByRole('button', { name: /security/i }).first().click();
  await page.getByRole('button', { name: /^change password$/i }).click();

  await page.locator('#pw-current').fill(person.password);
  await page.locator('#pw-new').fill(CHANGED_PASSWORD);
  await page.locator('#pw-confirm').fill(CHANGED_PASSWORD);
  await page.getByRole('button', { name: /^change password$/i }).last().click();
  await expect(page.getByText(/your password has been changed/i)).toBeVisible({ timeout: 45000 });
  await page.getByRole('button', { name: /^close$/i }).last().click();

  // The other session is ended on the server; this one, which made the change, continues.
  expect((await api(api_, 'GET', '/api/auth/me', { token: other })).status).toBe(401);
  await settle(page, '/dashboard');
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toBeVisible();

  // The old password no longer signs in; the new one does.
  const old = await apiLogin(api_, person.loginId, person.password);
  expect(old.status).toBe(401);
  expect(old.body?.access_token).toBeUndefined();
  expect((await apiLogin(api_, person.loginId, CHANGED_PASSWORD)).status).toBe(200);

  // And through the form, after signing out.
  await signOut(page);
  await signInWithCredentials(page, person.loginId, CHANGED_PASSWORD);
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toBeVisible();
});

test('the original password chosen at activation is not remembered anywhere', async ({ page }) => {
  test.setTimeout(120_000);
  // Sign in form, old password: the generic refusal, nothing more.
  await page.goto('/login');
  await page.locator('input#identifier').fill(person.loginId);
  await page.locator('input#password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('form [role="alert"]')).toContainText(/not correct/i, { timeout: 30000 });
});
