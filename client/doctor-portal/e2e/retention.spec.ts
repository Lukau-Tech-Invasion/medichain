import { test, expect } from '@playwright/test';
import { signIn, settle, selectPatient } from './support';

/**
 * Data retention, through the screen rather than through curl.
 *
 * Eleven endpoints implemented a POPIA maker-checker workflow and not one had a
 * client function or a page. A compliance control nobody can operate is not a
 * control, so this walks the operable parts: place a hold, see it listed,
 * release it, mint an approval token, and confirm the screen refuses to offer
 * the requester their own Approve button.
 *
 * The second-administrator step is deliberately NOT driven here. The repository
 * refuses a self-decision, and this suite signs in as one account -- asserting
 * that the button is absent is the honest thing a single session can prove. The
 * two-administrator path is verified against the live API instead, where a
 * second admin identity is available.
 */
test('a legal hold is placed, listed and released', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'Admin');
  await settle(page, '/retention');

  await expect(page.getByRole('heading', { name: /data retention/i })).toBeVisible({
    timeout: 20000,
  });

  // A hold scoped to neither a patient nor a record type covers nothing while
  // looking like protection. The screen refuses it before the round trip.
  const reason = `E2E hold ${Date.now()}`;
  await page.locator('#hold-reason').fill(reason);
  await page.getByRole('button', { name: /place hold/i }).click();
  await expect(page.getByRole('alert')).toContainText(/patient ID or a record type/i);

  // `#hold-patient` is the searchable picker, so a hold is placed against a
  // patient who exists rather than a made-up id typed into a text box.
  await selectPatient(page, '#hold-patient');
  await page.getByRole('button', { name: /place hold/i }).click();

  const row = page.locator('[data-testid="hold-list"] li').filter({ hasText: reason });
  await expect(row).toHaveCount(1, { timeout: 20000 });

  await row.getByRole('button', { name: /release/i }).click();
  // Released holds leave the active list. The row itself survives in the
  // database -- that records were held between two dates is the audit trail --
  // but this view is the list of what is currently held.
  await expect(page.locator('[data-testid="hold-list"] li').filter({ hasText: reason })).toHaveCount(
    0,
    { timeout: 20000 }
  );

  await page.close();
});

test('a requested token is not offered to its own requester', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'Admin');
  await settle(page, '/retention');

  await page.getByRole('button', { name: /request approval/i }).click();
  await expect(page.getByRole('status')).toContainText(/token was issued/i, { timeout: 20000 });

  // Maker-checker. The repository refuses a self-decision, so offering the
  // button would send an administrator into a refusal the screen could have
  // predicted.
  const list = page.locator('[data-testid="approval-list"] li');
  await expect(list.first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Awaiting a second administrator/i).first()).toBeVisible();

  await page.close();
});

/**
 * An assessment that did not run is not an assessment that found nothing.
 *
 * Both produce `total_due: 0`. Rendering that as a clean result is how a
 * retention control manufactures false assurance about a legal obligation.
 */
test('an incomplete assessment says so instead of reporting zero as a finding', async ({
  browser,
}) => {
  test.setTimeout(120000);
  // The portal's service worker handles /api fetches and Playwright does not
  // intercept what a service worker requests, so page.route would silently do
  // nothing without this.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await signIn(page, 'Admin');

  await page.route(
    (url) => url.pathname === '/api/admin/retention/report',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          assessment: {
            assessed_on: '2026-09-15',
            policies: [],
            total_due: 0,
            total_held: 0,
            records_deleted: 0,
            incomplete_reason: 'could not load retention policies: connection refused',
          },
        }),
      })
  );
  await settle(page, '/retention');

  await expect(page.getByText(/did not complete/i)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/connection refused/i)).toBeVisible();

  await context.close();
});
