import { portalPath } from '../../doctor-portal/e2e/portal-path';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  TotpDevice,
  apiContext,
  apiRedeem,
  fixtureStaff,
  fixtureToken,
  registerPatientViaApi,
  stamp,
  tokenOf,
} from '../../doctor-portal/e2e/identity';
import { signInWithCredentials } from './support';

/**
 * Workflow 8 — the patient's own account: two-factor set up and turned off
 * through Settings, contact details that survive a reload, and an insurance card
 * whose photographed front is stored and shown back.
 *
 * Each test uses a patient activated for it, so nothing here changes the shared
 * fixture patient's sign-in.
 */

test.skip(({ isMobile }) => isMobile, 'account-creating flows run on the desktop project only');
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'Patient-Long-Passphrase-8';
let api_: APIRequestContext;

async function activatePatient(label: string): Promise<{ username: string }> {
  const doctorToken = await fixtureToken(api_, fixtureStaff('Doctor'));
  const registered = await registerPatientViaApi(api_, doctorToken, label);
  const username = `e2e.${label.toLowerCase().replace(/\W+/g, '')}.${stamp()}`;
  const redeemed = await apiRedeem(api_, {
    identifier: registered.patientId,
    code: registered.activationCode,
    username,
    password: PASSWORD,
  });
  tokenOf(redeemed, `activate ${username}`);
  return { username };
}

async function signedIn(page: Page, label: string) {
  const patient = await activatePatient(label);
  await signInWithCredentials(page, patient.username, PASSWORD);
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
  return patient;
}

test.beforeAll(async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  api_ = await apiContext(playwright, testInfo);
});

test.afterAll(async () => {
  await api_?.dispose();
});

test('two-factor is set up from Settings with an authenticator, survives a reload, and is turned off', async ({ page }) => {
  test.setTimeout(240_000);
  await signedIn(page, 'AccountMfa');
  await page.goto(portalPath('/settings'));
  const status = page.getByTestId('mfa-status');
  await expect(status).toHaveText('Off', { timeout: 30000 });

  await page.getByRole('button', { name: 'Set up two-factor' }).click();
  const secret = (await page.locator('main p.font-mono').first().innerText()).trim();
  expect(secret, 'no secret was shown to pair an authenticator with').toMatch(/^[A-Z2-7=\s]{16,}$/);
  const device = new TotpDevice(secret.replace(/\s+/g, ''));

  // A wrong code is refused and leaves it off.
  await page.locator('#mfa-enrollment-code').fill('000000');
  await page.getByRole('button', { name: 'Confirm and enable' }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20000 });
  await expect(status).not.toHaveText('On');

  await page.locator('#mfa-enrollment-code').fill(await device.code());
  await page.getByRole('button', { name: 'Confirm and enable' }).click();
  await expect(status).toHaveText('On', { timeout: 30000 });

  await page.reload();
  await expect(page.getByTestId('mfa-status')).toHaveText('On', { timeout: 30000 });

  await page.locator('#mfa-disable-code').fill(await device.code());
  await page.getByRole('button', { name: 'Turn off two-factor' }).click();
  await expect(page.getByTestId('mfa-status')).toHaveText('Off', { timeout: 30000 });
});

test('contact details and an emergency contact are saved and read back after a reload', async ({ page }) => {
  test.setTimeout(180_000);
  await signedIn(page, 'AccountProfile');
  await page.goto(portalPath('/profile'));
  const phone = `+2782${String(Date.now()).slice(-7)}`;
  const contact = `QA Contact ${stamp()}`;

  // Contact details and emergency contacts are separate cards with their own saves.
  const details = page.locator('.patient-card').filter({ hasText: 'Contact Details' });
  await details.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#profile-phone').fill(phone);
  await details.getByRole('button', { name: 'Save Changes' }).click();
  await expect(details.getByText(phone)).toBeVisible({ timeout: 30000 });

  const contacts = page.locator('.patient-card').filter({ hasText: 'Emergency Contacts' });
  await contacts.getByRole('button', { name: 'Add' }).click();
  await page.locator('#emergency-contact-name').fill(contact);
  await page.locator('#emergency-contact-phone').fill('+27821234567');
  await page.locator('#emergency-contact-relationship').selectOption('Sibling');
  await contacts.getByRole('button', { name: 'Save Contact' }).click();
  await expect(contacts.getByText(contact)).toBeVisible({ timeout: 30000 });

  await page.reload();
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
  const text = await page.locator('main').innerText();
  const values = await page
    .locator('#profile-phone, #emergency-contact-name')
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(`${text}\n${values.join('\n')}`, 'the phone number did not survive a reload').toContain(phone);
  expect(`${text}\n${values.join('\n')}`, 'the emergency contact did not survive a reload').toContain(contact);
});

/** A small, valid PNG: a card photo stands in for the test. */
const CARD_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOQqziBFTEMLQkABkZXgRDDjAEAAAAASUVORK5CYII=',
  'base64'
);

test('an insurance card is added, its front photographed, and the stored photo is shown back', async ({ page }) => {
  test.setTimeout(180_000);
  await signedIn(page, 'AccountInsurance');
  await page.goto(portalPath('/insurance'));
  const member = `QA${stamp()}`;

  await page.getByRole('button', { name: 'Add New' }).click();
  await page.locator('#insurance-provider').fill('QA Medical Scheme');
  await page.locator('#insurance-plan-name').fill('Comprehensive');
  await page.locator('#insurance-member-id').fill(member);
  await page.locator('#insurance-subscriber-name').fill('QA Subscriber');
  await page.getByRole('button', { name: 'Add Insurance Card' }).click();
  await expect(page.locator('main').getByText(member).first(), 'the card is not listed').toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: 'Add Front' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#card-upload').setInputFiles({ name: 'card-front.png', mimeType: 'image/png', buffer: CARD_PNG });
  await expect(dialog).toHaveCount(0, { timeout: 30000 });

  // After a reload the photo comes back from storage, not from the page's memory.
  await page.reload();
  await page.getByRole('button', { name: 'View Front' }).first().click();
  const image = page.locator('img[src^="data:image/png;base64,"]').first();
  await expect(image, 'the stored card photo is not shown back').toBeVisible({ timeout: 30000 });
  const src = (await image.getAttribute('src')) ?? '';
  expect(Buffer.from(src.split(',')[1], 'base64').equals(CARD_PNG), 'the photo shown back is not the photo uploaded').toBe(true);
});
