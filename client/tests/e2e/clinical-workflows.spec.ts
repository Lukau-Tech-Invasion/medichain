import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Staff = { login_id: string; password: string };
type Manifest = {
  staff: Staff[];
  workflows: {
    lab: { rejection_id: string; replacement_specimen_id: string };
    pharmacy: { prescription_id: string; prescribed_quantity: number };
  };
};

// The root Playwright config is intentionally run from `client/`; fixture
// provisioning writes its contract one directory above that workspace.
const manifestPath = resolve(process.cwd(), '../.browser-test/fixtures.json');

function fixtureManifest(): Manifest {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Browser fixture manifest missing at ${manifestPath}. ` +
      'Run scripts/seed-browser-test-fixtures.ts against the isolated demo API first.'
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  if (!manifest.workflows?.lab || !manifest.workflows?.pharmacy) {
    throw new Error('Fixture manifest predates workflow seeding; regenerate it before this suite.');
  }
  return manifest;
}

function staff(manifest: Manifest, prefix: string): Staff {
  const match = manifest.staff.find(
    (candidate) => candidate.login_id === prefix || candidate.login_id.startsWith(`${prefix}.`)
  );
  if (!match) throw new Error(`Missing browser staff fixture ${prefix}`);
  return match;
}

async function signIn(page: Page, account: Staff): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/employee identifier/i).fill(account.login_id);
  await page.getByLabel(/^password$/i).fill(account.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signOut(page: Page): Promise<void> {
  await page.locator('button:visible').filter({ hasText: /^Logout$/ }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe('server-backed lab and pharmacy journeys', () => {
  test.use({ baseURL: process.env.MEDICHAIN_DOCTOR_PORTAL_URL ?? 'http://localhost:5173' });

  test('recollection survives reload and closes only against a replacement specimen', async ({ page }) => {
    const manifest = fixtureManifest();
    await signIn(page, staff(manifest, 'bt.lab'));

    await expect(page.getByText(/haemolysed synthetic sample/i)).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept('New sample required for valid HbA1c'));
    await page.getByRole('button', { name: /^recollect$/i }).click();
    await expect(page.getByText(/recollection requested/i)).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: /open recollections/i })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept(manifest.workflows.lab.replacement_specimen_id));
    await page.getByRole('button', { name: /complete recollection/i }).click();
    await expect(page.getByText(/recollection completed and linked/i)).toBeVisible();

    await page.reload();
    await expect(page.getByText(/haemolysed synthetic sample/i)).toBeVisible();
    await expect(page.getByText(manifest.workflows.lab.rejection_id)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /complete recollection/i })).toHaveCount(0);
  });

  test('two pharmacists verify, partially fill, reject overfill, complete, and retain reversal history', async ({ page }) => {
    const manifest = fixtureManifest();
    const first = staff(manifest, 'bt.pharm');
    const second = staff(manifest, 'bt.pharm2');
    await signIn(page, first);
    await expect(page.getByText('Synthetic Dual Check')).toBeVisible();
    await expect(page.getByRole('button', { name: /^dispense$/i })).toHaveCount(0);
    await page.getByRole('button', { name: /request second pharmacist/i }).click();
    await expect(page.getByText(/verification requested/i)).toBeVisible();

    await signOut(page);
    await signIn(page, second);
    await page.getByRole('button', { name: /approve verification/i }).click();
    await expect(page.getByText(/verification approved/i)).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept('5'));
    await page.getByRole('button', { name: /^dispense$/i }).click();
    await expect(page.getByText(/15 still owed/i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/5 of 20 units dispensed/i)).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept('16'));
    await page.getByRole('button', { name: /^dispense$/i }).click();
    await expect(page.getByText(/more than this prescription still owes/i)).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept('15'));
    await page.getByRole('button', { name: /^dispense$/i }).click();
    await expect(page.getByText(/fully dispensed/i)).toBeVisible();

    await page.getByRole('button', { name: /^history$/i }).click();
    const reverseButtons = page.getByRole('button', { name: /^reverse$/i });
    await expect(reverseButtons).toHaveCount(2);
    page.once('dialog', (dialog) => dialog.accept('Synthetic correction proof'));
    await reverseButtons.last().click();
    await expect(page.getByText(/original and correction remain in history/i)).toBeVisible();
    await expect(page.getByText(/correction for 15 units: synthetic correction proof/i)).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: /^history$/i }).click();
    await expect(page.getByText(/dispensed 15 units.*reversed/i)).toBeVisible();
    await expect(page.getByText(/correction for 15 units: synthetic correction proof/i)).toBeVisible();
  });
});
