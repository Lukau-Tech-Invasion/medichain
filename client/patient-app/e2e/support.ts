import { portalPath } from '../../doctor-portal/e2e/portal-path';
import { expect, type Page } from '@playwright/test';
import { deriveAuthProof } from '../../shared/src/auth/proof';
// The API-level identity helpers live once, beside the doctor portal's specs,
// and are imported by both suites: a second copy of the TOTP and provisioning
// code would drift from the first.
import { readFixtures } from '../../doctor-portal/e2e/identity';

/**
 * Shared harness for the patient-app browser suites.
 *
 * Kept in one file so the contrast and accessibility specs cannot drift on how
 * they sign in or how long they wait — the doctor portal grew two slightly
 * different `settle` helpers before they were unified.
 */

// ---------------------------------------------------------------------------
// Confirming a gated action (ADR-0008 Class C)
// ---------------------------------------------------------------------------

/**
 * Answer the "Confirm it is you" dialog a gated action opens -- deciding access,
 * changing consent -- with the fixture patient's password, as the patient does.
 */
export async function confirmWithPassword(page: Page, which: 'patient' | 'patient_b' = 'patient') {
  const fx = (readFixtures() as unknown as Fixtures)[which];
  const dialog = page.getByRole('dialog').filter({ has: page.locator('#step-up-password') });
  await dialog.waitFor({ state: 'visible', timeout: 20000 });
  const loginField = dialog.locator('#step-up-login-id');
  if (await loginField.isVisible()) await loginField.fill(fx.login_id);
  await dialog.locator('#step-up-password').fill(fx.password ?? '');
  await dialog.getByRole('button', { name: /^confirm$/i }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30000 });
}

// ---------------------------------------------------------------------------
// Signing in as a real, registered patient
// ---------------------------------------------------------------------------

/** One account in `.browser-test/fixtures.json`, as the seeder wrote it. */
interface FixtureAccount {
  user_id: string;
  login_id: string;
  password?: string;
}

/** The seeded browser-test fixtures, written by scripts/seed-browser-test-fixtures.ts. */
interface Fixtures {
  patient: FixtureAccount & { linked_patient_id: string };
  patient_b: FixtureAccount & { linked_patient_id: string };
  staff?: Array<FixtureAccount & { role: string }>;
}

function fixtures(): Fixtures {
  return readFixtures();
}

/**
 * Sign in as a seeded fixture patient through the sign-in form: the username
 * and password the seeder chose when it redeemed the patient's activation code.
 *
 * # Why a real account
 *
 * Most of this application's endpoints resolve the caller from a live session
 * and a registered user, so a session that is not backed by one signs in and
 * then gets 401 from every consent, access-grant and records endpoint. The
 * fixture patient is registered and bound to a health record, which makes this
 * fit for anything that reads or writes the patient's own data, and equally for
 * rendering, contrast and layout checks.
 *
 * Nothing is seeded into storage and nothing is forged: the form posts the
 * password proof to `POST /api/auth/login`, and every authorisation decision is
 * the server's. The session survives a reload through the refresh cookie.
 */
export async function signInAsFixturePatient(
  page: Page,
  which: 'patient' | 'patient_b' = 'patient'
): Promise<{ userId: string; patientId: string }> {
  const fx = fixtures()[which];
  if (!fx.password) throw new Error(`The ${which} fixture has no password; re-run the seeder.`);

  await page.goto(portalPath('/login'));
  await page.locator('input#username').fill(fx.login_id);
  await page.locator('input#password').fill(fx.password);
  await page.locator('button[type="submit"]').click();
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
  await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 30000 });
  // Let the first data fetches land before a test starts asserting on them.
  await page.waitForTimeout(1500);

  return { userId: fx.user_id, patientId: fx.linked_patient_id };
}

/**
 * Sign in as the fixture patient, for rendering, contrast and layout checks.
 *
 * The demo-account route this used to take is gone; a real
 * fixture account is the one deterministic way in, and it exercises the same
 * sign-in the product uses rather than a test-only shortcut.
 */
export async function signIn(page: Page) {
  await signInAsFixturePatient(page, 'patient');
}

/**
 * Navigate and wait for real content.
 *
 * NOT `waitForLoadState('networkidle')`: this app holds an SSE stream open on
 * /api/events, so the network never goes idle and that wait can only time out.
 */
export async function settle(page: Page, path: string) {
  await page.goto(portalPath(path));
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
  // Let late-arriving data paint. A list that fills in after the audit runs is
  // a list the audit never checked.
  await page.waitForTimeout(1200);
}

/**
 * Sign in as ANY patient account through the form: username and password, then
 * the authenticator code when the account has one.
 *
 * `signInAsFixturePatient` signs the seeded fixture in. Specs about sign-in
 * itself (an account that has just been activated, a changed password, a locked
 * account) need one they name and need to decide what happens after the first
 * submit.
 *
 * @param totp - Supplies the code when the form asks for one; a function so it
 *   is computed when the field appears.
 */
