import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { signIn, settle, fixturePatientId, ROLES, type RoleName } from './support';
import {
  auditContrast,
  freezeMotion,
  reportContrast,
  setTheme,
  type ContrastFailure,
} from '../../shared/src/testing/contrastAudit';

// Outside `test-results/`, which Playwright empties at the start of every run --
// running one role at a time would otherwise delete the others' reports.
const REPORT_DIR = '../../.browser-test/colour-sweep';

/**
 * Every screen each role is offered, measured in both themes.
 *
 * `contrast.spec.ts` guards twelve routes. The portal has 87, and the text a
 * clinician could not read was always on one of the other 75: nobody writes a
 * regression test for a screen before they know it is broken. So this does not
 * take a list. Each role signs in, opens every section of its own sidebar, and
 * measures every link it finds -- which is also the set of screens that role
 * can actually reach, because the router authorises from the same navigation.
 * The patient chart is added by hand; it is reached from a list, not a link.
 *
 * Paced, not parallel. The API rate-limits authenticated callers at 120
 * requests a minute, and a screen that loses its data to a 429 renders an
 * error banner instead of the table whose colours were the point.
 *
 * Results are also written to `.browser-test/colour-sweep/<role>.json`, so a
 * failing run leaves a list to work through rather than the first assertion.
 */
// Not serial: each role opens its own page, so one role's failures must not
// skip the others. The config's single worker keeps them sequential.

const REQUESTS_PER_MINUTE = 90;

async function openEverySection(page: Page) {
  // Twice: opening one section can reveal another's toggle.
  for (let pass = 0; pass < 2; pass++) {
    const closed = page.locator('nav button[aria-expanded="false"]:visible');
    const count = await closed.count();
    for (let i = 0; i < count; i++) {
      await closed.first().click({ timeout: 2000 }).catch(() => undefined);
    }
  }
}

async function sidebarRoutes(page: Page): Promise<string[]> {
  await openEverySection(page);
  const hrefs = await page
    .locator('nav a[href^="/"]')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href') || ''));
  return Array.from(new Set(hrefs.filter((h) => h && h !== '/' && !h.startsWith('/login'))));
}

/** Keep under the API's per-minute budget, counted from the page's own requests. */
function pacer(page: Page) {
  const stamps: number[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) stamps.push(Date.now());
  });
  return async () => {
    for (;;) {
      const cutoff = Date.now() - 60_000;
      while (stamps.length && stamps[0] < cutoff) stamps.shift();
      if (stamps.length < REQUESTS_PER_MINUTE) return;
      await page.waitForTimeout(stamps[0] + 60_500 - Date.now());
    }
  };
}

interface RouteResult {
  path: string;
  reached: boolean;
  note?: string;
  light?: { sampled: number; failures: ContrastFailure[] };
  dark?: { sampled: number; failures: ContrastFailure[] };
}

for (const role of ROLES) {
  test(`${role}: every screen is readable in both themes`, async ({ browser }) => {
    test.setTimeout(60 * 60_000);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pace = pacer(page);
    await signIn(page, role as RoleName);
    await freezeMotion(page);

    const routes = await sidebarRoutes(page);
    if (role === 'Doctor' || role === 'Nurse') routes.push(`/patients/${fixturePatientId()}`);

    const results: RouteResult[] = [];
    for (const path of routes) {
      await pace();
      const result: RouteResult = { path, reached: false };
      try {
        await settle(page, path);
        result.reached = page.url().includes(path);
        if (!result.reached) result.note = `landed on ${new URL(page.url()).pathname}`;
      } catch (error) {
        result.note = String(error).slice(0, 200);
      }
      if (result.reached) {
        for (const theme of ['light', 'dark'] as const) {
          await setTheme(page, theme);
          const audit = await auditContrast(page);
          result[theme] = { sampled: audit.sampled, failures: audit.failures };
          if (audit.failures.length) console.log(reportContrast(`${role} ${path}`, theme, audit));
        }
        await setTheme(page, 'light');
      }
      results.push(result);
    }
    await page.close();

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(`${REPORT_DIR}/${role}.json`, JSON.stringify(results, null, 2));

    const unreached = results.filter((r) => !r.reached).map((r) => `${r.path}: ${r.note}`);
    const failing = results.flatMap((r) =>
      (['light', 'dark'] as const).flatMap((theme) =>
        (r[theme]?.failures ?? []).map((f) => `${r.path} [${theme}] ${f.ratio}:1 "${f.text}" ${f.selector}`)
      )
    );
    expect(unreached, `${role} was offered screens it could not open`).toEqual([]);
    expect(failing, `${role}: text below WCAG AA`).toEqual([]);
  });
}
