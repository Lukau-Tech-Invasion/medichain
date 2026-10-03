import { test, expect } from '@playwright/test';
import { api, readFixtures } from '../../doctor-portal/e2e/identity';
import { retiredTermsOnPage, expectSignedOut } from './support';

/**
 * The wallet is gone from the patient's side too.
 *
 * Before ADR-0010 a patient could "Create Demo Wallet" or sign in with a
 * recovery phrase, and the browser kept the wallet in `medichain_wallet`. Now a
 * patient has a username and a password chosen at activation and nothing else.
 * This proves it in three places: the sign-in and activation screens offer no
 * wallet and use no wallet words; what an earlier build left in `localStorage`
 * is removed on load and signs nobody in; and the API no longer takes a wallet
 * header as a person.
 *
 * Runs on both projects: the phone is where the sign-in screen is most often seen.
 */

/** A well-formed SS58 address: what a wallet account id used to look like. */
const SS58_LOOKALIKE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

test('sign-in and activation offer no wallet, phrase or demo account', async ({ page }) => {
  for (const path of ['/login', '/activate']) {
    await page.goto(path);
    await page.locator('form').first().waitFor({ state: 'visible', timeout: 20000 });

    expect(await retiredTermsOnPage(page), `${path} still uses retired wording`).toEqual([]);
    await expect(page.locator('textarea'), `${path} has a phrase box`).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /wallet|recovery|phrase|import|create demo|create & login|seed/i }),
      `${path} offers a wallet-shaped control`
    ).toHaveCount(0);
  }

  // The sign-in form is exactly a username and a password.
  await page.goto('/login');
  await expect(page.locator('input#username')).toBeVisible();
  await expect(page.locator('input#password')).toBeVisible();
  await expect(page.locator('form input:visible')).toHaveCount(2);
  // There is a way to activate, and it says an activation code, not a key.
  await expect(page.getByRole('link', { name: /activation code/i })).toBeVisible();
});

test('what an earlier build left in localStorage is purged and signs nobody in', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input#username').waitFor({ state: 'visible', timeout: 20000 });

  await page.evaluate((address) => {
    localStorage.setItem('medichain_wallet', JSON.stringify({ address, seed: 'stale' }));
    localStorage.setItem('medichain_accounts', JSON.stringify([{ address }]));
    localStorage.setItem('chain_head', '12345');
    localStorage.setItem(
      'medichain_patient_auth',
      JSON.stringify({ address, healthId: 'PAT-STALE', name: 'Stale Patient' })
    );
    localStorage.setItem(
      'medichain-patient-auth',
      JSON.stringify({
        state: { patient: { address, healthId: 'PAT-STALE', fullName: 'Stale Patient' }, isAuthenticated: true },
        version: 1,
      })
    );
  }, SS58_LOOKALIKE);

  await page.reload();
  await page.locator('input#username').waitFor({ state: 'visible', timeout: 20000 });

  const left = await page.evaluate(() => ({
    wallet: localStorage.getItem('medichain_wallet'),
    accounts: localStorage.getItem('medichain_accounts'),
    chain: localStorage.getItem('chain_head'),
    session: localStorage.getItem('medichain_patient_auth'),
  }));
  expect(left.wallet, 'medichain_wallet survived the load').toBeNull();
  expect(left.accounts, 'medichain_accounts survived the load').toBeNull();
  expect(left.chain, 'a chain_* key survived the load').toBeNull();
  expect(left.session, 'an address-shaped patient session survived the load').toBeNull();

  // None of it signed anyone in.
  await page.goto('/dashboard');
  await expectSignedOut(page);
});

test('a request that names a patient by header alone is refused', async ({ request }) => {
  const patient = readFixtures().patient;

  for (const claimed of [SS58_LOOKALIKE, 'PAT-STALE', patient.user_id]) {
    const read = await api(request, 'GET', '/api/auth/me', { headers: { 'X-User-Id': claimed } }); // identity-header-negative-assertion
    expect(read.status, `GET /api/auth/me as X-User-Id: ${claimed}`).toBe(401); // identity-header-negative-assertion
    const records = await api(request, 'GET', '/api/patients', { headers: { 'X-User-Id': claimed } }); // identity-header-negative-assertion
    expect(records.status, `GET /api/patients as X-User-Id: ${claimed}`).toBe(401); // identity-header-negative-assertion
  }
});
