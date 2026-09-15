import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { signIn, settle } from './support';

/**
 * Two-factor authentication, actually enrolled.
 *
 * What stood in Settings was a switch that wrote `twoFactorEnabled: true` into
 * the user's settings blob and nothing else: no secret, no paired
 * authenticator, and the server's `user_mfa` state untouched. The screen
 * reported two-factor as on while `mfa_enabled()` returned false for that
 * wallet — a security control that claims to be enabled when it is not, which
 * is worse than one plainly absent.
 *
 * It is not cosmetic either. `require_privileged_assurance` gates
 * `POST /api/roles/assign`, role revocation and all three guardianship
 * endpoints. Outside demo mode an unenrolled caller is refused with 403
 * `MFA_ENROLLMENT_REQUIRED`, and nothing in either client could enrol — so user
 * management could not work in production at all. `mfaEnroll`, `mfaVerify`,
 * `mfaStatus` and `mfaDisable` had all existed in the shared client with no
 * caller.
 *
 * This test pairs for real: it reads the secret the server issued and computes
 * the code an authenticator app would show.
 */

/** RFC 6238 TOTP over a base32 secret — what the user's app would display. */
function totp(secretBase32: string, digits = 6, step = 30): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(ch);
    if (index >= 0) bits += index.toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Math.floor(Date.now() / 1000 / step);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString();
  return code.padStart(digits, '0');
}

test('a clinician enrols in two-factor and can turn it off again', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'Doctor');
  await settle(page, '/settings');

  await page.getByRole('button', { name: /security/i }).first().click();

  const status = page.getByTestId('mfa-status');
  await expect(status).toBeVisible({ timeout: 20000 });
  // "Checking..." must resolve to a real answer: the screen may not claim on or
  // off until the server has said which.
  await expect.poll(async () => status.innerText(), { timeout: 20000 }).not.toMatch(/checking/i);

  // Start from a known state. If a previous run left it on, turn it off first
  // is not possible without the secret, so this test only proceeds from off.
  const initial = (await status.innerText()).trim();
  test.skip(/^on$/i.test(initial), 'this account already has two-factor enrolled');

  await page.getByRole('button', { name: /set up two-factor/i }).click();

  // The secret is shown as text as well as a QR, so a clinician on a desktop
  // with no camera can still pair — and so this test can read it.
  const secret = (await page.locator('p.font-mono').first().innerText()).trim();
  expect(secret.length, 'no pairing secret was shown').toBeGreaterThan(10);
  await expect(page.getByAltText(/qr code/i)).toBeVisible();

  // A wrong code must be refused, or the control proves nothing.
  await page.locator('#mfa-code').fill('000000');
  await page.getByRole('button', { name: /confirm and enable/i }).click();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20000 });
  await expect(status).toHaveText(/off/i);

  // Now the real code.
  await page.locator('#mfa-code').fill(totp(secret));
  await page.getByRole('button', { name: /confirm and enable/i }).click();
  await expect(status).toHaveText(/^on$/i, { timeout: 20000 });

  // And off again — which requires a current code, so a live session alone
  // cannot strip the second factor off the account.
  await page.locator('#mfa-disable-code').fill(totp(secret));
  await page.getByRole('button', { name: /turn off two-factor/i }).click();
  await expect(status).toHaveText(/^off$/i, { timeout: 20000 });

  await page.close();
});
