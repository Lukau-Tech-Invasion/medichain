import { expect, type Page } from '@playwright/test';

/** Where the shared signed-in session is stored between projects. */
export const AUTH_STATE = 'e2e/.auth/doctor.json';

/**
 * Shared harness for the doctor-portal browser suites.
 *
 * Sign-in goes through the demo-credential shortcut, which the login page
 * populates from `GET /api/auth/demo-credentials`. That endpoint answers only
 * when the API runs with **`MEDICHAIN_DEV_MODE`** *and* demo mode — anywhere
 * else it is a deliberate 403/404, so the demo buttons never render.
 *
 * When that happens the old `beforeEach` clicked a button that did not exist
 * and sat there for the full 30-second timeout, once per test, reporting only
 * "locator.click: Test timeout exceeded". The guard below turns a
 * ten-minute mystery into one line naming the missing environment variable.
 */
/**
 * Every account the portal serves.
 *
 * The five staff roles carry genuinely different navigation, different
 * dashboards and different server-side authorisation, so "the app is
 * accessible" and "the app is readable" are five separate claims. Auditing the
 * doctor and calling it the portal is the same mistake as auditing one theme
 * and calling it the palette.
 *
 * `bt.pharm2` exists as a second pharmacist because maker-checker workflows
 * refuse self-approval; it is not a distinct role to audit, so it is absent
 * here.
 */
export const ROLES = ['Doctor', 'Nurse', 'Pharmacist', 'LabTechnician', 'Admin'] as const;
export type RoleName = (typeof ROLES)[number];

/**
 * How each role's demo button is identified on the sign-in screen.
 *
 * Matched on the ROLE the button advertises, never the person's name. The
 * hardcoded demo identities were removed and the list now comes from the
 * database, so a selector naming "Mbeki" or "Dr Browser Test" breaks silently
 * the next time a seed changes — which is exactly what happened once already.
 */
const ROLE_BUTTON: Record<RoleName, RegExp> = {
  Doctor: /doctor/i,
  Nurse: /nurse/i,
  Pharmacist: /pharmacist/i,
  LabTechnician: /lab\s*tech/i,
  Admin: /admin/i,
};

/**
 * Where each role lands after signing in.
 *
 * All five land on `/dashboard`, which is not one screen: `SmartDashboardRouter`
 * dispatches on the signed-in role and renders `AdminDashboardPage`,
 * `NurseDashboardPage`, `LabTechDashboardPage`, `PharmacistDashboardPage` or
 * `DashboardPage`. So one URL, five different pages, four of which no browser
 * test had ever rendered.
 *
 * The administrator also has `/admin` in its navigation, and it is the same
 * component — the sidebar entry and the landing page reach it two ways.
 */
export const ROLE_HOME: Record<RoleName, string> = {
  Doctor: '/dashboard',
  Nurse: '/dashboard',
  Pharmacist: '/dashboard',
  LabTechnician: '/dashboard',
  Admin: '/dashboard',
};

/**
 * Neutralise the first-visit cache purge before the page can run it.
 *
 * `index.html` carries an inline script that compares an `APP_VERSION`
 * constant against `localStorage.medichain_app_version`. On any browser that
 * has not seen this version -- which is EVERY Playwright profile, every run --
 * it deletes every `medichain*` key and then calls `location.reload()` **100ms
 * later**. That is a deliberate force-update path for real users, who cannot
 * type in 100ms and never notice it.
 *
 * A test can. The reload lands in the middle of the first `fill()` or the
 * click after it, which detaches the element mid-action and resets the React
 * form state -- so the Sign in button stays disabled with a filled-looking
 * form, and `page.click` times out against `<button disabled>`. It also
 * discards a session that had already been established, because nothing about
 * this app's auth survives a full page load (see `settle` below).
 *
 * The failure is a race, so the suite passed or failed on machine speed rather
 * than on anything about the product. Seeding the marker before any page
 * script runs takes the branch out of play entirely.
 *
 * The version is READ from the served `index.html` rather than hardcoded: a
 * copy of `'v3'` here would silently stop matching the next time someone bumps
 * it, and the suite would go back to racing without anyone knowing why.
 */
export async function skipFirstVisitReload(page: Page) {
  const response = await page.request.get('/index.html');
  const version = /APP_VERSION\s*=\s*'([^']+)'/.exec(await response.text())?.[1];
  expect(
    version,
    'Could not find APP_VERSION in index.html. The first-visit cache purge may have ' +
      'moved; until this helper finds it again, every browser suite races a reload.'
  ).toBeTruthy();
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('medichain_app_version', value as string);
    } catch {
      // A profile that refuses storage cannot be raced by the purge either.
    }
  }, version);
}

