import { test, expect, type Page } from '@playwright/test';
import { signIn, settle, ROLES, ROLE_HOME, type RoleName } from './support';
import { auditContrast, auditTargetSize, setTheme, reportContrast } from './audit';

/**
 * Every account the portal serves, audited as itself.
 *
 * # Why this exists
 *
 * `contrast.spec.ts` and `accessibility.spec.ts` sign in as a doctor and audit
 * twelve routes. That is one of five accounts. The other four are not the same
 * application wearing a different badge:
 *
 *   * each role gets a different navigation tree — 37 routes for a doctor, 14
 *     for an administrator, 7 for a pharmacist;
 *   * `/dashboard` is one URL and five different pages —
 *     `SmartDashboardRouter` dispatches on the signed-in role — so four of
 *     those five had never been rendered by any browser test.
 *
 * Every defect this suite has ever found was on a screen somebody actually
 * opened. Four accounts nobody opened is four accounts nobody checked — and the
 * lab technician's and nurse's dashboards turned out to be exactly where the
 * unread payload fields were hiding.
 *
 * # Why the routes are read from the running sidebar
 *
 * Not from `config/navigation.ts`. The question is what *this account can
 * reach*, and the answer is the intersection of what the config offers and what
 * the server permits. Reading the rendered navigation asks the application
 * rather than its source, and a route that disappears for a role — correctly or
 * not — changes the audit instead of silently passing an empty page.
 *
 * # Why one test sweeps many routes
 *
 * A test per route would need names at collection time, before any browser
 * exists, which means hardcoding the lists this file deliberately does not
 * hardcode. Sweeping inside one test and aggregating every failure is the
 * trade: the report names every failing route at once rather than stopping at
 * the first, which is more useful anyway.
 */

/**
 * A route each role has no business reaching.
 *
 * Chosen to be unambiguous: `/user-management` assigns and revokes roles and is
 * `Admin`-only server-side; `/admin` is the administrator's own dashboard. A
 * clinician who can open either has escaped their role.
 */
const FORBIDDEN: Record<RoleName, string> = {
  Doctor: '/user-management',
  Nurse: '/user-management',
  Pharmacist: '/user-management',
  LabTechnician: '/user-management',
  // `/mar` is the medication administration record — a nurse's screen, and one
  // `ADMIN_NAV` deliberately omits along with the rest of the bedside clinical
  // set.
  //
  // This was skipped at first, on the reasoning that an administrator is the
  // highest-privilege account so no route is unambiguously theirs to be refused.
  // That was the wrong frame. The product had already made the decision — twice,
  // in `ADMIN_NAV` — and the router simply did not enforce it, so the question
  // was never "should this be refused?" but "why does the navigation say one
  // thing and the router another?".
  Admin: '/mar',
};

/** Read what this account can actually navigate to, from its own sidebar. */
async function reachableRoutes(page: Page): Promise<string[]> {
  // Sections are collapsible and start collapsed, so their links are absent
  // from the DOM rather than merely hidden.
  const sections = page.locator('nav button[aria-expanded="false"]');
  const count = await sections.count();
  for (let i = 0; i < count; i++) {
    await sections
      .nth(i)
      .click({ timeout: 2000 })
      .catch(() => undefined);
  }
  // Both sidebars are in the DOM (mobile and desktop), so every route appears
  // twice; the Set below collapses that.
  const hrefs = await page.locator('nav a[href]').evaluateAll((links) =>
    links.map((l) => (l as HTMLAnchorElement).getAttribute('href') || '')
  );
  return [...new Set(hrefs.filter((h) => h.startsWith('/') && !h.startsWith('//')))];
}

/**
 * Get back to a working page after an ErrorBoundary has taken over.
 *
 * The boundary offers "Reload Page", which is a full document load — and this
 * app deliberately persists nothing that can re-authenticate, so reloading
 * lands on the sign-in screen. Signing in again is the only way back, and it is
 * cheaper than losing the rest of the sweep.
 */
async function recoverFromCrash(page: Page, role: RoleName): Promise<boolean> {
  const isCrashed = await page
    .locator('text=An unexpected error occurred')
    .first()
    .isVisible()
    .catch(() => false);
  if (!isCrashed) return false;
  await signIn(page, role);
  return true;
}

