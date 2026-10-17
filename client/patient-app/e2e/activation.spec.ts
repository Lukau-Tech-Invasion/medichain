import { portalPath } from '../../doctor-portal/e2e/portal-path';
import { test, expect, type Page } from '@playwright/test';
import {
  apiRedeem,
  fixtureStaff,
  fixtureToken,
  registerPatientViaApi,
  stamp,
} from '../../doctor-portal/e2e/identity';
import { expectSignedOut, signInWithCredentials, signOut } from './support';

/**
 * Patient activation: the one-time code from the clinic becomes a username and
 * password, chosen by the patient and known to nobody else.
 *
 * The code and the patient's id come from a real registration -- a fixture doctor
 * registers a patient through the API, the same call the doctor portal's
 * registration screen makes (its screen is proved in the doctor portal's
 * `patient-activation.spec.ts`). The patient then does what a patient does: opens
 * /activate, types the id, the code, a username and a password, and is signed in.
 *
 * What this cannot cover in a browser: an EXPIRED code. Codes live 72 hours and
 * the clock that expires them is the server's, so expiry is proved in the API's
 * own tests, not here. The refusal a patient sees for an expired code is the same
 * INVALID_GRANT message asserted below for a spent one.
 *
 * Both phone and desktop projects run validation, activation and sign-in flows
 * serially, using a separate new patient for each account-creating case.
 */

const PASSWORD = 'Patient-Long-Passphrase-5';
const INVALID_GRANT_MESSAGE = /not valid, has expired, or was already used/i;

/** Type the activation form. Fields not given are left empty. */
async function fillActivation(
  page: Page,
  values: { patientId?: string; code?: string; username?: string; password?: string; confirm?: string }
) {
  if (values.patientId !== undefined) await page.locator('#activate-identifier').fill(values.patientId);
  if (values.code !== undefined) await page.locator('#activate-code').fill(values.code);
  if (values.username !== undefined) await page.locator('#activate-username').fill(values.username);
  if (values.password !== undefined) await page.locator('#activate-password').fill(values.password);
  if (values.confirm !== undefined) await page.locator('#activate-confirm').fill(values.confirm);
}

const submit = (page: Page) => page.getByRole('button', { name: /activate and sign in/i });

test('the form checks the password and the code before anything is sent', async ({ page }) => {
  const redemptions: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/auth/credentials/redeem')) redemptions.push(request.url());
  });

  await page.goto(portalPath('/activate'));
  await expect(page.locator('#activate-identifier')).toBeVisible({ timeout: 20000 });

  // The submit button waits for every field.
  await expect(submit(page)).toBeDisabled();

  // The code is normalised as it is typed: upper case, look-alikes folded, grouped.
  await page.locator('#activate-code').fill('abcdefgh1234');
  await expect(page.locator('#activate-code')).toHaveValue('ABCD-EFGH-1234');
  await page.locator('#activate-code').fill('ABCDOIL01234');
  await expect(page.locator('#activate-code')).toHaveValue('ABCD-0110-1234');

  // A short password is refused here: the server only ever sees a proof, so
  // this is the one place its length can be checked.
  await fillActivation(page, {
    patientId: 'PAT-DOES-NOT-MATTER',
    username: 'e2e.validate',
    password: 'short',
    confirm: 'short',
  });
  await submit(page).click();
  await expect(page.getByRole('alert')).toContainText(/at least 12 characters/i);

  await fillActivation(page, { password: PASSWORD, confirm: `${PASSWORD}-different` });
  await submit(page).click();
  await expect(page.getByRole('alert')).toContainText(/do not match/i);

  expect(redemptions, 'a request was sent for a form that failed its own checks').toEqual([]);
});