export async function signIn(page: Page, role: RoleName = 'Doctor') {
  await skipFirstVisitReload(page);
  await page.goto('/login');

  const pattern = ROLE_BUTTON[role];
  // `.first()` is deliberate: there are two Pharmacist fixtures, and either
  // will do for an audit that only reads.
  const demoButton = page.locator('button').filter({ hasText: pattern });
  const available = await demoButton
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  expect(
    available,
    `No demo sign-in button for ${role} on the login page.\n` +
      'They are populated from GET /api/auth/demo-credentials, which answers only when the\n' +
      'API runs with MEDICHAIN_DEV_MODE set AND demo mode enabled. The Docker compose file\n' +
      'does not set MEDICHAIN_DEV_MODE — that is deliberate, since the endpoint exposes\n' +
      'credentials and should not be on by default in a file anyone might deploy from.\n' +
      'To run these suites, start the API with MEDICHAIN_DEV_MODE=1.\n' +
      'The accounts also have to exist. That endpoint only offers fixtures carrying a\n' +
      'keystore, so a database seeded for Doctor and Nurse alone silently offers two\n' +
      'buttons and no more: run scripts/seed-browser-test-fixtures.ts.'
  ).toBe(true);

  await demoButton.first().click();

  // Wait for the signed-in PAGE, not for the URL.
  //
  // React Router updates the address through `pushState`, and Playwright's
  // `page.url()` lags that by a noticeable margin under load. Measured
  // 2026-09-15: two seconds after the click the dashboard was fully rendered
  // — "Welcome back, Dr Browser Test" — while `page.url()` still reported
  // `/login`. It caught up between three and five seconds later.
  //
  // `signIn` asserted `toHaveURL` against the DEFAULT five-second expect
  // timeout, so late in a long serial run the assertion expired while the app
  // was demonstrably signed in. It produced nine failures in one run, every one
  // reported as a product defect on an innocent spec, with `STAFF_LOGIN_OK` in
  // the API log beside each. The page content is the thing being claimed;
  // the address bar is bookkeeping that catches up.
  // The sidebar, not a page heading: every signed-in layout renders it, and it
  // is the thing that proves authentication succeeded. A page `h1` is
  // route-specific and absent while a lazily loaded dashboard is still
  // suspended, which is a different wait with a different meaning.
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toBeVisible({
    timeout: 30000,
  });

  // Then the URL, on a timeout that reflects how long it actually takes. Not
  // every role lands on /dashboard — an administrator lands on /admin — and
  // asserting the shared path is part of why the Admin account had never been
  // signed in by a test.
  await expect(page).toHaveURL(new RegExp(ROLE_HOME[role]), { timeout: 30000 });
}

/**
 * Navigate and wait for real content.
 *
 * NOT `waitForLoadState('networkidle')`: this app holds an SSE stream open on
 * /api/events, so the network is never idle and that wait can only time out.
 */
export async function settle(page: Page, path: string) {
  // Client-side navigation only, never `page.goto` after sign-in.
  //
  // `authStore.restoreSession` fails closed **by design**: no access token,
  // refresh token or signing key is persisted, so nothing survives a full page
  // load and the app correctly returns to sign-in. See the long comment on
  // `restoreSession` — a durable session needs a persisted refresh token or a
  // cookie-borne one, and that trade-off has not been decided.
  //
  // A `goto` is a full load, so it logged the suite out on every route and
  // re-signing-in then goto-ing again just repeated the loop. Clicking the
  // in-app link keeps the React Router history and the in-memory session
  // intact, which is also what a real clinician does.
  if (!page.url().includes(path)) {
    // Expand any collapsed navigation sections first. The sidebar groups routes
    // under collapsible headers, so a link like /emergency is simply absent
    // from the DOM until its section is open — and the history-push fallback
    // below does not help, because React Router does not respond to a
    // programmatic pushState.
    const sections = page.locator('nav button[aria-expanded="false"]');
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      await sections
        .nth(i)
        .click({ timeout: 2000 })
        .catch(() => undefined);
    }

    // `:visible`, not `.first()`.
    //
    // `renderSidebar` runs twice — once inside the mobile `<aside>` and once
    // inside the desktop one — so every nav route matches two anchors. At
    // desktop width the first of them is the MOBILE copy, which is hidden, and
    // `.first()` picked exactly that: `count=1, visible=false, boundingBox=null`,
    // and a click that timed out after retrying an element that can never be
    // reached. Nine of the doctor's own routes were unreachable to the suite for
    // this reason alone, and the failure read as "the page did not render".
    //
    // It also still covers the original case this comment was written for: at
    // 320px the sidebar collapses, so the link exists in the DOM and is not
    // visible, and the reflow tests must not stall on it.
    const link = page.locator(`a[href="${path}"]:visible`).first();
    const clickable = (await link.count()) > 0;
    // A short timeout, then fall back. "Visible" is not the same as "inside the
    // viewport", and a click on an off-screen element retries until the whole
    // test times out — which closes the shared page and fails every test after
    // it, for a reason none of their messages mention.
    const clicked = clickable
      ? await link
          .click({ timeout: 4000 })
          .then(() => true)
          .catch(() => false)
      : false;
    if (!clicked) {
      // Not in the navigation (a deep route). Push through the router rather
      // than reloading the document.
      await page.evaluate(p => {
        window.history.pushState({}, '', p);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, path);
    }
  }

  const reached = await page
    .locator('main')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  if (!reached) {
    // Say what actually happened. A bare "waiting for main" timeout is the same
    // message whether the route redirected, the role was refused, or the nav
    // link was never found — and those need different fixes.
    const url = page.url();
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 200);
    throw new Error(
      `Never reached ${path}.
` +
        `  URL now: ${url}
` +
        `  Page text: ${body.replace(/\s+/g, ' ')}`
    );
  }

  await page.waitForTimeout(1200);
}
