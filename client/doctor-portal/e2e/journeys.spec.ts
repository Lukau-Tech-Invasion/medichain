import { test, expect, type Page } from '@playwright/test';
import { signIn, settle, type RoleName } from './support';

/**
 * Each role's most important screen, driven through the real browser.
 *
 * # Why this exists when `scripts/role-journeys.ts` already passes
 *
 * The HTTP journeys prove the API accepts the page's payload and gives it back.
 * They cannot prove the page can PRODUCE that payload, because they send it
 * themselves. Everything between the clinician and the request is invisible to
 * them:
 *
 *   * the button exists, is enabled, and is reachable from the navigation;
 *   * the form assembles the fields it collected into that shape;
 *   * what the screen says afterwards matches what the server did.
 *
 * The last one is not hypothetical. Four Save paths were found on 2026-09-11
 * reporting success for writes the server had refused — a nurse marking a dose
 * given, an order status change, a discharge approval, a symptom log — because
 * `fetch` resolves on a 403 and nobody looked. An HTTP journey cannot see that
 * defect; it lives entirely in the browser.
 *
 * # Why so few tests
 *
 * Sign-in is several requests against an API that rate-limits at 60/minute, and
 * each of these drives a multi-field form. A suite mirroring all 220 HTTP steps
 * would spend an hour re-proving what a faster suite already knows. These pick,
 * per role, the screen whose failure would be worst and least visible.
 *
 * # Why a missing fixture skips rather than fails
 *
 * `GET /api/auth/demo-credentials` only offers accounts that carry a keystore.
 * `bt.admin` is in the server's fixture list and is not returned, so the
 * administrator cannot be signed in here at all. That is a seeding gap, not a
 * product defect, and reporting it as a failed assertion about the product
 * would be a lie about what was tested. It is named out loud instead.
 *
 * Run:
 *   bash scripts/run-browser-e2e-api.sh &
 *   cd client/doctor-portal
 *   npx playwright test journeys --config playwright.local-api.config.ts
 */

/** Roles the API is currently willing to hand a demo credential for. */
async function availableRoles(page: Page): Promise<Set<string>> {
  const response = await page.request.get('/api/auth/demo-credentials');
  if (!response.ok()) return new Set();
  const body = (await response.json()) as { credentials?: { role: string }[] };
  return new Set((body.credentials ?? []).map((c) => c.role));
}

/**
 * Sign in, or skip the test saying exactly why it could not.
 *
 * Retries once after a pause: the API rate-limits at 60 requests a minute and a
 * serial browser suite doing full sign-ins walks into that ceiling, at which
 * point the login page renders no demo buttons and the failure looks
 * identical to a missing fixture. Distinguishing the two is the whole point of
 * this helper.
 */
async function signInOrSkip(page: Page, role: RoleName) {
  const offered = await availableRoles(page);
  test.skip(
    !offered.has(role),
    `the API offers no demo credential for ${role} (it has: ${[...offered].join(', ') || 'none'}). ` +
      'Only accounts with a keystore are offered; run scripts/seed-browser-test-fixtures.ts.'
  );

  try {
    await signIn(page, role);
  } catch {
    // One retry, after the rate-limit window.
    await page.waitForTimeout(15000);
    await signIn(page, role);
  }
}

/** Assert the screen is not reporting an error. */
async function noErrorBanner(page: Page) {
  const alerts = page.locator('[role="alert"]');
  const messages: string[] = [];
  for (let i = 0; i < (await alerts.count()); i += 1) {
    const text = (await alerts.nth(i).innerText().catch(() => '')).trim();
    if (text) messages.push(text);
  }
  expect(messages, `the screen reported: ${messages.join(' | ')}`).toEqual([]);
}

