import { test, expect, type Page } from '@playwright/test';
import { portalPath } from '../../doctor-portal/e2e/portal-path';
import { requestPacer, signIn, testFixtures } from './support';

/**
 * Every patient route against the same route-level checks as the staff
 * portal's `all-routes.spec.ts`: deep link and refresh, back and forward,
 * phone width, keyboard, labels, dialog semantics, and an ended session that
 * returns the patient to the page they were on.
 *
 * It opens each page and checks the page; the workflow specs exercise
 * what the controls do.
 */

const PROTECTED_ROUTES = [
  '/dashboard', '/me', '/profile', '/records', '/privacy', '/emergency-card', '/cards', '/medications',
  '/appointments', '/messages', '/symptoms', '/settings', '/survey',
  '/vitals', '/lab-results', '/medical-history',
] as const;
/**
 * Pages merged into a screen (patient-app plan, approved 2026-11-04). Each old
 * address must still land on the part of the screen that absorbed it, so a
 * bookmark or a link in a message is not broken.
 */
const REDIRECTS: Record<string, string> = {
  '/consent': '/privacy',
  '/access-history': '/privacy?view=viewed',
  '/medical-id': '/emergency-card?view=medical-id',
  '/insurance': '/cards',
  '/family': '/cards?view=family',
  '/language': '/settings?view=language',
  '/offline-sync': '/settings?view=offline',
  '/reminders': '/medications',
  '/telehealth': '/appointments?view=video',
  '/wearables': '/vitals?view=devices',
  '/lab-trends': '/lab-results',
  '/symptom-checker': '/symptoms?view=check',
  '/notifications': '/messages?view=notifications',
};
const PUBLIC_ROUTES = ['/login', '/activate'] as const;

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };

interface Finding {
  route: string;
  check: string;
  detail: string;
}

function routeOf(url: string): string {
  const path = new URL(url).pathname;
  const prefix = process.env.E2E_PORTAL_PREFIX?.replace(/\/$/, '') ?? '';
  return prefix && path.startsWith(prefix) ? path.slice(prefix.length) || '/' : path;
}

async function crashed(page: Page): Promise<boolean> {
  return page.locator('text=/unexpected error|something went wrong/i').first().isVisible().catch(() => false);
}

async function unlabelledControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const named = (el: HTMLElement) => {
      if (el.getAttribute('aria-label')?.trim()) return true;
      const by = el.getAttribute('aria-labelledby');
      if (by && by.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return true;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim()) return true;
      if (el.closest('label')?.textContent?.trim()) return true;
      return Boolean(el.getAttribute('title')?.trim());
    };
    return Array.from(
      document.querySelectorAll<HTMLElement>('main input:not([type=hidden]), main select, main textarea')
    )
      .filter((el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden')
      .filter((el) => !named(el))
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}[name=${el.getAttribute('name') ?? ''}]`)
      .slice(0, 10);
  });
}

async function improperDialogs(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]'))
      .filter((el) => el.getBoundingClientRect().width > 0)
      .filter((el) => {
        const modal = el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG';
        return !modal || !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'));
      })
      .map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60))
  );
}

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

async function signInHere(page: Page) {
  const fx = testFixtures().patient;
  await page.locator('input#username').fill(fx.login_id);
  await page.locator('input#password').fill(fx.password ?? '');
  await page.locator('button[type="submit"]').click();
}

test.describe('public routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} renders signed out, at phone width, with labelled controls`, async ({ page }) => {
      await page.setViewportSize(DESKTOP);
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
    });
  }
});

