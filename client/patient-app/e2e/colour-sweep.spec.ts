import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { signInAsFixturePatient } from './support';
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
 * Every screen in the patient application, measured in both themes.
 *
 * `contrast.spec.ts` guards ten routes; the app has twenty-five. The white
 * policy number in a white insurance box was on one of the other fifteen.
 * This list is every `<Route>` in `App.tsx`, so a screen added there and not
 * here is the only way one goes unmeasured -- and the sweep says which screens
 * it covered, in `.browser-test/colour-sweep/patient.json`.
 */
const ROUTES = [
  '/dashboard', '/profile', '/records', '/consent', '/emergency-card', '/medications',
  '/appointments', '/messages', '/symptoms', '/medical-id', '/settings', '/reminders',
  '/family', '/telehealth', '/wearables', '/lab-trends', '/insurance', '/survey',
  '/symptom-checker', '/language', '/offline-sync', '/vitals', '/lab-results',
  '/notifications', '/medical-history',
];

interface RouteResult {
  path: string;
  reached: boolean;
  light?: { sampled: number; failures: ContrastFailure[] };
  dark?: { sampled: number; failures: ContrastFailure[] };
}

async function measureBothThemes(
  page: import('@playwright/test').Page,
  label: string,
  result: RouteResult
) {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    const audit = await auditContrast(page);
    result[theme] = { sampled: audit.sampled, failures: audit.failures };
    if (audit.failures.length) console.log(reportContrast(label, theme, audit));
  }
}

test('every patient screen, and sign-in, is readable in both themes', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const results: RouteResult[] = [];

  // Sign-in first, before any session exists.
  await page.goto('/login');
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 20000 });
  await freezeMotion(page);
  const login: RouteResult = { path: '/login', reached: true };
  await measureBothThemes(page, 'patient /login', login);
  results.push(login);

  await signInAsFixturePatient(page);
  for (const path of ROUTES) {
    const result: RouteResult = { path, reached: false };
    await page.goto(path);
    result.reached = await page
      .locator('main')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => new URL(page.url()).pathname.endsWith(path))
      .catch(() => false);
    if (result.reached) {
      // Late-arriving data paints into the page; a list that fills in after
      // the audit is a list the audit never checked.
      await page.waitForTimeout(1500);
      await freezeMotion(page);
      await measureBothThemes(page, `patient ${path}`, result);
    }
    results.push(result);
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(`${REPORT_DIR}/patient.json`, JSON.stringify(results, null, 2));

  expect(results.filter((r) => !r.reached).map((r) => r.path), 'screens that did not open').toEqual([]);
  const failing = results.flatMap((r) =>
    (['light', 'dark'] as const).flatMap((theme) =>
      (r[theme]?.failures ?? []).map((f) => `${r.path} [${theme}] ${f.ratio}:1 "${f.text}" ${f.selector}`)
    )
  );
  expect(failing, 'text below WCAG AA').toEqual([]);
});
