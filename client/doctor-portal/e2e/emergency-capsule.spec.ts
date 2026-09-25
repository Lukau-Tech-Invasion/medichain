import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, settle } from './support';

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
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..');
  const fixtures = JSON.parse(
    readFileSync(join(root, '.browser-test', 'fixtures.json'), 'utf8')
  ) as { patient: { linked_patient_id: string } };
  return fixtures.patient.linked_patient_id;
}

test('a capsule version is published, seen, and revoked', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'Doctor');
  await settle(page, `/patients/${fixturePatientId()}`);

  await page.getByRole('button', { name: /access/i }).first().click();
  await expect(page.getByText(/Emergency capsule/i).first()).toBeVisible({ timeout: 20000 });

  const rows = page.locator('[data-testid="capsule-version-list"] li');
  const before = await rows.count();

  await page.getByRole('button', { name: /publish a new version/i }).click();
  await expect(page.getByRole('status')).toContainText(/is now in force/i, { timeout: 20000 });
  await expect.poll(() => rows.count(), { timeout: 20000 }).toBeGreaterThan(before);

  // The newest row is the one this run published.
  const newest = rows.first();
  await newest.getByRole('button', { name: /^Revoke$/i }).click();

  // Revoking is never deletion: a directive having been in force between two
  // dates is part of the clinical record.
  await expect(page.getByRole('status')).toContainText(/Its record stays/i, { timeout: 20000 });
  await expect.poll(() => rows.count(), { timeout: 20000 }).toBeGreaterThan(before);
  await expect(newest.getByText(/Revoked/i)).toBeVisible();

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
  await settle(page, `/patients/${fixturePatientId()}`);
  await page.getByRole('button', { name: /access/i }).first().click();

  await expect(page.getByText(/not an empty card/i)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/No capsule has been published/i)).toHaveCount(0);

  await context.close();
});