test('every patient route passes the page checks; an ended session returns to its page', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  const pace = requestPacer(page, 180);
  await signIn(page);

  const findings: Finding[] = [];
  const add = (route: string, check: string, detail: string) => findings.push({ route, check, detail });
  // Anything the Content-Security-Policy blocks is a finding (see the staff spec).
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) {
      add(new URL(page.url()).pathname, 'csp', message.text().slice(0, 300));
    }
  });
  let previous = '';
  for (const route of PROTECTED_ROUTES) {
    await pace();
    // A deep link: a full document load of the route.
    await page.goto(portalPath(route));
    const reached = await page
      .locator('main')
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(1000);
    if (!reached || (await crashed(page))) {
      add(route, 'render', reached ? 'error screen' : `no main; at ${routeOf(page.url())}`);
      continue;
    }
    if (!routeOf(page.url()).startsWith(route)) {
      add(route, 'deep-link', `landed on ${routeOf(page.url())}`);
      continue;
    }
    if (!(await page.locator('main h1, main h2').first().isVisible().catch(() => false))) {
      add(route, 'heading', 'no visible h1/h2 in main');
    }
    const unlabelled = await unlabelledControls(page);
    if (unlabelled.length) add(route, 'labels', unlabelled.join(', '));
    const dialogs = await improperDialogs(page);
    if (dialogs.length) add(route, 'dialogs', dialogs.join(' | '));
    if (!(await keyboardReachable(page))) add(route, 'keyboard', 'the first Tab reached nothing visible');

    if (previous) {
      await page.goBack();
      await page.waitForTimeout(800);
      if (!routeOf(page.url()).startsWith(previous)) add(route, 'back', `back landed on ${routeOf(page.url())}`);
      await page.goForward();
      await page.waitForTimeout(800);
      if (!routeOf(page.url()).startsWith(route)) add(route, 'forward', `forward landed on ${routeOf(page.url())}`);
    }

    await page.reload();
    await page.locator('main').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    if (!routeOf(page.url()).startsWith(route)) add(route, 'refresh', `reload moved to ${routeOf(page.url())}`);

    await page.setViewportSize(PHONE);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) add(route, 'narrow', `page is ${overflow}px wider than a 375px screen`);
    await page.setViewportSize(DESKTOP);
    previous = route;
  }

  // A patient session is not a staff session: the staff portal stays signed out.
  // Its own tab, in the same browser session: the portal's redirect to sign-in
  // can still be loading when the refusal is seen, and in the shared tab that
  // late navigation took over the next step.
  const staffPrefix = '/doctor';
  if (process.env.E2E_PORTAL_PREFIX) {
    const staffTab = await context.newPage();
    await staffTab.goto(new URL(`${staffPrefix}/dashboard`, page.url()).toString());
    const refused = await staffTab
      .waitForURL(/\/doctor\/login/, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (!refused) add('/doctor/dashboard', 'unauthorized', `a patient session reached ${new URL(staffTab.url()).pathname}`);
    await staffTab.close();
  }

  // An ended session returns to sign-in, and signing in returns to the page.
  await page.goto(portalPath('/medications'));
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 20000 });
  await page.context().clearCookies();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const toLogin = await page.waitForURL(/\/login/, { timeout: 20000 }).then(() => true).catch(() => false);
  if (!toLogin) add('/medications', 'session-expiry', `stayed on ${routeOf(page.url())}`);
  else {
    await signInHere(page);
    const back = await page.waitForURL(/\/medications/, { timeout: 30000 }).then(() => true).catch(() => false);
    if (!back) add('/medications', 'session-expiry', `after sign-in landed on ${routeOf(page.url())}`);
  }

  await context.close();
  expect(findings, `\n${findings.map((f) => `  ${f.route} [${f.check}] ${f.detail}`).join('\n')}`).toEqual([]);
});

test('every retired address lands on the section that absorbed it', async ({ page }) => {
  test.setTimeout(240_000);
  const pace = requestPacer(page);
  await signIn(page);
  const wrong: string[] = [];
  for (const [from, to] of Object.entries(REDIRECTS)) {
    await pace();
    await page.goto(portalPath(from));
    await page.locator('main h1').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    const url = new URL(page.url());
    const landed = routeOf(page.url()) + url.search;
    if (landed !== to) wrong.push(`${from} -> ${landed} (expected ${to})`);
  }
  expect(wrong).toEqual([]);
});

test('the route list matches the router', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const declared = [...app.matchAll(/<Route\s+path="([^"*]+)"/g)]
    .map((m) => (m[1].startsWith('/') ? m[1] : `/${m[1]}`))
    .filter((p) => p !== '/');
  const listed = new Set<string>([...PROTECTED_ROUTES, ...PUBLIC_ROUTES, ...Object.keys(REDIRECTS)]);
  expect(declared.filter((p) => !listed.has(p)), 'routes this spec does not cover').toEqual([]);
  expect([...listed].filter((p) => !declared.includes(p)), 'listed routes the router no longer serves').toEqual([]);
});