export async function signInWithCredentials(
  page: Page,
  username: string,
  password: string,
  totp?: () => Promise<string>
) {
  await page.goto(portalPath('/login'));
  await page.locator('input#username').fill(username);
  await page.locator('input#password').fill(password);
  await page.locator('button[type="submit"]').click();
  if (totp) {
    const codeField = page.locator('input#totp-code');
    await expect(codeField, 'the account was not asked for its authenticator code').toBeVisible({
      timeout: 30000,
    });
    await codeField.fill(await totp());
    await page.locator('button[type="submit"]').click();
  }
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
  await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 30000 });
}

/**
 * Sign out through the navigation menu (the "All pages" button on a desktop, the
 * menu button on a phone) and land on the sign-in page.
 */
export async function signOut(page: Page) {
  await page.locator('button[aria-haspopup="dialog"]:visible').first().click();
  await page.getByRole('button', { name: /^sign out$/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15000 });
  await expect(page.locator('input#username')).toBeVisible({ timeout: 15000 });
}

/** The sign-in page is showing and no signed-in layout is. */
export async function expectSignedOut(page: Page) {
  await expect(page.locator('input#username')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('input#password')).toBeVisible();
}

/**
 * Everything on the page a person could read: the visible text plus the text
 * that lives in attributes (placeholder, aria-label, title, alt).
 */
export async function readablePageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts: string[] = [document.body.innerText];
    document.querySelectorAll('[placeholder],[aria-label],[title],[alt]').forEach((el) => {
      for (const name of ['placeholder', 'aria-label', 'title', 'alt']) {
        const value = el.getAttribute(name);
        if (value) parts.push(value);
      }
    });
    return parts.join('\n');
  });
}

/** Keep a page under the API's per-minute budget, counted from its own requests. */
export function requestPacer(page: Page, perMinute = 90) {
  const stamps: number[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) stamps.push(Date.now());
  });
  return async () => {
    for (;;) {
      const cutoff = Date.now() - 60_000;
      while (stamps.length && stamps[0] < cutoff) stamps.shift();
      if (stamps.length < perMinute) return;
      await page.waitForTimeout(stamps[0] + 60_500 - Date.now());
    }
  };
}

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(t => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  // The class flips CSS custom properties; give style recalculation a moment.
  // Sampling too early reports the previous theme and manufactures failures
  // that do not exist — which happened on the doctor portal and cost a round
  // of chasing eleven imaginary defects.
  await page.waitForTimeout(400);
}

/** Routes worth guarding, clinical-risk first. */
export const ROUTES = [
  // The emergency card is the single highest-consequence screen in this
  // product: it is read by a stranger, in a hurry, on someone else's phone,
  // about a patient who may be unconscious.
  { path: '/emergency-card', name: 'Emergency card' },
  { path: '/medical-id', name: 'Medical ID' },
  { path: '/medications', name: 'Medications' },
  { path: '/lab-results', name: 'Lab results' },
  { path: '/vitals', name: 'Vitals' },
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/records', name: 'My records' },
  { path: '/consent', name: 'Consent' },
  { path: '/appointments', name: 'Appointments' },
  { path: '/settings', name: 'Settings' },
];

/** The seeded fixtures, for a test that needs to know an account. */
export function testFixtures(): Fixtures {
  return fixtures();
}

/**
 * Have a doctor send this patient a message, through the API.
 *
 * The round-trip test used to assert on a message with a hand-typed timestamp
 * in its text, created once by a person in an earlier session. It passed only
 * while that exact row survived in whatever database was running, which is not
 * a test — it is a coincidence with an expiry date. A test that needs a message
 * to exist creates one.
 *
 * Returns the body it sent, so the test can look for it.
 */
export async function seedDoctorMessage(
  request: { post: (url: string, options: Record<string, unknown>) => Promise<{ ok(): boolean; status(): number; json(): Promise<unknown> }> },
  // An empty prefix uses this test's configured request-context origin.
  apiBase = ''
): Promise<string> {
  const data = fixtures();
  const doctor = data.staff?.find((member) => member.role === 'Doctor');
  if (!doctor?.password) throw new Error('No Doctor in .browser-test/fixtures.json; re-run the seeder.');

  // The doctor signs in exactly as the portal does: a proof derived from the
  // password, `POST /api/auth/login`, and the bearer token that comes back.
  const login = await request.post(`${apiBase}/api/auth/login`, {
    headers: { 'Content-Type': 'application/json' },
    data: {
      identifier: doctor.login_id,
      auth_proof: await deriveAuthProof(doctor.password, doctor.login_id),
    },
  });
  if (!login.ok()) throw new Error(`Signing the seeded doctor in failed: ${login.status()}`);
  const { access_token: token } = (await login.json()) as { access_token: string };

  const body = `Doctor browser round-trip ${Date.now()}`;
  const response = await request.post(`${apiBase}/api/messages/send`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `roundtrip-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    },
    data: {
      recipient_id: data.patient.user_id,
      subject: 'Browser round-trip',
      content: body,
      priority: 'normal',
    },
  });
  if (!response.ok()) {
    throw new Error(`Seeding the doctor message failed: ${response.status()}`);
  }
  return body;
}
