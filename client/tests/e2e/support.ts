import { expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sign-in for the cross-app suites in this directory.
 *
 * Both portals sign in with a login id and a password: staff with their
 * Employee ID, patients with the username they chose when they redeemed their
 * activation code. The accounts are the fixtures
 * `scripts/seed-browser-test-fixtures.ts` wrote to `.browser-test/fixtures.json`
 * (the credentials live only in that file), and the forms are the real ones.
 */

interface Account {
  login_id: string;
  password?: string;
}

interface Manifest {
  staff: Array<Account & { role: string }>;
  patient: Account;
}

// The root Playwright config is intentionally run from `client/`; fixture
// provisioning writes its contract one directory above that workspace.
const manifestPath = resolve(process.cwd(), '../.browser-test/fixtures.json');

export function readManifest(): Manifest {
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Browser fixture manifest missing at ${manifestPath}. ` +
        'Run scripts/seed-browser-test-fixtures.ts against the isolated demo API first.'
    );
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

/** The first staff fixture with `role`, credentials included. */
export function staffFixture(role: string): Required<Account> {
  const found = readManifest().staff.find((s) => s.role === role);
  if (!found?.password) throw new Error(`No ${role} fixture with a password in ${manifestPath}.`);
  return { login_id: found.login_id, password: found.password };
}

/** The fixture patient, credentials included. */
export function patientFixture(): Required<Account> {
  const { patient } = readManifest();
  if (!patient.password) throw new Error(`The patient fixture in ${manifestPath} has no password.`);
  return { login_id: patient.login_id, password: patient.password };
}

/** Sign in to the doctor portal (the page's baseURL) as a staff fixture. */
export async function signInStaff(page: Page, role = 'Doctor'): Promise<void> {
  const account = staffFixture(role);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input#identifier').fill(account.login_id);
  await page.locator('input#password').fill(account.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/dashboard/, { timeout: 30000 });
}

/** Sign in to the patient app (the page's baseURL) as the fixture patient. */
export async function signInPatient(page: Page): Promise<void> {
  const account = patientFixture();
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input#username').fill(account.login_id);
  await page.locator('input#password').fill(account.password);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('main').first()).toBeVisible({ timeout: 30000 });
}
