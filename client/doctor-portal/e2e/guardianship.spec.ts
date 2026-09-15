import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signIn, settle } from './support';

/**
 * Who may act for a patient.
 *
 * Three guardianship endpoints existed — verify, amend permissions, revoke —
 * and **all three write**. Nothing could read. `get_by_ward` is documented in
 * the repository trait as backing exactly this view ("who may act for this
 * patient — emergency contact surfacing, admin review") and had no HTTP route,
 * so delegated authority over a minor's records could be created and then never
 * shown to anyone. There was no page, no shared client function, nothing.
 *
 * `GET /api/guardians/ward/{id}` and `GET /api/guardians/mine` are new.
 *
 * An ended relationship stays in the list and says so: a revoked guardianship
 * is part of the answer to "who may act for this patient", and dropping it
 * would hide that somebody once could.
 */

function fixturePatientId(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..');
  const fx = JSON.parse(
    readFileSync(join(root, '.browser-test', 'fixtures.json'), 'utf8')
  ) as { patient: { linked_patient_id: string }; patient_b: { wallet: string } };
  return fx.patient.linked_patient_id;
}

function guardianWallet(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..');
  const fx = JSON.parse(
    readFileSync(join(root, '.browser-test', 'fixtures.json'), 'utf8')
  ) as { patient_b: { wallet: string } };
  return fx.patient_b.wallet;
}

test('a guardian is recorded, listed, and ended', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'Admin');
  await settle(page, `/patients/${fixturePatientId()}`);

  await page.getByRole('button', { name: /access/i }).first().click();

  const heading = page.getByText(/who may act for this patient/i);
  await expect(heading).toBeVisible({ timeout: 20000 });

  const before = await page.locator('[data-testid="guardian-list"] li').count();

  // Authority with no permissions is not authority — the form refuses it.
  await page.locator('#guardian-wallet').fill(guardianWallet());
  await page.getByRole('button', { name: /record guardian/i }).click();
  await expect(page.getByRole('alert')).toContainText(/at least one permission/i);

  await page.getByLabel(/view records/i).check();
  await page.getByLabel(/consent to treatment/i).check();
  await page.getByRole('button', { name: /record guardian/i }).click();

  await expect
    .poll(() => page.locator('[data-testid="guardian-list"] li').count(), { timeout: 20000 })
    .toBeGreaterThan(before);

  // Ending it leaves the row in place, marked ended — the list is the history
  // of who could act, not only who can now.
  //
  // `.last()` is not cosmetic. This spec records a guardian every run and
  // nothing removes it, so from the second run onwards the fixture patient has
  // several rows for the same wallet and an unscoped `getByText(/ended/i)`
  // matched all of them -- a strict-mode violation that made this spec fail
  // permanently after its first successful run. The row created by THIS run is
  // the one appended last.
  const row = page
    .locator('[data-testid="guardian-list"] li')
    .filter({ hasText: guardianWallet() })
    .last();
  await row.getByRole('button', { name: /^end$/i }).click();
  await expect(row.getByText(/ended/i)).toBeVisible({ timeout: 20000 });
  await expect(row.getByRole('button', { name: /^end$/i })).toHaveCount(0);

  await page.close();
});