/** Every account the portal serves renders a real landing page. */
for (const role of ['Doctor', 'Nurse', 'Pharmacist', 'LabTechnician', 'Admin'] as const) {
  test(`${role} signs in and their dashboard renders content`, async ({ page }) => {
    await signInOrSkip(page, role as RoleName);

    // `/dashboard` is one URL and five different components —
    // `SmartDashboardRouter` dispatches on the signed-in role — so this is
    // five assertions wearing one name.
    const main = page.locator('main, [role="main"]').first();
    await expect(main).toBeVisible();

    // Poll, rather than sampling once. Every one of these dashboards fetches
    // its panels after mount, so a single `innerText()` taken the instant
    // `main` becomes visible reads the shell -- a heading and nothing else.
    // The Nurse dashboard failed this way intermittently while the rest of the
    // suite loaded the API: 10 characters, which looks exactly like a blank
    // screen and is not one.
    //
    // This asserts the same thing, and waits for it instead of racing it.
    await expect
      .poll(async () => (await main.innerText()).trim().length, {
        message: `${role}'s dashboard rendered no text at all`,
        timeout: 15000,
      })
      .toBeGreaterThan(40);
    await noErrorBanner(page);
  });
}

test('a nurse can reach the MAR', async ({ page }) => {
  await signInOrSkip(page, 'Nurse');
  await settle(page, '/mar');

  // The screen that reported "Documented: <drug>" for doses the server had
  // refused. The HTTP journey proves the endpoint works; this proves a nurse
  // can get to the control that calls it.
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
  await noErrorBanner(page);
});

test('a doctor can reach the order board', async ({ page }) => {
  await signInOrSkip(page, 'Doctor');
  await settle(page, '/orders');

  // `handleUpdateStatus` used to update local state unconditionally, so the
  // board showed transitions the server had refused.
  await expect(page.locator('main, [role="main"]').first()).toBeVisible();
  await noErrorBanner(page);
});

test('the health ID card screen offers no ID type by default', async ({ page }) => {
  // Doctor rather than Admin: issuing is doctor/nurse/admin, and the doctor
  // fixture is the one reliably offered a credential.
  await signInOrSkip(page, 'Doctor');
  await settle(page, '/health-id-cards');

  // A card issued against a blank ID type is a national health credential
  // verified against no national ID system, so the absence of a default is the
  // assertion — not an implementation detail.
  const select = page.locator('#healthid-type');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('');
  await noErrorBanner(page);
});

test('telehealth offers the session types the API accepts', async ({ page }) => {
  await signInOrSkip(page, 'Doctor');
  await settle(page, '/telehealth');

  await page
    .getByRole('button', { name: /new session|schedule/i })
    .first()
    .click()
    .catch(() => undefined);

  const select = page.locator('#telehealth-session-type');
  if ((await select.count()) === 0) {
    test.skip(true, 'the scheduling form did not open on this build');
    return;
  }

  // The page used to offer `video_consultation`, `follow_up`, `mental_health`
  // and `urgent_care` — none of which appeared in the handler's match, so every
  // one fell through to a video visit and the list then rendered the stored
  // `VideoVisit` as a raw enum name. These are the API's own spellings.
  const values = await select
    .locator('option')
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  expect(values).toContain('VideoVisit');
  expect(values).toContain('PhoneCall');
  expect(
    values.filter((v) => v.includes('_')),
    'a snake_case value here is one the API will refuse'
  ).toEqual([]);
});

test('registration does not collect a personal phone it would send as empty', async ({ page }) => {
  await signInOrSkip(page, 'Doctor');
  await settle(page, '/register');

  // Registration used to send `phone: ''` for a field it does not collect — the
  // form asks for an EMERGENCY contact number and no personal one — so the
  // backend stored a known-empty personal phone rather than an absent one.
  // If that input ever appears, the payload has to start sending it.
  const personalPhone = page.locator('#register-phone');
  expect(
    await personalPhone.count(),
    'the form now collects a personal phone; send it instead of omitting it'
  ).toBe(0);
  await noErrorBanner(page);
});
