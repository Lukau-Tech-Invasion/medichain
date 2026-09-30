import { expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { retiredTermsIn } from './identity';

/** Where the shared signed-in session is stored between projects. */
export const AUTH_STATE = 'e2e/.auth/doctor.json';

/**
 * Shared harness for the doctor-portal browser suites.
 *
 * Sign-in uses the exact synthetic credentials emitted by the current fixture
 * seed. Legacy quick-login accounts can remain in a long-lived database, so a
 * role-labelled demo button is not sufficient proof that the suite exercised
 * the patient and staff identities named in `.browser-test/fixtures.json`.
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

interface StaffFixture {
  role: RoleName;
  login_id: string;
  password: string;
}

const fixtureCursor = new Map<RoleName, number>();

/**
 * Locate `.browser-test/fixtures.json` from wherever the run was launched.
 *
 * This was `resolve(cwd, '..', ...)`, which only resolves when the suite is
 * started from inside `client/doctor-portal`. Started from the repository root
 * -- which is how the documented `npx playwright test --config=...` line reads,
 * and how CI invokes it -- every test failed with a bare ENOENT naming a
 * `client/.browser-test` that has never existed, and the failure reads as
 * "nobody seeded the fixtures" rather than "the harness looked in the wrong
 * place". Walking up is cwd-independent and bounded by the filesystem root.
 */
function findFixtureFile(): string {
  let directory = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(directory, '.browser-test', 'fixtures.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  throw new Error(
    `No .browser-test/fixtures.json above ${process.cwd()}; run the browser fixture seed ` +
      '(npx tsx scripts/seed-browser-test-fixtures.ts --i-understand-this-writes-accounts).'
  );
}

/** Read the exact synthetic account produced by the current seed run. */
function getStaffFixture(role: RoleName): StaffFixture {
  const fixturePath = findFixtureFile();
  const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as { staff?: StaffFixture[] };
  const candidates = fixtures.staff?.filter((staff) => staff.role === role) ?? [];
  if (candidates.length === 0) {
    throw new Error(`No ${role} account exists in ${fixturePath}; run the browser fixture seed.`);
  }
  const cursor = fixtureCursor.get(role) ?? 0;
  fixtureCursor.set(role, cursor + 1);
  return candidates[cursor % candidates.length];
}

/** The seeded patient's record id, for the routes that show one patient. */
export function fixturePatientId(): string {
  const fixtures = JSON.parse(readFileSync(findFixtureFile(), 'utf8')) as {
    patient?: { linked_patient_id?: string };
  };
  const id = fixtures.patient?.linked_patient_id;
  if (!id) throw new Error('The browser fixtures name no patient; run the browser fixture seed.');
  return id;
}

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
  const fixture = getStaffFixture(role);
  await page.getByRole('textbox', { name: 'Employee ID or work email' }).fill(fixture.login_id);
  await page.getByRole('textbox', { name: 'Password' }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

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

/**
 * Choose a patient through the searchable picker.
 *
 * Screens used to ask for a patient with a native `<select>`, so a spec did
 * `locator('#id').selectOption(value)` and read the roster out of its
 * `<option>` elements. `PatientSelect` is a combobox: a text input that queries
 * the server as the clinician types, and a list of buttons to press. Nobody
 * remembers a `PAT-` id, which is why the screens changed — and nine browser
 * specs went on driving the old control, failing in a way that looks exactly
 * like a broken page.
 *
 * `search` narrows the list; omitting it opens the picker and takes whatever
 * the server offers first, which is what the specs that deliberately do not
 * name a fixture want. Returns the chosen patient's visible name.
 */
export async function selectPatient(
  page: Page,
  selector: string,
  search?: string
): Promise<string> {
  const input = page.locator(selector);
  // Once a patient is chosen the control collapses and the search input is
  // gone, so `#id` matches nothing. Open it first: the collapsed display
  // carries `#id-selected` and clicking it brings the input back.
  if (!(await input.isVisible().catch(() => false))) {
    const collapsed = page.locator(`${selector}-selected`);
    await expect(collapsed).toBeVisible({ timeout: 20000 });
    await collapsed.click();
  }
  await expect(input).toBeVisible({ timeout: 20000 });
  await input.click();
  // Typing drives the query; an empty search still opens the list.
  await input.fill(search ?? '');

  // The picker debounces, and the options are buttons inside the dropdown that
  // follows the input's own container.
  const options = page
    .locator('div.absolute.z-50 button[type="button"]')
    .or(page.locator('[role="listbox"] button'));
  await expect(options.first()).toBeVisible({ timeout: 20000 });

  // An option renders as: the avatar initial, then the full name, then
  // "PAT-... • HID-...". Taking line 0 yields the single-letter initial, which
  // is not the patient's name and is useless as a later search term.
  const chosen =
    (await options.first().innerText())
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 1 && !line.startsWith('PAT-')) ?? '';
  await options.first().click();

  // The control collapses to the chosen patient once the selection lands.
  await expect(page.getByText(chosen, { exact: false }).first()).toBeVisible({
    timeout: 10000,
  });
  return chosen;
}

// ---------------------------------------------------------------------------
// Credential sign-in, sign-out and the sweeps built on them
// ---------------------------------------------------------------------------

/**
 * Sign in as ANY account through the form: Employee ID and password, then the
 * authenticator code when the account has one.
 *
 * `signIn` above reads a role's account from the fixture manifest. Specs about
 * sign-in itself (a locked account, a two-factor account, a freshly activated
 * one, a changed password) need an account they name, and need to decide what
 * happens after the first submit, so this one returns once the form has been
 * submitted and the sidebar is showing -- or throws with what the page said.
 *
 * The selectors are the field ids rather than the labels `signIn` uses: a label is
 * a translated string, an id is not, so these keep working under another locale.
 *
 * @param totp - Supplies the code when the form asks for one. A function, not a
 *   string, so the code is computed when the field appears rather than before a
 *   PBKDF2 derivation that can take a step of the clock.
 */
export async function signInWithCredentials(
  page: Page,
  loginId: string,
  password: string,
  totp?: () => Promise<string>
) {
  await skipFirstVisitReload(page);
  await page.goto('/login');
  await page.locator('input#identifier').fill(loginId);
  await page.locator('input#password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  if (totp) {
    const codeField = page.locator('input#totp-code');
    await expect(codeField, 'the account was not asked for its authenticator code').toBeVisible({
      timeout: 30000,
    });
    await codeField.fill(await totp());
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toBeVisible({ timeout: 30000 });
}

/** Sign out through the sidebar and land on the sign-in page. */
export async function signOut(page: Page) {
  const logout = page.locator('button:visible').filter({ hasText: /^\s*logout\s*$/i }).first();
  await logout.click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  await expect(page.locator('input#identifier')).toBeVisible({ timeout: 15000 });
}

/** The sign-in page is showing and nothing signed-in is: no sidebar, the form is there. */
export async function expectSignedOut(page: Page) {
  await expect(page.locator('input#identifier')).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('navigation', { name: /sidebar/i })).toHaveCount(0);
}

/**
 * Open a patient's chart, declaring why when the reason gate asks.
 *
 * A chart is not mounted until the clinician says why (WP10), and the reason is
 * remembered per tab, so the gate may or may not be showing. Opening a chart is
 * also what writes the access-log row a patient later sees.
 */
export async function openChartWithReason(
  page: Page,
  patientId: string,
  reason: 'Treatment' | 'Referral' | 'Emergency' | 'Administrative' = 'Treatment'
) {
  await settle(page, `/patients/${patientId}`);
  const gate = page.getByTestId('access-reason-gate');
  if (await gate.isVisible().catch(() => false)) {
    await gate.getByRole('button', { name: reason, exact: true }).click();
  }
  await expect(gate).toHaveCount(0, { timeout: 30000 });
}

/**
 * Choose a specific patient in a `PatientSelect` by record id.
 *
 * `selectPatient` takes whatever the server lists first, which is right for a
 * spec that names no fixture and wrong for one that must act on a particular
 * patient: it takes the unfiltered list while the search is still debouncing.
 */
export async function pickPatientById(page: Page, selector: string, patientId: string) {
  const input = page.locator(selector);
  if (!(await input.isVisible().catch(() => false))) {
    await page.locator(`${selector}-selected`).click();
  }
  await input.click();
  await input.fill(patientId);
  const option = page
    .locator('div.absolute.z-50 button[type="button"]')
    .or(page.locator('[role="listbox"] button'))
    .filter({ hasText: patientId });
  await expect(option.first()).toBeVisible({ timeout: 20000 });
  await option.first().click();
}

/**
 * Wait for the step-up dialog and answer it with a code, when it appears.
 *
 * Resolves `true` if the dialog was shown and answered, `false` if it never
 * appeared inside `waitMs`. A demo-mode API exempts the Class B gate, so "no
 * dialog" is a legitimate outcome and the caller decides what that means.
 */
export async function answerStepUp(
  page: Page,
  code: () => Promise<string | undefined>,
  waitMs = 6000
): Promise<boolean> {
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#step-up-code') });
  const shown = await dialog
    .waitFor({ state: 'visible', timeout: waitMs })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  const value = await code();
  if (!value) throw new Error('The step-up dialog asked for a code but no authenticator is paired.');
  await dialog.locator('#step-up-code').fill(value);
  await dialog.getByRole('button', { name: /^confirm$/i }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
  return true;
}

/** Every route the signed-in account's own sidebar offers, sections expanded. */
export async function sidebarRoutes(page: Page): Promise<string[]> {
  for (let pass = 0; pass < 2; pass += 1) {
    const closed = page.locator('nav button[aria-expanded="false"]:visible');
    const count = await closed.count();
    for (let i = 0; i < count; i += 1) {
      await closed.first().click({ timeout: 2000 }).catch(() => undefined);
    }
  }
  const hrefs = await page
    .locator('nav a[href^="/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') || ''));
  return Array.from(new Set(hrefs.filter((h) => h && h !== '/' && !h.startsWith('/login'))));
}