test.describe('activation and first sign-in', () => {
  test.describe.configure({ mode: 'serial' });

  test('a code, a patient id, a username and a password sign the patient in', async ({ page, request }) => {
    test.setTimeout(240_000);
    const doctorToken = await fixtureToken(request, fixtureStaff('Doctor'));
    const registered = await registerPatientViaApi(request, doctorToken, 'Activation Journey');
    const username = `e2e.act.${stamp()}`;

    await page.goto(portalPath('/activate'));
    await fillActivation(page, {
      patientId: registered.patientId,
      code: registered.activationCode,
      username,
      password: PASSWORD,
      confirm: PASSWORD,
    });
    await submit(page).click();

    await page.locator('main').first().waitFor({ state: 'visible', timeout: 45000 });
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30000 });

    // A session survives a reload (the refresh cookie), and signing out ends it.
    await page.reload();
    await page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
    await expect(page).toHaveURL(/\/dashboard/);
    await signOut(page);
    await page.reload();
    await expectSignedOut(page);

    // Then the ordinary way in: the username and password they chose.
    await signInWithCredentials(page, username, PASSWORD);
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('a spent code, a wrong code and an unknown patient are refused with one message', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const doctorToken = await fixtureToken(request, fixtureStaff('Doctor'));
    const registered = await registerPatientViaApi(request, doctorToken, 'Activation Refusals');
    const tag = stamp();

    await page.goto(portalPath('/activate'));
    const refused = async (values: Parameters<typeof fillActivation>[1]) => {
      await fillActivation(page, values);
      await submit(page).click();
      await expect(page.getByRole('alert')).toContainText(INVALID_GRANT_MESSAGE, { timeout: 30000 });
      await expect(page).toHaveURL(/\/activate/);
    };

    // A code that was never issued.
    await refused({
      patientId: registered.patientId,
      code: 'ZZZZ-ZZZZ-ZZZZ',
      username: `e2e.wrong.${tag}`,
      password: PASSWORD,
      confirm: PASSWORD,
    });

    // A patient id that does not exist: the same words, so ids cannot be probed.
    await refused({
      patientId: `PAT-NO-SUCH-${tag}`,
      code: registered.activationCode,
      username: `e2e.unknown.${tag}`,
      password: PASSWORD,
      confirm: PASSWORD,
    });

    // The real code works once...
    await fillActivation(page, {
      patientId: registered.patientId,
      code: registered.activationCode,
      username: `e2e.first.${tag}`,
      password: PASSWORD,
      confirm: PASSWORD,
    });
    await submit(page).click();
    await page.locator('main').first().waitFor({ state: 'visible', timeout: 45000 });
    await signOut(page);

    // ...and is spent: presented again it is refused in the same words.
    await page.goto(portalPath('/activate'));
    await refused({
      patientId: registered.patientId,
      code: registered.activationCode,
      username: `e2e.second.${tag}`,
      password: PASSWORD,
      confirm: PASSWORD,
    });
  });

  test('a taken or unacceptable username is said so in words, and the code is not burned', async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const doctorToken = await fixtureToken(request, fixtureStaff('Doctor'));
    const first = await registerPatientViaApi(request, doctorToken, 'Activation Names A');
    const second = await registerPatientViaApi(request, doctorToken, 'Activation Names B');
    const taken = `e2e.taken.${stamp()}`;

    // Patient A takes the username.
    const a = await apiRedeem(request, {
      identifier: first.patientId,
      code: first.activationCode,
      username: taken,
      password: PASSWORD,
    });
    expect(a.status).toBe(200);

    // Patient B asks for it and is told, in words, to choose another.
    await page.goto(portalPath('/activate'));
    await fillActivation(page, {
      patientId: second.patientId,
      code: second.activationCode,
      username: taken,
      password: PASSWORD,
      confirm: PASSWORD,
    });
    await submit(page).click();
    await expect(page.getByRole('alert')).toContainText(/already taken/i, { timeout: 30000 });

    // A username the rules refuse.
    await fillActivation(page, { username: 'a!', password: PASSWORD, confirm: PASSWORD });
    await submit(page).click();
    await expect(page.getByRole('alert')).toContainText(/valid username|not allowed/i, { timeout: 30000 });

    // Neither refusal spent B's code: a good username still activates.
    await fillActivation(page, { username: `e2e.free.${stamp()}`, password: PASSWORD, confirm: PASSWORD });
    await submit(page).click();
    await page.locator('main').first().waitFor({ state: 'visible', timeout: 45000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
