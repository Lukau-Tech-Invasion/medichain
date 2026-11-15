import { test, expect, type Page } from '@playwright/test';
import { portalPath } from './portal-path';
import {
  ROLES,
  fixturePatientId,
  getStaffFixture,
  requestPacer,
  settle,
  sidebarRoutes,
  signIn,
  skipFirstVisitReload,
  type RoleName,
} from './support';

/**
 * Every clinician and staff route, under every account, against the same
 * route-level checks.
 *
 * `roles.spec.ts` proves each account's navigation renders and audits contrast;
 * `accessibility.spec.ts` audits twelve doctor routes in depth. Neither answers
 * the ledger's route-level questions for all 90 entries: does a deep link
 * survive a refresh, do back and forward land where they should, does a route
 * the account does not own refuse it, does the page reflow at phone width, can
 * a keyboard reach it, is every control labelled, and does an ended session
 * return the person to the page they were on after signing in again.
 *
 * Findings are collected per route and asserted once per account, so a run
 * names every failing route rather than stopping at the first.
 *
 * What this does NOT claim: it opens each page and checks the page, not every
 * control's workflow. Those are the workflow specs; the ledger is only
 * ticked where both have passed.
 */

/** The clinician and staff entries in the remaining-browser-tests ledger (90, plus the six the redesign added). */
const LEDGER_ROUTES = [
  '/dashboard', '/settings', '/notifications', '/dashboard/doctor', '/dashboard/nurse',
  '/dashboard/lab', '/dashboard/pharmacist', '/dashboard/admin', '/patients', '/patients/:patientId',
  '/register', '/access-logs', '/devices', '/retention', '/security-incidents', '/national-id-reviews',
  '/lab-review', '/triage', '/soap', '/vitals', '/progress-note', '/history-physical', '/discharge',
  '/consult', '/ama', '/emergency', '/emergency-protocols', '/code-blue', '/trauma', '/ems-handoff',
  '/stroke', '/cardiac', '/sepsis', '/mci', '/nursing', '/nursing-care-plan', '/mar', '/care-plan',
  '/intake-output', '/wound-care', '/iv-site', '/shift-handoff', '/fall-risk', '/incident-report',
  '/orders', '/e-prescribe', '/medication-admin', '/drug-interactions', '/burn', '/psych', '/toxicology',
  '/pediatrics', '/obstetrics', '/intubation', '/laceration-repair', '/splint', '/pre-op',
  '/operative-note', '/post-op', '/anesthesia', '/lab-results', '/lab-result/:resultId', '/specimen',
  '/chain-of-custody', '/lab-qc', '/critical-value', '/blood-bank', '/imaging', '/radiology',
  '/pathology', '/immunization', '/family-history', '/death-certificate', '/health-id-cards', '/autopsy',
  '/admin', '/user-management', '/claims-eob', '/research-exports', '/order-sets', '/note-templates',
  '/barcode', '/analytics', '/cds-alerts', '/appointments', '/working-hours', '/telehealth', '/messages',
  '/ems-run', '/ems-run/:runId', '/ems-incoming', '/today', '/wards', '/patients/:patientId/:form',
] as const;

/** Public entries, checked signed out. */
const PUBLIC_ROUTES = ['/login', '/activate'] as const;

/** Every account reaches these regardless of role. */
const UNIVERSAL = ['/dashboard', '/settings', '/notifications'];

/** The role-specific dashboards each account may open directly. */
const OWN_DASHBOARD: Record<RoleName, string[]> = {
  Doctor: ['/dashboard/doctor'],
  Nurse: ['/dashboard/nurse'],
  Pharmacist: ['/dashboard/pharmacist'],
  LabTechnician: ['/dashboard/lab'],
  Admin: ['/dashboard/admin'],
  Paramedic: [],
};

/**
 * Routes the router deliberately sends elsewhere for some accounts: a
 * paramedic's dashboard is the ambulance run screen, and `/admin` is the
 * administrator's dashboard under its own name.
 */
