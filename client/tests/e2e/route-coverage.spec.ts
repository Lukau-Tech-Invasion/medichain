import { test, expect, Page, ConsoleMessage, Response } from '@playwright/test';

/**
 * Route coverage sweep for both PWAs.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this file, the entire Playwright suite was three tests: doctor login,
 * patient login, and "both portals are reachable". The two apps ship 108
 * routes between them. A demo walks those routes; the test suite did not, so
 * a page that throws on mount, renders blank, or fires a 404/500 on load was
 * invisible to CI and would first be discovered by whoever was watching the
 * screen.
 *
 * This sweep visits every registered route as a logged-in user and records
 * three independent failure signals per route:
 *
 *   1. the React ErrorBoundary fallback (role="alert", "Something went wrong")
 *   2. uncaught page errors and console.error output
 *   3. failed network responses (>=400) triggered by that route
 *
 * A route is reported broken if ANY signal fires. Signals are collected rather
 * than asserted one-at-a-time so a single run yields the full picture instead
 * of stopping at the first bad page.
 *
 * NOT a replacement for behavioural tests. It proves a page mounts and loads
 * its data, not that the data is correct. That is a deliberate boundary: this
 * catches the "it's broken on screen" class, which is what a demo exposes.
 */

const DOCTOR_ROUTES = [
  'dashboard', 'dashboard/doctor', 'dashboard/nurse', 'dashboard/lab',
  'dashboard/pharmacist', 'dashboard/admin', 'patients', 'register',
  'access-logs', 'triage', 'soap', 'vitals', 'progress-note',
  'history-physical', 'discharge', 'consult', 'ama', 'emergency',
  'emergency-protocols', 'code-blue', 'trauma', 'stroke', 'cardiac', 'sepsis',
  'mci', 'nursing', 'nursing-care-plan', 'mar', 'care-plan', 'intake-output',
  'wound-care', 'iv-site', 'shift-handoff', 'fall-risk', 'incident-report',
  'orders', 'e-prescribe', 'medication-admin', 'drug-interactions', 'burn',
  'psych', 'toxicology', 'pediatrics', 'obstetrics', 'intubation',
  'laceration-repair', 'splint', 'pre-op', 'operative-note', 'post-op',
  'anesthesia', 'lab-results', 'specimen', 'chain-of-custody', 'lab-qc',
  'critical-value', 'blood-bank', 'imaging', 'radiology', 'pathology',
  'immunization', 'family-history', 'death-certificate', 'autopsy', 'admin',
  'user-management', 'order-sets', 'note-templates', 'barcode', 'analytics',
  'cds-alerts', 'appointments', 'telehealth', 'messages', 'settings',
];

const PATIENT_ROUTES = [
  'dashboard', 'profile', 'records', 'consent', 'emergency-card',
  'medications', 'appointments', 'messages', 'symptoms', 'medical-id',
  'settings', 'reminders', 'family', 'telehealth', 'wearables', 'lab-trends',
  'insurance', 'survey', 'symptom-checker', 'language', 'offline-sync',
  'vitals', 'lab-results', 'notifications', 'medical-history',
];

/**
 * Console noise that is not evidence of a broken page.
 *
 * Kept deliberately short and specific. A broad filter here would quietly
 * recreate the problem this file exists to solve, so each entry names a
 * framework/browser message that carries no application signal.
 */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[vite\] connect(ing|ed)/i,
  /React Router Future Flag/i,
  /Lit is in dev mode/i,
];

/**
 * React dev-mode list-key warnings.
 *
 * These are recorded and REPORTED, never silently dropped — but they do not
 * fail a route, because they are not the class this sweep exists to catch.
 * This file's contract is "the page is broken on screen", the thing a demo
 * exposes. A key warning means React cannot optimally reconcile a list; the
 * page still renders correctly, and a viewer sees nothing wrong.
 *
 * The distinction is deliberate and worth stating, because the opposite
 * mistake — a signal that reports clean when something IS wrong — is the
 * failure mode this whole suite was written to remove. So these stay visible
 * in the run output as WARN lines and are listed in the summary; they are
 * simply not counted as a broken route.
 *
 * Currently outstanding on /nursing and /medication-admin. Every JSX `.map`
 * in both pages carries a key, so the source is a child component; that is
 * real technical debt and still needs fixing.
 */
