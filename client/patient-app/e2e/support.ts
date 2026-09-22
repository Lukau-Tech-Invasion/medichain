import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared harness for the patient-app browser suites.
 *
 * Kept in one file so the contrast and accessibility specs cannot drift on how
 * they sign in or how long they wait — the doctor portal grew two slightly
 * different `settle` helpers before they were unified.
 */

// ---------------------------------------------------------------------------
// Signing in as a real, registered patient
// ---------------------------------------------------------------------------

/** The seeded browser-test fixtures, written by scripts/seed-browser-test-fixtures.ts. */
interface Fixtures {
  patient: { wallet: string; linked_patient_id: string };
  patient_b: { wallet: string; linked_patient_id: string };
  staff?: Array<{ role: string; wallet: string; login_id: string }>;
}

function fixtures(): Fixtures {
  const here = dirname(fileURLToPath(import.meta.url));
  // e2e/ -> patient-app/ -> client/ -> repo root
  const root = join(here, '..', '..', '..');
  return JSON.parse(
    readFileSync(join(root, '.browser-test', 'fixtures.json'), 'utf8')
  ) as Fixtures;
}

/**
 * Sign in as the seeded fixture patient — a real, registered account.
 *
 * # Why this exists, and why `signIn` is not enough
 *
 * `signIn` below uses "Create Demo Wallet", which does run the genuine
 * challenge/signature flow — but it only mints a keypair and a health id. It
 * never registers a **user record**, and most of this application's endpoints
 * resolve the caller through `require_registered_caller`, which reads the user
 * store. So a demo-wallet patient signs in successfully and then gets **401
 * from every consent, access-grant and records endpoint**. Verified from the
 * network log on 2026-09-15: four consecutive 401s on `/api/consent/*` for a
 * freshly created demo wallet, which is why the consent-withdrawal test could
 * not be written against it.
 *
 * That makes the demo path fine for rendering and contrast checks — what the
 * existing suites use it for — and useless for anything that reads or writes
 * the patient's own data.
 *
 * This seeds the session the application itself persists (`medichain_patient_auth`
 * plus `medichain_wallet`) for the fixture patient, who *is* registered. On
 * startup `restoreSession` picks it up and hands the wallet to the API client,
 * which sends it as `X-User-Id` — the same demo-mode identity path the doctor
 * portal's suites rely on, pointed at a real account rather than an invented
 * one.
 *
 * It is a seeded session, not a forged one: the account exists, the wallet is
 * the seeder's, and every authorisation decision is still the server's.
 */
export async function signInAsFixturePatient(
  page: Page,
  which: 'patient' | 'patient_b' = 'patient'
): Promise<{ wallet: string; patientId: string }> {
  const fx = fixtures()[which];
  // The patient application keys its own reads on `healthId`; for the seeded
  // accounts the `PAT-` id is what the patient-scoped endpoints accept, and
  // the journeys use the same value.
  const session = {
    address: fx.wallet,
    healthId: fx.linked_patient_id,
    name: 'Browser Test Patient',
  };

  await page.addInitScript(
    ([auth]) => {
      localStorage.setItem('medichain_patient_auth', JSON.stringify(auth));
      localStorage.setItem(
        'medichain_wallet',
        JSON.stringify({ address: (auth as { address: string }).address, role: 'Patient' })
      );
    },
    [session]
  );

  await page.goto('/dashboard');
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 20000 });
  // Let the first data fetches land before a test starts asserting on them.
  await page.waitForTimeout(1500);

  return { wallet: fx.wallet, patientId: fx.linked_patient_id };
}

/**
 * Sign in through the demo-wallet path.
 *
 * The five hardcoded demo identities were removed; "Create Demo Wallet" is the
 * remaining deterministic route, and it goes through the real credential path
 * behind a demo-gated resolver, so this exercises the same login the product
 * uses rather than a test-only shortcut.
 *
 * **Use this only for rendering, contrast and layout.** The wallet it mints is
 * not a registered user, so every endpoint behind `require_registered_caller`
 * answers 401 for it. For anything that reads or writes the patient's own data,
 * use `signInAsFixturePatient` above.
 */
export async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /create demo wallet/i }).click();
  await page.getByPlaceholder(/enter your name/i).fill('E2E Patient');
  await page.getByRole('button', { name: /create & login/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 20000 });
}

/**
 * Navigate and wait for real content.
 *
 * NOT `waitForLoadState('networkidle')`: this app holds an SSE stream open on
 * /api/events, so the network never goes idle and that wait can only time out.
 */
export async function settle(page: Page, path: string) {
  await page.goto(path);
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
  // Let late-arriving data paint. A list that fills in after the audit runs is
  // a list the audit never checked.
  await page.waitForTimeout(1200);
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
  request: { post: (url: string, options: Record<string, unknown>) => Promise<{ ok(): boolean; status(): number }> },
  apiBase = 'http://127.0.0.1'
): Promise<string> {
  const data = fixtures();
  const doctor = data.staff?.find((member) => member.role === 'Doctor');
  if (!doctor) throw new Error('No Doctor in .browser-test/fixtures.json; re-run the seeder.');
  const body = `Doctor browser round-trip ${Date.now()}`;
  const response = await request.post(`${apiBase}/api/messages/send`, {
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': doctor.wallet,
      'X-Provider-Role': 'Doctor',
      'Idempotency-Key': `roundtrip-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    },
    data: {
      recipient_id: data.patient.wallet,
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
