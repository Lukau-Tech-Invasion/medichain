import { portalPath } from './portal-path';
import { test, expect } from '@playwright/test';
import { api, apiLogin, errorCodeOf, fixtureStaff, retiredTermsIn, tokenOf } from './identity';
import { retiredTermsOnPage, skipFirstVisitReload } from './support';

/**
 * The wallet is gone, and nothing about it works any more.
 *
 * Wallet identity ended in ADR-0010: no sr25519 keys, no recovery phrase, no
 * identity-header-negative-assertion: the old header is tested only to prove refusal.
 * SS58 address as an account id, and no `X-User-Id` header as a way of saying
 * who you are. This proves it from the outside, in the three places a leftover
 * would show:
 *
 *   * the screens -- nothing on sign-in or activation offers a wallet or asks for
 *     a phrase, and no page says so in words;
 *   * the browser -- what an earlier build left in `localStorage` is removed on
 *     load and signs nobody in;
 *   * the API -- a request that names a user by header alone is refused, and the
 *     endpoints that issued wallet sessions do not exist.
 *
 * The API checks carry a valid bearer where they can, so a 404 means the route
 * is gone rather than that authentication ran first.
 */

/** A well-formed SS58 address: what a wallet account id used to look like. */
const SS58_LOOKALIKE = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

test('sign-in and activation offer no wallet, phrase or key', async ({ page }) => {
  test.setTimeout(90_000);
  await skipFirstVisitReload(page);

  for (const path of ['/login', '/activate']) {
    await page.goto(portalPath(path));
    await page.locator('form').first().waitFor({ state: 'visible', timeout: 20000 });

    expect(await retiredTermsOnPage(page), `${path} still uses retired wording`).toEqual([]);

    // No phrase box, no "create a wallet" button, no import-key control.
    await expect(page.locator('textarea'), `${path} has a multi-line phrase box`).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /wallet|recovery|phrase|import|create demo|seed/i }),
      `${path} offers a wallet-shaped control`
    ).toHaveCount(0);
  }

  // The sign-in form is exactly an Employee ID and a password.
  await page.goto(portalPath('/login'));
  await expect(page.locator('input#identifier')).toBeVisible();
  await expect(page.locator('input#password')).toBeVisible();
  await expect(page.locator('form input:visible')).toHaveCount(2);
});