const REACT_KEY_WARNINGS = [
  /unique "key" prop/i,
  /two children with the same key/i,
];

/** Requests whose failure says nothing about the route being rendered. */
const IGNORED_REQUESTS = [/\/favicon\.ico$/i, /\.map$/i, /@vite\//i, /@react-refresh/i];

/**
 * Routes that an Admin may open and the demo Doctor may NOT.
 *
 * The sweep signs in as Dr. Mbeki (role Doctor). These pages correctly answer
 * 403, and counting that as breakage was the instrument being wrong, not the
 * app — three "failures" that were RBAC doing its job.
 *
 * They are not skipped. They are inverted: the page must still mount without
 * crashing, and the API must still refuse it. If one of these ever returns
 * 2xx for a Doctor that is a privilege-escalation regression, and this list
 * turns it into a FAILING test rather than a silent pass.
 */
const ADMIN_ONLY = new Set(['admin', 'analytics', 'user-management', 'dashboard/admin']);

interface RouteReport {
  route: string;
  boundary: boolean;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  blank: boolean;
}

function isIgnored(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/** Wire up collectors once; they push into the report for the current route. */
function attachCollectors(page: Page, current: () => RouteReport | null): void {
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const report = current();
    if (!report) return;
    const text = msg.text();
    if (isIgnored(text, IGNORED_CONSOLE)) return;

    // `msg.text()` renders React's warnings with their `%s` placeholders
    // unfilled, dropping the component name that says WHICH list is at fault.
    // React captures `console.error` before any init script can wrap it, so the
    // substitutions have to be recovered from the raw args here. Resolution is
    // async; visitRoute's settle wait gives it time to land, and the plain text
    // is recorded immediately so nothing is lost if it does not.
    const idx = report.consoleErrors.push(text.slice(0, 200)) - 1;
    Promise.all(msg.args().map((a) => a.jsonValue().catch(() => undefined)))
      .then((vals) => {
        const joined = vals
          .filter((v) => v !== undefined)
          .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
          .join(' ');
        if (joined) report.consoleErrors[idx] = joined.slice(0, 300);
      })
      .catch(() => undefined);
  });

  page.on('pageerror', (err: Error) => {
    const report = current();
    if (report) report.pageErrors.push(String(err.message).slice(0, 200));
  });

  page.on('response', (res: Response) => {
    if (res.status() < 400) return;
    const report = current();
    if (!report) return;
    const url = res.url();
    if (isIgnored(url, IGNORED_REQUESTS)) return;
    report.failedRequests.push(`${res.status()} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
  });
}

async function loginWithDemoButton(page: Page, buttonText: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const button = page.locator(`button:has-text("${buttonText}")`).first();
  await expect(button, `demo login button "${buttonText}" must exist`).toBeVisible({ timeout: 15000 });
  await button.click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

/** Visit one route and finish populating its report. */
async function visitRoute(page: Page, route: string, report: RouteReport): Promise<void> {
  await page.goto(`/${route}`, { waitUntil: 'domcontentloaded' });
  // Let lazy chunks resolve and first data fetches settle. networkidle is
  // unreliable with SSE/polling, so bound the wait instead of requiring quiet.
  await page.waitForTimeout(1200);

  report.boundary = await page
    .locator('[role="alert"]:has-text("Something went wrong")')
    .isVisible()
    .catch(() => false);

  const text = (await page.locator('body').innerText().catch(() => '')) ?? '';
  report.blank = text.trim().length < 30;
}

function describeFailure(r: RouteReport): string {
  const parts: string[] = [];
  if (r.boundary) parts.push('ErrorBoundary rendered');
  if (r.blank) parts.push('page rendered blank/near-empty');
  if (r.pageErrors.length) parts.push(`uncaught: ${r.pageErrors.join(' | ')}`);
  if (r.consoleErrors.length) parts.push(`console.error: ${r.consoleErrors.join(' | ')}`);
  if (r.failedRequests.length) parts.push(`failed requests: ${r.failedRequests.join(', ')}`);
  return parts.join('; ');
}

/** A 403/401 is the expected answer on an admin-only page for a Doctor. */
function isAuthorizationDenial(entry: string): boolean {
  return /^(401|403) /.test(entry);
}

/** Console noise that is a *consequence* of an expected 403, not a defect. */
function isDenialEcho(entry: string): boolean {
  return /(401|403)|Forbidden|Unauthorized|Only .*(admin|administrator)/i.test(entry);
}

/** Non-blocking dev-mode warnings, surfaced but not counted as breakage. */
function isKeyWarning(entry: string): boolean {
  return REACT_KEY_WARNINGS.some((p) => p.test(entry));
}

function blockingConsoleErrors(r: RouteReport): string[] {
  return r.consoleErrors.filter((e) => !isKeyWarning(e));
}

function isBroken(r: RouteReport): boolean {
  const adminOnly = ADMIN_ONLY.has(r.route);

  // On an admin-only route the Doctor MUST be refused. Being allowed through
  // is the defect worth catching here.
  if (adminOnly) {
    const wasDenied = r.failedRequests.some(isAuthorizationDenial);
    if (!wasDenied) return true;
    // The page still has to render — an ErrorBoundary, a blank screen or a
    // genuine JS crash is a defect even on a page you are not allowed to read.
    return r.boundary || r.blank || r.pageErrors.length > 0 ||
      blockingConsoleErrors(r).some((e) => !isDenialEcho(e)) ||
      r.failedRequests.some((e) => !isAuthorizationDenial(e));
  }

  return r.boundary || r.blank || r.pageErrors.length > 0 ||
    blockingConsoleErrors(r).length > 0 || r.failedRequests.length > 0;
}

/**
 * Build a serial suite that logs in once and then walks every route.
 *
 * One test per route (rather than one test for all of them) so the report
 * names exactly which pages are broken instead of failing as a single opaque
 * assertion.
 */
function sweep(appName: string, baseURL: string, demoButton: string, routes: string[]): void {
  test.describe(`${appName} route coverage`, () => {
    test.use({ baseURL });

    // Log in ONCE and reuse the resulting storage state. Each route then gets
    // its own independent context.
    //
    // The first version of this ran `mode: 'serial'` with one shared page, and
    // that was wrong in the way that matters: Playwright skips the rest of a
    // serial group after the first failure, so one broken route hid the other
    // 50. A sweep whose whole purpose is "show me every broken page" must not
    // stop at the first one.
    let storageState: unknown;

    test.beforeAll(async ({ browser }) => {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await loginWithDemoButton(page, demoButton);
      storageState = await context.storageState();
      await context.close();
    });

    for (const route of routes) {
      test(`${route} renders without error`, async ({ browser }) => {
        const report: RouteReport = {
          route, boundary: false, consoleErrors: [], pageErrors: [],
          failedRequests: [], blank: false,
        };

        const context = await browser.newContext({
          baseURL,
          storageState: storageState as Parameters<typeof browser.newContext>[0]['storageState'],
        });
        // React passes the component name as a SEPARATE console argument, so
        // `msg.text()` yields "...unique key prop.%s%s" with the useful part
        // missing. Flattening the args before React runs makes the warning name
        // the offending component instead of leaving it to guesswork.
        await context.addInitScript(() => {
          const orig = console.error.bind(console);
          console.error = (...args: unknown[]) =>
            orig(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
        });
        const page = await context.newPage();
        attachCollectors(page, () => report);
        try {
          await visitRoute(page, route, report);
        } finally {
          await context.close();
        }

        // Surface non-blocking warnings so they cannot quietly accumulate.
        const warns = report.consoleErrors.filter(isKeyWarning);
        if (warns.length) console.log(`  WARN ${route}: React list-key warning (page renders; debt)`);

        expect(isBroken(report), `/${route} — ${describeFailure(report)}`).toBe(false);
      });
    }
  });
}

sweep('Doctor Portal', 'http://localhost:5173', 'Mbeki', DOCTOR_ROUTES);
sweep('Patient App', 'http://localhost:5174', 'Thabo', PATIENT_ROUTES);
