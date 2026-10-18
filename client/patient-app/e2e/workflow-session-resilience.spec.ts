import { test, expect, type Page } from '@playwright/test';
import { portalPath } from '../../doctor-portal/e2e/portal-path';
import { signInAsFixturePatient } from './support';

/**
 * Workflow 11 — sessions across tabs, deployments and the device:
 *
 *   two tabs     signing out in one ends the other: its next load returns to
 *                sign-in rather than showing records from a revoked session
 *   the device   the medical ID the service worker kept for offline use is
 *                deleted on sign-out (it used to stay in plain Cache Storage)
 *   old tab      a tab opened before a deployment asks for a chunk the server no
 *                longer has; it reloads once onto the current build instead of
 *                falling into the error screen
 *
 * Physical NFC, camera and Bluetooth, and replaying a queued write after a real
 * network outage, need a device and are not claimed here.
 */

/** Sign out the way a patient does: Settings, Sign Out, then confirm. */
async function signOutFromSettings(page: Page) {
  await page.goto(portalPath('/settings'));
  await page.getByRole('button', { name: 'Sign Out' }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Sign Out?' });
  await confirm.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
}

test.skip(({ isMobile }) => isMobile, 'desktop project only');
test.describe.configure({ mode: 'serial' });

test('signing out in one tab ends the session in the other', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext();
  const first = await context.newPage();
  await signInAsFixturePatient(first);
  const second = await context.newPage();
  await second.goto(portalPath('/records'));
  await expect(second.locator('main').first()).toBeVisible({ timeout: 30000 });

  await signOutFromSettings(first);

  await second.reload();
  await expect(second, 'the second tab still shows records after sign-out').toHaveURL(/\/login/, { timeout: 30000 });
  await context.close();
});

test('the offline medical ID is deleted from the device on sign-out', async ({ page }) => {
  test.setTimeout(120_000);
  await signInAsFixturePatient(page);
  await page.goto(portalPath('/medical-id'));
  await expect(page.locator('main').first()).toBeVisible({ timeout: 30000 });

  const dataCaches = () =>
    page.evaluate(async () => (await caches.keys()).filter((name) => /^medichain-.*data/.test(name)));
  // The worker caches the medical ID when it serves it; wait for that write.
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
  test.skip(!controlled, 'no service worker controls this page (dev server or blocked workers)');
  await expect.poll(dataCaches, { timeout: 20000 }).not.toEqual([]);

  await signOutFromSettings(page);
  await expect.poll(dataCaches, { timeout: 20000 }).toEqual([]);
});

test.describe('after a deployment', () => {
  // The production service worker answers from its precache, and route
  // interception never sees a worker's fetch: block it so the chunk request
  // reaches the network, where the deployment has removed it.
  test.use({ serviceWorkers: 'block' });

  test('a tab from before a deployment reloads onto the current build instead of failing', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAsFixturePatient(page);
    await page.evaluate(() => sessionStorage.removeItem('medichain_stale_chunk_reload_at'));

    // From now on the first lazily loaded chunk is "gone", as after a deploy.
    let failed = false;
    await page.route('**/assets/*.js', async (route) => {
      if (!failed) {
        failed = true;
        await route.fulfill({ status: 404, body: 'Not Found' });
        return;
      }
      await route.continue();
    });

    const reloaded = page.waitForEvent('load', { timeout: 30000 });
    // A client-side move to a screen whose code has not loaded yet.
    await page.evaluate((path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, portalPath('/lab-trends'));
    await reloaded;

    await expect(page.locator('main').first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/an unexpected error occurred|something went wrong/i)).toHaveCount(0);
    expect(failed, 'no chunk was requested, so nothing was proved').toBe(true);
  });
});
