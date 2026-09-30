import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  api,
  apiContext,
  fixtureStaff,
  fixtureToken,
  readFixtures,
  stamp,
} from '../../doctor-portal/e2e/identity';
import { settle, signInAsFixturePatient } from './support';

/**
 * The patient decides who may see their record.
 *
 * A clinician with no care relationship asks for access, with a reason. The
 * patient sees the request -- who, in what role, why -- and approves it for a
 * window they choose, or denies it. An approved request is a standing grant that
 * the patient can withdraw at any time, and withdrawal takes effect at once:
 * the clinician's next attempt to open the chart is refused.
 *
 * This is the consent screen's core loop, and it is the patient-visibility rule
 * seen from the other side: what a clinician is allowed to read, the patient
 * allowed. The signed-consent forms and their withdrawal are
 * `consent-withdraw.spec.ts`.
 *
 * The clinician is the SECOND seeded doctor, who registered nobody and has no
 * encounter with the fixture patient, so before the approval the chart is closed to
 * them. If the seed ever gives that doctor a relationship, the "closed before,
 * open after, closed again" half of the test says so and skips rather than
 * asserting something untrue; the screen half still runs.
 *
 * Desktop project only: it creates and decides requests.
 */

test.skip(({ isMobile }) => isMobile, 'request-deciding flows run on the desktop project only');
test.describe.configure({ mode: 'serial' });

let api_: APIRequestContext;
let doctorToken: string;
let patientId: string;
let patientToken: string;

test.beforeAll(async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  api_ = await apiContext(playwright, testInfo);
  const fixtures = readFixtures();
  patientId = fixtures.patient.linked_patient_id;
  doctorToken = await fixtureToken(api_, fixtureStaff('Doctor', 1));
  patientToken = await fixtureToken(api_, {
    login_id: fixtures.patient.login_id,
    password: fixtures.patient.password ?? '',
  });
});

test.afterAll(async () => {
  await api_?.dispose();
});

/** Ask for access as the second doctor, clearing a leftover pending request first. */
async function requestAccess(reason: string): Promise<void> {
  const create = () =>
    api(api_, 'POST', `/api/access/patient/${patientId}/requests`, { token: doctorToken, data: { reason } });
  let created = await create();
  if (created.status === 409) {
    const pending = await api(api_, 'GET', `/api/access/patient/${patientId}/requests`, { token: patientToken });
    for (const request of (pending.body?.requests ?? []) as Array<{ id: string; status: string }>) {
      if (request.status === 'pending') {
        await api(api_, 'POST', `/api/access/requests/${request.id}/deny`, { token: patientToken, data: {} });
      }
    }
    created = await create();
  }
  expect(created.status, `request access -> ${JSON.stringify(created.body)}`).toBe(201);
}

/** Whether the second doctor can open the patient's chart right now. */
async function chartOpens(): Promise<boolean> {
  const result = await api(api_, 'POST', `/api/patients/${patientId}/access-context`, {
    token: doctorToken,
    data: { reason: 'treatment' },
  });
  return result.status === 200 || result.status === 201;
}

test('a request is approved, becomes a grant the patient can see, and is withdrawn', async ({ page }) => {
  test.setTimeout(300_000);
  const reason = `E2E access request ${stamp()}`;
  const openedBefore = await chartOpens();

  await requestAccess(reason);

  await signInAsFixturePatient(page);
  await settle(page, '/consent');
  await page.getByRole('button', { name: /^requests/i }).first().click();

  // The request says who is asking and why, in the patient's words.
  const request = page.locator('.patient-card').filter({ hasText: reason });
  await expect(request).toBeVisible({ timeout: 30000 });
  await expect(request).toContainText(/browser test two/i);
  await expect(request).toContainText(/doctor/i);

  await request.getByRole('button', { name: /^approve$/i }).click();
  await expect(request).toHaveCount(0, { timeout: 30000 });

  // It is now a standing grant, in the Active tab.
  await page.getByRole('button', { name: /^active/i }).first().click();
  const grant = page.locator('.patient-card').filter({ hasText: /browser test two/i }).first();
  await expect(grant).toBeVisible({ timeout: 30000 });
  await expect(grant).toContainText(/active/i);

  if (!openedBefore) {
    expect(await chartOpens(), 'an approved grant did not open the chart to the clinician').toBe(true);
  } else {
    test.info().annotations.push({
      type: 'note',
      description: 'the second doctor already had a care relationship; the open/closed half was skipped',
    });
  }

  // Withdrawn from the grant's own detail, after a confirmation.
  await grant.click();
  await page.getByRole('button', { name: /^revoke access$/i }).click();
  await expect(page.getByText(/withdraw consent\?/i)).toBeVisible();
  await page.getByRole('button', { name: /^withdraw consent$/i }).click();
  await expect(page.getByText(/withdraw consent\?/i)).toHaveCount(0, { timeout: 30000 });

  // It leaves the Active tab and is kept, marked revoked, in History.
  await page.getByRole('button', { name: /^history/i }).first().click();
  const revoked = page.locator('.patient-card').filter({ hasText: /browser test two/i }).first();
  await expect(revoked).toBeVisible({ timeout: 30000 });
  await expect(revoked).toContainText(/revoked/i);

  // And it takes effect at once: the clinician's next attempt is refused.
  if (!openedBefore) {
    expect(await chartOpens(), 'a withdrawn grant still opens the chart').toBe(false);
  }
});

test('a request the patient denies never becomes access', async ({ page }) => {
  test.setTimeout(240_000);
  const reason = `E2E denied request ${stamp()}`;
  const openedBefore = await chartOpens();
  await requestAccess(reason);

  await signInAsFixturePatient(page);
  await settle(page, '/consent');
  await page.getByRole('button', { name: /^requests/i }).first().click();

  const request = page.locator('.patient-card').filter({ hasText: reason });
  await expect(request).toBeVisible({ timeout: 30000 });
  await request.getByRole('button', { name: /^deny$/i }).click();
  await expect(request).toHaveCount(0, { timeout: 30000 });

  // The decision is the server's, not the page's: reload and it is still decided.
  await page.reload();
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: /^requests/i }).first().click();
  await expect(page.locator('.patient-card').filter({ hasText: reason })).toHaveCount(0);

  if (!openedBefore) {
    expect(await chartOpens(), 'a denied request opened the chart').toBe(false);
  }
});

test('a patient cannot approve a request for someone else\'s record', async () => {
  // Patient B's requests are not the fixture patient's to decide.
  const other = readFixtures().patient_b;
  const list = await api(api_, 'GET', `/api/access/patient/${other.linked_patient_id}/requests`, {
    token: patientToken,
  });
  expect([401, 403, 404]).toContain(list.status);
  expect(JSON.stringify(list.body)).not.toMatch(/"requests"\s*:\s*\[\s*\{/);
});
