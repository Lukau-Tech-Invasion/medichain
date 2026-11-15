/**
 * Wireframe conformance for the patient app (docs/ux-mockups p1-p6): each
 * screen opened with real data, a screenshot kept beside the mockup's, and the
 * wireframe's essentials asserted.
 *
 * Screenshots: .browser-test/wireframes/<id>.png
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settle, signIn } from './support';

const OUT = resolve(fileURLToPath(new URL('../../../.browser-test/wireframes', import.meta.url)));
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, id: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${id}.png`, fullPage: true });
}

test.describe.configure({ mode: 'serial' });

test.describe('phone', () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test('p1 home, p2 my health, p3 me, p4 records, p5 record sheet', async ({ page }) => {
    await signIn(page);
    await settle(page, '/dashboard');
    await shot(page, 'p1-home');
    // Five tabs (Phase 8).
    const nav = page.getByRole('navigation').last();
    for (const tab of ['Home', 'My health', 'Visits', 'Messages', 'Me']) {
      await expect(nav.getByRole('link', { name: new RegExp(tab, 'i') }).first()).toBeVisible();
    }
    await settle(page, '/health');
    await shot(page, 'p2-my-health');
    await settle(page, '/me');
    await shot(page, 'p3-me');
    await settle(page, '/records');
    await shot(page, 'p4-records');
    const first = page.getByRole('button').filter({ hasText: /\d{1,2} [A-Z][a-z]{2}|[A-Z][a-z]{2} \d{1,2}, \d{4}/ }).first();
    if (await first.isVisible().catch(() => false)) {
      await first.click();
      await page.waitForTimeout(1200);
      await expect(page.getByRole('dialog')).toBeVisible();
      await shot(page, 'p5-record-sheet');
    } else {
      throw new Error('p5: no record row to open on /records');
    }
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('p6 records on a desktop', async ({ page }) => {
    await signIn(page);
    await settle(page, '/records');
    await shot(page, 'p6-desktop-records');
  });
});
