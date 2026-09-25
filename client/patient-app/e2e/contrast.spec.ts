import { test, expect } from '@playwright/test';
import { signIn, settle, ROUTES } from './support';
// The one auditor both applications use. This file kept its own copy, which
// measured only a fixed list of tags and skipped form-control values -- the
// blind spot that let the white insurance policy number through.
import { auditContrast, reportContrast, setTheme } from '../../shared/src/testing/contrastAudit';

/**
 * Measured contrast audit of the patient app, in both themes.
 *
 * Contrast is a property of painted pixels, not of source. A component can name
 * a perfectly good token and still fail depending on which ancestor supplied the
 * background and which variant won the cascade — so this walks the rendered
 * page rather than reading the code.
 *
 * The patient app had **no browser test of any kind** before this file. Every
 * claim made about contrast, keyboard access and reflow on this project applied
 * only to the doctor portal, across 53 pages that had never been opened by a
 * test. This app is arguably the higher-risk surface: non-expert users, personal
 * phones, varied lighting, and at least one screen read during an emergency.
 *
 * Thresholds are WCAG 2.2 SC 1.4.3 Level AA: 4.5:1 for normal text, 3:1 for
 * large text (>=24px, or >=18.66px when bold).
 */

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

for (const route of ROUTES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${route.name} meets WCAG AA in ${theme} mode`, async ({ page }) => {
      await settle(page, route.path);
      // Guard against a silent redirect to /login leaving the audit measuring
      // the wrong screen and reporting coverage it never had.
      expect(page.url(), `${route.name} redirected away from ${route.path}`).toContain(route.path);
      await setTheme(page, theme);

      const result = await auditContrast(page);

      expect(result.sampled, `${route.name} rendered no measurable text`).toBeGreaterThan(0);
      expect(result.failures, reportContrast(route.name, theme, result)).toHaveLength(0);
    });
  }
}