test('what an earlier build left in localStorage is purged and signs nobody in', async ({ page }) => {
  test.setTimeout(90_000);
  await skipFirstVisitReload(page);
  await page.goto(portalPath('/login'));
  await page.locator('input#identifier').waitFor({ state: 'visible', timeout: 20000 });

  // The old world's residue: the wallet, its account list, a chain cache key, a
  // provider session that identifies the person by an `address`, and the
  // persisted store an older build wrote in that shape.
  await page.evaluate((address) => {
    localStorage.setItem('medichain_wallet', JSON.stringify({ address, seed: 'stale' }));
    localStorage.setItem('medichain_accounts', JSON.stringify([{ address }]));
    localStorage.setItem('chain_head', '12345');
    localStorage.setItem(
      'medichain_provider_auth',
      JSON.stringify({ address, role: 'Doctor', name: 'Dr Stale' })
    );
    localStorage.setItem(
      'medichain-provider-auth',
      JSON.stringify({
        state: { user: { address, username: 'Dr Stale', role: 'Doctor' }, isAuthenticated: true },
        version: 3,
      })
    );
  }, SS58_LOOKALIKE);

  await page.reload();
  await page.locator('input#identifier').waitFor({ state: 'visible', timeout: 20000 });

  const left = await page.evaluate(() => ({
    wallet: localStorage.getItem('medichain_wallet'),
    accounts: localStorage.getItem('medichain_accounts'),
    chain: localStorage.getItem('chain_head'),
    provider: localStorage.getItem('medichain_provider_auth'),
  }));
  expect(left.wallet, 'medichain_wallet survived the load').toBeNull();
  expect(left.accounts, 'medichain_accounts survived the load').toBeNull();
  expect(left.chain, 'a chain_* key survived the load').toBeNull();
  expect(left.provider, 'an address-shaped provider session survived the load').toBeNull();

  // And none of it signed anyone in: a protected route sends the visitor to sign-in.
  await page.goto(portalPath('/dashboard'));
  await expect(page.locator('input#identifier')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toHaveCount(0);
});

test('a request that names a user by header alone is refused', async ({ request }) => {
  const doctor = fixtureStaff('Doctor');

  for (const claimed of [doctor.user_id, SS58_LOOKALIKE]) {
    const read = await api(request, 'GET', '/api/auth/me', { headers: { 'X-User-Id': claimed } }); // identity-header-negative-assertion
    expect(read.status, `GET /api/auth/me as X-User-Id: ${claimed}`).toBe(401); // identity-header-negative-assertion

    const list = await api(request, 'GET', '/api/patients', { headers: { 'X-User-Id': claimed } }); // identity-header-negative-assertion
    expect(list.status, `GET /api/patients as X-User-Id: ${claimed}`).toBe(401); // identity-header-negative-assertion

    const write = await api(request, 'POST', '/api/register', {
      headers: { 'X-User-Id': claimed }, // identity-header-negative-assertion
      data: {},
    });
    // The idempotency guard rejects the anonymous keyed mutation before the
    // route's auth check. Its explicit code proves the identity header did not
    // establish a subject; the GETs above still prove the route-level 401.
    expect(write.status, `POST /api/register as X-User-Id: ${claimed}`).toBe(409); // identity-header-negative-assertion
    expect(errorCodeOf(write.body)).toBe('IDEMPOTENCY_AUTH_REQUIRED');
  }
});

test('the header is ignored even beside a real session: identity is the token\'s subject', async ({ request }) => {
  const doctor = fixtureStaff('Doctor');
  const admin = fixtureStaff('Admin');
  const token = tokenOf(await apiLogin(request, doctor.login_id, doctor.password), 'sign in the doctor');

  const me = await api(request, 'GET', '/api/auth/me', {
    token,
    headers: { 'X-User-Id': admin.user_id }, // identity-header-negative-assertion
  });
  expect(me.status).toBe(200);
  const body = me.body?.user ?? me.body;
  expect(body.user_id, 'the caller became whoever the header named').toBe(doctor.user_id);
  expect(body.role).toBe('Doctor');

  // The identity is a user id. No address, wallet or key is part of it.
  const keys = Object.keys(body).join(' ');
  expect(keys).not.toMatch(/wallet|keystore|public_key|ss58|(^|\s)address(\s|$)/i);
  expect(retiredTermsIn(JSON.stringify(me.body))).toEqual([]);
});

test('the endpoints that issued wallet sessions no longer exist', async ({ request }) => {
  const doctor = fixtureStaff('Doctor');
  const token = tokenOf(await apiLogin(request, doctor.login_id, doctor.password), 'sign in the doctor');

  const gone: Array<['POST' | 'GET', string]> = [
    ['POST', '/api/auth/challenge'],
    ['POST', '/api/auth/jwt'],
    ['POST', '/api/auth/demo-login'],
    ['POST', '/api/auth/staff/login'],
    ['POST', '/api/auth/staff/rotate-credentials'],
    ['POST', '/api/auth/credentials'],
    ['POST', '/api/auth/step-up/challenge'],
    ['POST', '/api/auth/step-up/verify'],
  ];
  for (const [method, path] of gone) {
    // With a bearer, so routing is what answers, not authentication.
    const withSession = await api(request, method, path, { token, data: {} });
    expect([404, 405, 410], `${method} ${path} with a session`).toContain(withSession.status);

    const anonymous = await api(request, method, path, { data: {} });
    expect(
      anonymous.status < 200 || anonymous.status >= 300,
      `${method} ${path} answered ${anonymous.status} to an anonymous caller`
    ).toBe(true);
  }
});

test('the API describes no chain, wallet or key material about itself', async ({ request }) => {
  const doctor = fixtureStaff('Doctor');
  const token = tokenOf(await apiLogin(request, doctor.login_id, doctor.password), 'sign in the doctor');

  for (const path of ['/api/health', '/api/health/detailed']) {
    const health = await api(request, 'GET', path, { token });
    if (health.status === 404) continue;
    expect(health.status, path).toBe(200);
    const text = JSON.stringify(health.body);
    expect(retiredTermsIn(text), `${path} still reports retired components`).toEqual([]);
    expect(text).not.toMatch(/tx_hash|block_number|blockchain_/i);
  }
});