const REDIRECTS: Record<string, string> = {
  '/dashboard': '/ems-run',
  '/admin': '/dashboard/admin',
};

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

interface Finding {
  route: string;
  check: string;
  detail: string;
}

/** Strip the portal prefix so routes compare as the router sees them. */
function routeOf(url: string): string {
  const path = new URL(url).pathname;
  const prefix = process.env.E2E_PORTAL_PREFIX?.replace(/\/$/, '') ?? '';
  return prefix && path.startsWith(prefix) ? path.slice(prefix.length) || '/' : path;
}

async function crashed(page: Page): Promise<boolean> {
  return page.locator('text=An unexpected error occurred').first().isVisible().catch(() => false);
}

/** Visible form controls with no accessible name. */
async function unlabelledControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const named = (el: HTMLElement) => {
      if (el.getAttribute('aria-label')?.trim()) return true;
      const by = el.getAttribute('aria-labelledby');
      if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim()) return true;
      if (el.closest('label')?.textContent?.trim()) return true;
      return Boolean(el.getAttribute('title')?.trim());
    };
    const out: string[] = [];
    document
      .querySelectorAll<HTMLElement>('main input:not([type=hidden]), main select, main textarea')
      .forEach((el) => {
        if (!visible(el) || named(el)) return;
        const tag = el.tagName.toLowerCase();
        // Enough context to find it in the source: its placeholder, or the
        // text of the block it sits in.
        const hint = (el.getAttribute('placeholder') || el.parentElement?.parentElement?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 50);
        out.push(`${tag}${el.id ? `#${el.id}` : ''}[type=${el.getAttribute('type') ?? ''}] "${hint}"`);
      });
    return out.slice(0, 10);
  });
}

/** Visible dialogs without modal semantics or a name. */
async function improperDialogs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => {
        const modal = el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG';
        const name = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        return !modal || !name;
      })
      .map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60))
  );
}

/** Page wider than the viewport: content a phone user has to scroll sideways to reach. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** The first Tab from the top of the document reaches a visible control. */
async function keyboardReachable(page: Page): Promise<boolean> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

/** Push a path through the router without reloading the document. */
async function pushRoute(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, portalPath(path));
}

/** A concrete URL for a parameterised ledger entry. */
async function concrete(page: Page, route: string): Promise<string> {
  if (route === '/patients/:patientId') return `/patients/${fixturePatientId()}`;
  if (route === '/patients/:patientId/:form') return `/patients/${fixturePatientId()}/vitals`;
  // Runs live on the device that recorded them; an unknown one must still render an answer.
  if (route === '/ems-run/:runId') return '/ems-run/unknown-run';
  if (route === '/lab-result/:resultId') {
    const href = await page
      .locator('a[href*="/lab-result/"]')
      .first()
      .getAttribute('href', { timeout: 1000 })
      .catch(() => null);
    // No result on this stack: an id that does not exist still has to render a
    // "not found" answer rather than crash.
    return href ? routeOf(new URL(href, page.url()).toString()) : '/lab-result/00000000-0000-4000-8000-000000000000';
  }
  return route;
}