/**
 * Keep a page under the API's per-minute budget, counted from its own requests.
 * Returns a function to `await` between navigations.
 */
export function requestPacer(page: Page, perMinute = 90) {
  const stamps: number[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) stamps.push(Date.now());
  });
  return async () => {
    for (;;) {
      const cutoff = Date.now() - 60_000;
      while (stamps.length && stamps[0] < cutoff) stamps.shift();
      if (stamps.length < perMinute) return;
      await page.waitForTimeout(stamps[0] + 60_500 - Date.now());
    }
  };
}

/**
 * Everything on the page a person could read: the visible text plus the text
 * that lives in attributes (placeholder, aria-label, title, alt, value of a
 * button). A retired term hidden in a tooltip is still a retired term.
 */
export async function readablePageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = [document.body.innerText];
    document.querySelectorAll('[placeholder],[aria-label],[title],[alt]').forEach((el) => {
      for (const name of ['placeholder', 'aria-label', 'title', 'alt']) {
        const value = el.getAttribute(name);
        if (value) parts.push(value);
      }
    });
    return parts.join('\n');
  });
}

/** The retired terms visible on the current page, or an empty list. */
export async function retiredTermsOnPage(page: Page): Promise<string[]> {
  return retiredTermsIn(await readablePageText(page));
}
