import { test, expect } from '@playwright/test';
import { readFixtures } from './identity';
import { openChartWithReason, signIn } from './support';

/**
 * The emergency capsule, through the screen.
 *
 * The capsule is the product's headline claim: tap a card, see blood type,
 * allergies and directives within three seconds. Four endpoints implement the
 * POPIA requirement that it be versioned, revocable and access-logged, and not
 * one had a client function — so a capsule could never be published from the
 * product, and the values a paramedic reads were whatever a script last wrote.
 *
 * Two of the four reads did not exist at all: `current()` and `history()` were
 * on the repository from the start with no HTTP route, which left revoke
 * unreachable (it takes a version number nobody could read) and publishing
 * unverifiable. `GET /api/patients/{id}/emergency-capsule` is new.
 */
function fixturePatientId(): string {
  return readFixtures().patient.linked_patient_id;
}

test('a capsule version is published, seen, and revoked', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'Doctor', 0);
  await openChartWithReason(page, fixturePatientId());

  await page.getByRole('button', { name: /access/i }).first().click();
  await expect(page.getByText(/Emergency capsule/i).first()).toBeVisible({ timeout: 20000 });

  const rows = page.locator('[data-testid="capsule-version-list"] li');

  await page.getByRole('button', { name: /publish a new version/i }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText(/is now in force/i, { timeout: 20000 });

  // The row this run published, by the version number the notice names. Not
  // `rows.first()` after a count: the count was taken while the history was
  // still loading, so on 2026-10-13 the poll passed on the stale list and the
  // test revoked the previous version instead of its own.
  const version = Number(/Version (\d+)/.exec((await status.innerText()) ?? '')?.[1]);
  expect(version).toBeGreaterThan(0);
  const published = rows.filter({ hasText: new RegExp(`^\\s*Version ${version}\\b`) });
  await expect(published).toHaveCount(1, { timeout: 20000 });
  await published.getByRole('button', { name: /^Revoke$/i }).click();

  // Revoking is never deletion: a directive having been in force between two
  // dates is part of the clinical record.
  await expect(status).toContainText(new RegExp(`Version ${version} was revoked. Its record stays`, 'i'), {
    timeout: 20000,
  });
  await expect(published).toHaveCount(1);
  await expect(published.getByText(/Revoked/i)).toBeVisible();
  await expect(published.getByRole('button', { name: /^Revoke$/i })).toHaveCount(0);

  await page.close();
});

/**
 * A failed read must not read as a blank card.
 *
 * "This patient has no emergency capsule" tells a clinician the card is empty.
 * If the read failed, they do not know that — and acting on the first when the
 * second is true is how a paramedic ends up believing there are no allergies.
 */
test('a failed capsule read says so instead of showing a blank card', async ({ browser }) => {
  test.setTimeout(120000);
  // Playwright does not intercept requests a service worker makes, and this
  // portal registers one that handles /api fetches.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await signIn(page, 'Doctor');

  await page.route(
    (url) => /\/api\/patients\/[^/]+\/emergency-capsule$/.test(url.pathname),
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'capsule store unavailable' },
        }),
      })
  );
  await openChartWithReason(page, fixturePatientId());
  await page.getByRole('button', { name: /access/i }).first().click();

  await expect(page.getByText(/not an empty card/i)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/No capsule has been published/i)).toHaveCount(0);

  await context.close();
});