/** Open a route the account owns and run every page-level check on it. */
async function checkOwnedRoute(page: Page, requested: string, previous: string, findings: Finding[]) {
  const add = (check: string, detail: string) => findings.push({ route: requested, check, detail });

  await settle(page, requested).catch((error: Error) => add('navigation', error.message.split('\n')[0]));
  if (await crashed(page)) return add('render', 'the error boundary took over');
  const landed = routeOf(page.url());
  if (!landed.startsWith(requested) && REDIRECTS[requested] !== landed) return add('navigation', `landed on ${landed}`);
  // A declared redirect is the page: history and reload are checked against it.
  const route = landed.startsWith(requested) ? requested : landed;
  const heading = await page.locator('main h1, main h2').first().isVisible().catch(() => false);
  if (!heading) add('heading', 'no visible h1/h2 in main');

  const unlabelled = await unlabelledControls(page);
  if (unlabelled.length) add('labels', unlabelled.join(', '));
  const dialogs = await improperDialogs(page);
  if (dialogs.length) add('dialogs', dialogs.join(' | '));
  if (!(await keyboardReachable(page))) add('keyboard', 'the first Tab reached nothing visible');

  // Back and forward through the browser history, not the app's links.
  if (previous && previous !== route) {
    await page.goBack();
    await page.waitForTimeout(800);
    if (!routeOf(page.url()).startsWith(previous)) add('back', `back landed on ${routeOf(page.url())}, not ${previous}`);
    await page.goForward();
    await page.waitForTimeout(800);
    if (!routeOf(page.url()).startsWith(route)) add('forward', `forward landed on ${routeOf(page.url())}`);
  }

  // A full reload of the deep link keeps the session and the page. A patient's
  // chart replaces the sidebar with its own forms rail (one navigation at a
  // time, c4), and a reload asks the access reason again -- declared reasons
  // live in memory only, by design (ChartAccess.tsx) -- so any of the three
  // standing means the session survived.
  await page.reload();
  const kept = await page
    .getByRole('navigation', { name: /sidebar/i })
    .or(page.locator('nav#workspace-forms'))
    .or(page.getByText(/why are you opening this record/i))
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  if (!kept) add('refresh', `reload ended on ${routeOf(page.url())}`);
  else if (!routeOf(page.url()).startsWith(route)) add('refresh', `reload moved to ${routeOf(page.url())}`);
  if (await crashed(page)) add('refresh', 'the error boundary took over after reload');

  // Phone width: nothing the person needs sits off to the side.
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(400);
  const overflow = await horizontalOverflow(page);
  if (overflow > 1) add('narrow', `page is ${overflow}px wider than a 375px screen`);
  await page.setViewportSize(DESKTOP);
}

/** A route this account does not own must not open as a working page. */
async function checkRefused(page: Page, route: string, findings: Finding[]) {
  await pushRoute(page, route);
  await page.waitForTimeout(1200);
  const body = (await page.locator('main').innerText().catch(() => '')).toLowerCase();
  const refused =
    !routeOf(page.url()).startsWith(route) ||
    /denied|not authori|permission|forbidden|restricted|no access|not available to your role/.test(body);
  if (!refused) findings.push({ route, check: 'unauthorized', detail: 'rendered without a refusal' });
}

function report(role: string, findings: Finding[]): string {
  return findings.map((f) => `  ${role} ${f.route} [${f.check}] ${f.detail}`).join('\n');
}

test.describe('public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders signed out, at phone width, with labelled controls`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
      await skipFirstVisitReload(page);
      await page.goto(portalPath(route));
      await expect(page.locator('form, main').first()).toBeVisible();
      expect(await crashed(page)).toBe(false);
      const unlabelled = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLInputElement>('input:not([type=hidden]), select, textarea'))
          .filter((el) => el.getBoundingClientRect().width > 0)
          .filter((el) => !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
          .map((el) => el.name || el.id || el.type)
      );
      expect(unlabelled, `unlabelled controls on ${route}`).toEqual([]);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
      await page.setViewportSize(PHONE);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
    });
  }

  test('a signed-out deep link returns to its page after sign-in', async ({ page }) => {
    await signIn(page, 'Doctor', 0);
    await page.context().clearCookies();
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(portalPath('/soap'));
    await expect(page).toHaveURL(/\/login/, { timeout: 20000 });
    // Signing in from here, not from a fresh /login: the router state carries
    // the requested page.
    await signInHere(page, 'Doctor');
    await expect(page).toHaveURL(/\/soap/, { timeout: 30000 });
  });
});

