import { test, expect } from '@playwright/test';
import { signInAsFixturePatient, settle } from './support';

/**
 * A patient can withdraw a consent they signed.
 *
 * The consent screen could **sign** a consent and never take it back:
 * `POST /api/consent/{id}/revoke` existed with no caller anywhere. Signing
 * without withdrawal is not consent management — under POPIA withdrawal is a
 * right the patient holds, and a screen that can only sign records agreement it
 * cannot let go of.
 *
 * Not the same as revoking an access grant, which the page already did
 * (`/api/access/grants/{id}/revoke`). A grant is one clinician's permission; a
 * consent is the signed legal basis, and revoking either leaves the other
 * standing.
 *
 * Runs as the seeded fixture patient rather than a demo wallet: the demo path
 * mints a keypair but no user record, so every consent endpoint answers 401 for
 * it and this test would have proved nothing about authorisation.
 */
test('a patient signs a consent and can withdraw it', async ({ page }) => {
  test.setTimeout(180000);
  await signInAsFixturePatient(page);
  await settle(page, '/consent');
  await page.getByRole('button', { name: /^forms$/i }).first().click();
  await page.waitForTimeout(1200);

  // Sign whatever form is offered, so the test does not depend on this patient
  // already holding one.
  const signButton = page.getByRole('button', { name: /^sign$/i }).first();
  if (await signButton.count()) {
    await signButton.click();
    await page.waitForTimeout(2500);
  }

  const withdraw = page.getByRole('button', { name: /^withdraw$/i }).first();
  await expect(withdraw, 'no standing consent was available to withdraw').toBeVisible({
    timeout: 20000,
  });
  const before = await page.getByRole('button', { name: /^withdraw$/i }).count();

  // The reason is an optional field on the row, deliberately not a
  // `window.prompt`: a blocking browser dialog cannot be styled, translated or
  // read by a screen reader in context. Left blank here — a patient does not
  // owe a reason.
  await withdraw.click();

  // `GET /api/consent/patient/{id}` filters withdrawn consents out server-side,
  // so a real withdrawal REMOVES the row. Asserting the count drops is what
  // separates a withdrawal from a 200 that changed nothing.
  await expect(
    page.getByRole('status').filter({ hasText: /withdrawn/i }).first()
  ).toBeVisible({ timeout: 20000 });
  await expect
    .poll(() => page.getByRole('button', { name: /^withdraw$/i }).count(), { timeout: 20000 })
    .toBeLessThan(before);
});
