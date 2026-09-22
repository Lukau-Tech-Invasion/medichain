import { test, expect, type Page, type Response } from '@playwright/test';
import { signIn, settle, ROLES, type RoleName } from './support';

/**
 * Every screen a role is offered must be answered for that role.
 *
 * The portal's router authorizes routes from each role's navigation, and each
 * API handler authorizes from its own role predicate. The two are maintained
 * separately and drift: on 2026-09-19 `/note-templates` was reachable only by
 * administrators while its API served only doctors and nurses, so nobody could
 * use it — and every existing test passed, because unit tests mock the API and
 * the WCAG audit only looks at pixels.
 *
 * This opens each route a role's own sidebar offers and fails on any API
 * refusal (401/403), missing route (404/405) or server error (5xx) the screen
 * triggers. A 404 from a lookup by id can be a legitimate "no such record";
 * those are listed in ACCEPTED with the reason.
 */

/** Refusals that are the correct answer, not a defect. `role route METHOD path-prefix`. */
const ACCEPTED: Record<string, string> = {};

async function reachableRoutes(page: Page): Promise<string[]> {
  const sections = page.locator('nav button[aria-expanded="false"]');
  const count = await sections.count();
  for (let i = 0; i < count; i++) {
    await sections.nth(i).click({ timeout: 2000 }).catch(() => undefined);
  }
  const hrefs = await page.locator('nav a[href]').evaluateAll((links) =>
    links.map((l) => (l as HTMLAnchorElement).getAttribute('href') || '')
  );
  return [...new Set(hrefs.filter((h) => h.startsWith('/') && !h.startsWith('//')))];
}

function normalise(path: string): string {
  return path
    .replace(/PAT-[0-9a-z-]+/gi, '{patient}')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '{uuid}')
    .replace(/5[1-9A-HJ-NP-Za-km-z]{46,47}/g, '{wallet}');
}

for (const role of ROLES) {
  test(`${role}: every offered screen is answered by the API`, async ({ browser }) => {
    test.setTimeout(900_000);
    const page = await browser.newPage();
    await signIn(page, role as RoleName);
    const routes = await reachableRoutes(page);
    const refusals: string[] = [];
    let current = '';
    const onResponse = (response: Response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/')) return;
      const status = response.status();
      if (status === 401 || status === 403 || status === 404 || status === 405 || status >= 500) {
        const key = `${role} ${current} ${response.request().method()} ${normalise(url.pathname)} -> ${status}`;
        const accepted = Object.keys(ACCEPTED).some((prefix) => key.startsWith(prefix));
        if (!accepted) refusals.push(key);
      }
    };
    page.on('response', onResponse);
    for (const route of routes) {
      current = route;
      await settle(page, route).catch(() => undefined);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    }
    page.off('response', onResponse);
    await page.close();
    expect([...new Set(refusals)], `API refusals on screens ${role} is offered:\n${[...new Set(refusals)].join('\n')}`).toEqual([]);
  });
}