/** Sign in on the login page already open, keeping its router state. */
async function signInHere(page: Page, role: RoleName) {
  const fixture = getStaffFixture(role, STAFF_INDEX);
  await page.getByRole('textbox', { name: 'Employee ID or username' }).fill(fixture.login_id);
  await page.getByRole('textbox', { name: 'Password' }).fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/**
 * Which roles to walk, and which fixture account of each (`scripts/live-check.ps1`
 * walks a deployment with the reviewer accounts, which include no administrator).
 */
const ROLES_UNDER_TEST = process.env.E2E_ROLES
  ? ROLES.filter((role) => process.env.E2E_ROLES!.split(',').map((r) => r.trim()).includes(role))
  : ROLES;
const STAFF_INDEX = Number(process.env.E2E_STAFF_INDEX ?? 0);

for (const role of ROLES_UNDER_TEST) {
  test.describe(`${role} account, every route`, () => {
    test.describe.configure({ mode: 'serial' });

    test('owned routes pass the page checks; other routes are refused; an ended session returns to its page', async ({
      browser,
    }) => {
      test.setTimeout(45 * 60_000);
      const page = await browser.newPage({ viewport: DESKTOP });
      const pace = requestPacer(page, 180);
      await signIn(page, role, STAFF_INDEX);

      // Sidebar links carry the portal prefix; compare routes as the router sees them.
      const sidebar = (await sidebarRoutes(page)).map((href) => routeOf(new URL(href, page.url()).toString()));
      const owned = new Set<string>([...UNIVERSAL, ...OWN_DASHBOARD[role], ...sidebar]);
      // Detail routes reached from a list the account owns.
      if (owned.has('/patients')) owned.add('/patients/:patientId');
      if (owned.has('/lab-results')) owned.add('/lab-result/:resultId');

      const findings: Finding[] = [];
      // Anything the Content-Security-Policy blocks is a finding: a refused
      // script, style, font or frame is a page that silently works less.
      page.on('console', (message) => {
        if (/Content Security Policy/i.test(message.text())) {
          findings.push({ route: routeOf(page.url()), check: 'csp', detail: message.text().slice(0, 300) });
        }
      });
      let previous = '';
      for (const route of [...owned].slice(0, 120)) {
        await pace();
        const target = await concrete(page, route);
        await checkOwnedRoute(page, target, previous, findings);
        // Where the route actually settled: `/dashboard` is `/ems-run` for a paramedic.
        previous = routeOf(page.url());
      }

      // A role-specific dashboard alias belonging to another role, and every
      // ledger route outside this account's navigation.
      const refusedRoutes = LEDGER_ROUTES.filter((r) => !owned.has(r) && !r.includes(':'));
      for (const route of refusedRoutes) {
        await pace();
        await checkRefused(page, route, findings);
      }

      // An ended session: the refresh credential is gone, so the next load
      // returns to sign-in, and signing in again returns to the same page.
      const resume = [...owned].find((r) => !r.includes(':') && r !== '/dashboard') ?? '/settings';
      await settle(page, resume);
      await page.context().clearCookies();
      await page.evaluate(() => sessionStorage.clear());
      await page.reload();
      const toLogin = await page
        .waitForURL(/\/login/, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
      if (!toLogin) findings.push({ route: resume, check: 'session-expiry', detail: `stayed on ${routeOf(page.url())}` });
      else {
        await signInHere(page, role);
        const back = await page
          .waitForURL(new RegExp(resume.replace(/[/-]/g, '\\$&')), { timeout: 30000 })
          .then(() => true)
          .catch(() => false);
        if (!back) findings.push({ route: resume, check: 'session-expiry', detail: `after sign-in landed on ${routeOf(page.url())}` });
      }

      test.info().annotations.push({ type: 'routes', description: `${owned.size} owned, ${refusedRoutes.length} refused` });
      await page.close();
      expect(findings, `\n${report(role, findings)}`).toEqual([]);
    });
  });
}

test('the ledger route list matches the router', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const declared = [...app.matchAll(/<Route\s+path="([^"*]+)"/g)]
    .map((m) => (m[1].startsWith('/') ? m[1] : `/${m[1]}`))
    .filter((p) => p !== '/');
  const ledger = new Set<string>([...LEDGER_ROUTES, ...PUBLIC_ROUTES]);
  expect(declared.filter((p) => !ledger.has(p as never)), 'routes the ledger does not list').toEqual([]);
  expect([...ledger].filter((p) => !declared.includes(p)), 'ledger routes the router no longer serves').toEqual([]);
});
