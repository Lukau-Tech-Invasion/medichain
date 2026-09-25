import { test, expect, type Page } from '@playwright/test';
import { signIn, settle } from './support';
import { auditContrast, setTheme, reportContrast } from './audit';

/**
 * One sign-in per spec file, on a page shared by every test in it.
 *
 * Playwright's `page` fixture is per-test, so a `beforeEach` sign-in meant 24
 * sign-ins in a run. Each is several requests against an API that rate-limits
 * at 60/minute, so the suite collapsed into RATE_LIMIT_EXCEEDED — surfacing as
 * navigation timeouts that look like application faults and are not.
 *
 * Serial mode is required, not incidental: the tests share one page, so they
 * cannot run in parallel against it. That is an acceptable trade here because
 * the audit is read-only — it measures what is painted and changes nothing.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await page?.close();
});


/**
 * Measured contrast audit of the rendered application, in both themes.
 *
 * Why this is an end-to-end test and not a unit test
 * --------------------------------------------------
 * Contrast is a property of *painted pixels*, not of source code. A component
 * can name a perfectly good token and still fail, because the colour it ends up
 * with depends on which ancestor supplied the background, which theme is
 * active, and which variant won the cascade. None of that exists until the page
 * is rendered in a browser.
 *
 * Every readability defect found on this project was found by looking at the
 * running application. `scripts/placeholder-audit.py` reported BEHAVIOURAL 0
 * while the analytics dashboard rendered twelve fabricated KPIs; the same
 * dashboard later shipped a 2.43:1 label that no unit test noticed. A gate that
 * reads source cannot catch either.
 *
 * This walks every rendered text node, resolves the colour it is actually
 * painted in and the background it is actually painted on, and applies the
 * WCAG 2.2 AA thresholds (1.4.3): 4.5:1 for normal text, 3:1 for large text
 * (>=24px, or >=18.66px when bold).
 */

/**
 * Routes worth guarding.
 *
 * No `/doctor` prefix: that prefix exists only when nginx serves both portals
 * from one origin (`VITE_BASE_PATH=/doctor`). Playwright drives the standalone
 * dev server, which mounts at `/`. Using the nginx paths here silently
 * redirected every route to `/dashboard` — five "passing" audits of the same
 * screen. The URL assertion below is what caught it, and is why it stays.
 */
const ROUTES = [
  // Clinical-risk first: on these screens a misread number or a missed alert
  // has a consequence for a patient, not just an annoyance for a user.
  { path: '/emergency', name: 'Emergency access' },
  { path: '/medication-admin', name: 'Medication administration' },
  { path: '/triage', name: 'Triage' },
  { path: '/code-blue', name: 'Code blue' },
  { path: '/vitals', name: 'Vital signs' },
  { path: '/orders', name: 'Orders' },
  { path: '/drug-interactions', name: 'Drug interactions' },
  // Then the everyday surfaces.
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/analytics', name: 'Analytics' },
  { path: '/patients', name: 'Patient search' },
  { path: '/user-management', name: 'User management' },
  { path: '/settings', name: 'Settings' },
];


/**
 * Every route below is behind auth. Without signing in first, all ten tests
 * would happily measure the login page and report full coverage of screens they
 * never opened — the same shape of false assurance this suite exists to catch.
 */
for (const route of ROUTES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${route.name} meets WCAG AA in ${theme} mode`, async () => {
      // `settle`, not `page.goto`. A goto is a full document load, and this
      // app deliberately persists nothing that can re-authenticate — so every
      // goto landed on /login and rendered an empty page. `settle` navigates
      // client-side, which keeps the in-memory session and is what a clinician
      // actually does.
      await settle(page, route.path);
      // Guard against a silent redirect back to /login leaving the audit
      // measuring the wrong screen.
      expect(page.url(), `${route.name} redirected away from ${route.path}`).toContain(route.path);
      await setTheme(page, theme);

      const result = await auditContrast(page);

      expect(result.sampled, `${route.name} rendered no measurable text`).toBeGreaterThan(0);
      expect(result.failures, reportContrast(route.name, theme, result)).toHaveLength(0);
    });
  }
}