for (const role of ROLES) {
  test.describe(`${role} account`, () => {
    // Serial, and one sign-in for the whole block. Playwright's `page` fixture
    // is per-test, so a sign-in per test would be five roles' worth of
    // authentication against an API that rate-limits at 60/minute — the
    // failure mode being navigation timeouts that read as application faults.
    test.describe.configure({ mode: 'serial' });

    let page: Page;
    let routes: string[] = [];

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage();
      await signIn(page, role);
      routes = await reachableRoutes(page);
    });

    test.afterAll(async () => {
      await page?.close();
    });

    test('lands on its own home with its own navigation', async () => {
      expect(page.url(), `${role} did not land on ${ROLE_HOME[role]}`).toContain(ROLE_HOME[role]);

      expect(
        routes.length,
        `${role} sees no navigation at all. Either the sidebar failed to render or ` +
          `getNavForRole fell through to its Doctor default and then rendered nothing.`
      ).toBeGreaterThan(0);

      // The greeting is personalised — asserting a specific person ties this to
      // a fixture that has already been replaced twice.
      const main = page.locator('main').first();
      await expect(main).toBeVisible();
    });

    test('cannot reach a route belonging to another role', async () => {
      const forbidden = FORBIDDEN[role];
      expect(
        routes,
        `${role}'s sidebar offers ${forbidden}, which belongs to another role`
      ).not.toContain(forbidden);

      // Absent from the navigation is not the same as unreachable: a typed URL
      // or a stale bookmark still resolves. Push the route through the router
      // and require that the account does not end up looking at a working page.
      await page.evaluate((p) => {
        window.history.pushState({}, '', p);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, forbidden);
      await page.waitForTimeout(1500);

      const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
      const refused =
        !page.url().includes(forbidden) ||
        /denied|not authori|permission|forbidden|restricted|no access/.test(body);

      expect(
        refused,
        `${role} opened ${forbidden} and the page rendered without any refusal.\n` +
          `  URL: ${page.url()}\n` +
          `  This is a UI-level finding: the endpoints behind the screen enforce\n` +
          `  their own RBAC, so data is not necessarily exposed. A screen that\n` +
          `  renders its controls and then fails every one of them on submit is\n` +
          `  still the wrong answer to give a clinician.`
      ).toBe(true);

      // Leave the account where it belongs for the sweep that follows.
      await settle(page, ROLE_HOME[role]);
    });

    test('every route it can reach meets WCAG AA in both themes', async () => {
      test.setTimeout(15 * 60 * 1000);

      const contrastFailures: string[] = [];
      const targetFailures: string[] = [];
      const unreachable: string[] = [];
      // Routes that took the whole tree down, as distinct from routes that
      // merely did not settle.
      const crashed: string[] = [];
      let sampled = 0;

      for (const route of routes) {
        // Keep `settle`'s own message. It already reports the URL and the first
        // 200 characters of the page, and "did not open" without either of
        // those is a bug report nobody can act on.
        const why = await settle(page, route)
          .then(() => '')
          .catch((error) => String(error).replace(/\s+/g, ' ').slice(0, 260));
        if (why) {
          unreachable.push(`${route} — ${why}`);
          // One crashed page must not be reported as nine.
          //
          // The ErrorBoundary sits above the router, so a render error on any
          // route replaces the entire tree — sidebar included — and stays there.
          // Every subsequent route then failed with the same message, and a
          // single broken History & Physical page read as eight more.
          if (await recoverFromCrash(page, role)) crashed.push(route);
          continue;
        }
        if (!page.url().includes(route)) {
          unreachable.push(`${route} — settled, but the URL is ${page.url()}`);
          continue;
        }

        for (const theme of ['light', 'dark'] as const) {
          await setTheme(page, theme);
          const result = await auditContrast(page);
          sampled += result.sampled;
          if (result.failures.length) {
            contrastFailures.push(reportContrast(route, theme, result));
          }
        }

        // Target size is a geometry question, not a colour one, so it is
        // measured once per route rather than once per theme.
        const undersized = await auditTargetSize(page);
        if (undersized.length) {
          targetFailures.push(
            `${route}: ${undersized.length} target(s) below 24x24\n` +
              undersized.map((u) => `    ${u.selector} ${u.w}x${u.h} "${u.text}"`).join('\n')
          );
        }
      }

      // Soft, so one category does not hide the other. A run that fails both
      // should say so once rather than over two runs.
      expect
        .soft(
          crashed,
          `${role}: routes that threw during render and were caught by the ErrorBoundary:\n  ` +
            crashed.join('\n  ')
        )
        .toHaveLength(0);

      expect
        .soft(unreachable, `${role}: routes in its own navigation that would not open:\n  ${unreachable.join('\n  ')}`)
        .toHaveLength(0);

      expect
        .soft(sampled, `${role}: measured no text at all across ${routes.length} route(s)`)
        .toBeGreaterThan(0);

      expect
        .soft(contrastFailures, `${role} — WCAG 2.2 SC 1.4.3:\n${contrastFailures.join('\n')}`)
        .toHaveLength(0);

      expect
        .soft(targetFailures, `${role} — WCAG 2.2 SC 2.5.8:\n${targetFailures.join('\n')}`)
        .toHaveLength(0);
    });
  });
}
