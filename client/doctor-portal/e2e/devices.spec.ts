import { test, expect } from '@playwright/test';
import { signIn, settle } from './support';

/**
 * Break-glass, end to end, through the screens a person actually uses.
 *
 * `POST /api/devices/enroll`, `/rotate` and `/revoke` had no caller in either
 * client, and the only device READ was `/api/devices/compliance`, which
 * returns only non-compliant devices. So a healthy fleet was indistinguishable
 * from no fleet, and the device id an emergency grant requires existed nowhere
 * a person could find it — the NFC screen asked a paramedic to type a
 * "Registered device UUID" into a free-text box.
 *
 * The consequence was not cosmetic: `POST /api/emergency/grants` answered
 * `DEVICE_NOT_FOUND` for every request a real deployment could make, so
 * emergency access — the product's headline feature — could not be issued at
 * all.
 *
 * This walks the whole chain in the browser: enrol a device, see it listed as
 * having no credential, provision one, and then find it offered to a clinician
 * on the emergency screen. The last step is the one that matters — a device an
 * administrator can see but a clinician cannot pick is still a dead end.
 */
test('a device is enrolled, credentialed, and then offered for emergency access', async ({
  browser,
}) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'Admin');
  await settle(page, '/devices');

  await expect(page.getByRole('heading', { name: /approved devices/i })).toBeVisible({
    timeout: 20000,
  });

  const name = `E2E tablet ${Date.now()}`;
  await page.locator('#device-name').fill(name);
  await page.locator('#device-fingerprint').fill(`e2e-fp-${Date.now()}`);
  await page.getByRole('button', { name: /enrol device/i }).click();

  const row = page.locator('[data-testid="device-table"] tr').filter({ hasText: name });
  await expect(row).toHaveCount(1, { timeout: 20000 });

  // Enrolled is not usable. Showing a rotation date here would read as a
  // working device on a schedule; it cannot open a record yet.
  await expect(row).toContainText(/no credential yet/i);

  const deviceId = (await row.locator('td').nth(1).innerText()).trim();
  expect(deviceId).not.toEqual('');

  await row.getByRole('button', { name: /provision key/i }).click();
  await expect(row).not.toContainText(/no credential yet/i, { timeout: 20000 });
  await expect(row).toContainText(/active/i);

  // The clinician's side. A device an administrator can see but nobody can
  // pick is still a dead end, so this reads the emergency screen's own picker.
  await settle(page, '/emergency');
  const picker = page.locator('#approved-device');
  await expect(picker).toBeVisible({ timeout: 20000 });
  await expect(picker.locator(`option[value="${deviceId}"]`)).toHaveCount(1, { timeout: 20000 });

  // Revoking it takes it back out of the clinician's picker while leaving the
  // administrative record intact.
  await settle(page, '/devices');
  const again = page.locator('[data-testid="device-table"] tr').filter({ hasText: name });
  await again.getByRole('button', { name: /^revoke$/i }).click();
  await expect(again).toContainText(/revoked/i, { timeout: 20000 });

  await settle(page, '/emergency');
  const afterRevocation = page.locator('#approved-device');
  await expect(afterRevocation).toBeVisible({ timeout: 20000 });
  await expect(afterRevocation.locator(`option[value="${deviceId}"]`)).toHaveCount(0, {
    timeout: 20000,
  });

  await page.close();
});

/**
 * A failed read must not read as an empty fleet.
 *
 * "No devices are enrolled" and "the device store could not be reached" are
 * opposite answers, and an administrator acting on the first when the second is
 * true enrols a duplicate.
 */
test('a failed device read says so instead of showing an empty fleet', async ({ browser }) => {
  test.setTimeout(120000);
  // `serviceWorkers: 'block'` is required, not tidiness. The portal registers a
  // service worker that handles `/api` fetches, and Playwright does not
  // intercept requests a service worker makes -- so `page.route` below silently
  // did nothing and the page rendered the real device list.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await signIn(page, 'Admin');

  // A URL predicate, not a glob: `/api/devices/available` must keep working,
  // and only the exact collection path is being failed here.
  await page.route(
    (url) => url.pathname === '/api/devices',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'DEVICE_PERSISTENCE_REQUIRED', message: 'Managed-device storage is unavailable' },
        }),
      })
  );
  await settle(page, '/devices');

  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/no devices are enrolled/i)).toHaveCount(0);

  await context.close();
});
