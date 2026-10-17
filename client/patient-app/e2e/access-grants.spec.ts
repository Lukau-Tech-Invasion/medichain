import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  api,
  apiContext,
  AdminApi,
  fixtureToken,
  provisionStaff,
  readFixtures,
  stamp,
  type Throwaway,
} from '../../doctor-portal/e2e/identity';
import { settle, signInAsFixturePatient } from './support';

/**
 * The patient decides who may see their record.
 *
 * A clinician with no care relationship asks for access, with a reason. The
 * patient sees the request -- who, in what role, why -- and approves it for a
 * window they choose, or denies it. An approved request is a standing grant that
 * the patient can withdraw at any time, and withdrawal takes effect at once:
 * the clinician's next access-context request is refused. The patient decisions
 * use the browser; these clinician authorization checks use the API.
 *
 * This is the consent screen's core loop, and it is the patient-visibility rule
 * seen from the other side: what a clinician is allowed to read, the patient
 * allowed. The signed-consent forms and their withdrawal are
 * `consent-withdraw.spec.ts`.
 *
 * Each project provisions an unrelated clinician, so existing fixture grants
 * cannot bypass the required deny -> allow -> deny permission checks. Both
 * viewports run serially. Cleanup touches only this clinician's test access.
 */

test.describe.configure({ mode: 'serial' });

let api_: APIRequestContext;
let doctorToken: string;
let patientId: string;
let patientToken: string;
let admin: AdminApi | undefined;
let requester: Throwaway | undefined;

test.beforeAll(async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  api_ = await apiContext(playwright, testInfo);
  const fixtures = readFixtures();
  patientId = fixtures.patient.linked_patient_id;
  admin = await AdminApi.signIn(api_);
  requester = await provisionStaff(api_, admin, 'Doctor', process.env.MEDICHAIN_FIXTURE_PASSWORD);
  doctorToken = requester.token;
  patientToken = await fixtureToken(api_, {
    login_id: fixtures.patient.login_id,
    password: fixtures.patient.password ?? '',
  });
});

test.afterAll(async () => {
  try {
    if (requester && patientToken) {
      const pending = await api(api_, 'GET', `/api/access/patient/${patientId}/requests`, { token: patientToken });
      for (const request of pending.body?.requests ?? []) {
        if (request.providerId === requester.userId && request.status === 'pending') {
          const result = await api(api_, 'POST', `/api/access/requests/${request.id}/deny`, { token: patientToken, data: {} });
          expect(result.status).toBe(200);
        }
      }
      const grants = await api(api_, 'GET', `/api/access/patient/${patientId}/grants`, { token: patientToken });
      for (const grant of grants.body?.grants ?? []) {
        if (grant.providerId === requester.userId && grant.status === 'active') {
          const result = await api(api_, 'POST', `/api/access/grants/${grant.id}/revoke`, { token: patientToken, data: {} });
          expect(result.status).toBe(200);
        }
      }
    }
  } finally {
    try {
      if (requester && admin) expect((await admin.call('PUT', `/api/users/${requester.userId}`, { status: 'suspended' })).status).toBe(200);
    } finally {
      try { await admin?.release(); } finally { await api_?.dispose(); }
    }
  }
});

/** Ask as this run's unrelated doctor; never clear other providers' requests. */
async function requestAccess(reason: string): Promise<void> {
  const created = await api(api_, 'POST', `/api/access/patient/${patientId}/requests`, { token: doctorToken, data: { reason } });
  expect(created.status, `request access -> ${JSON.stringify(created.body)}`).toBe(201);
}

/** Whether this run's clinician can obtain an access context right now. */
async function accessContextOpens(): Promise<boolean> {
  const result = await api(api_, 'POST', `/api/patients/${patientId}/access-context`, {
    token: doctorToken,
    data: { reason: 'treatment' },
  });
  return result.status === 200 || result.status === 201;
}

test('a request is approved, becomes a grant the patient can see, and is withdrawn', async ({ page }) => {
  test.setTimeout(300_000);
  const reason = `E2E access request ${stamp()}`;
  expect(await accessContextOpens(), 'the new clinician unexpectedly has access before approval').toBe(false);

  await requestAccess(reason);

  await signInAsFixturePatient(page);
  await settle(page, '/consent');
  await page.getByRole('button', { name: /^requests/i }).first().click();

  // The request says who is asking and why, in the patient's words.
  const request = page.locator('.patient-card').filter({ hasText: reason });
  await expect(request).toBeVisible({ timeout: 30000 });
  await expect(request).toContainText(requester!.name);
  await expect(request).toContainText(/doctor/i);

  await request.getByRole('button', { name: /^approve$/i }).click();
  await expect(request).toHaveCount(0, { timeout: 30000 });

  // It is now a standing grant, in the Active tab.
  await page.getByRole('button', { name: /^active/i }).first().click();
  const grant = page.locator('.patient-card').filter({ hasText: requester!.name });
  await expect(grant).toHaveCount(1);
  await expect(grant).toBeVisible({ timeout: 30000 });
  await expect(grant).toContainText(/active/i);

  expect(await accessContextOpens(), 'an approved grant did not authorize the clinician').toBe(true);

  // Withdrawn from the grant's own detail, after a confirmation.
  await grant.click();
  const details = page.getByRole('dialog', { name: 'Access Details' });
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute('aria-modal', 'true');
  // Escape closes the details, then they open again from the same card.
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await grant.click();
  await page.getByRole('button', { name: /^revoke access$/i }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Revoke this access grant?' });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole('button', { name: /^cancel$/i })).toBeFocused();
  await page.getByRole('button', { name: /^revoke access grant$/i }).click();
  await expect(page.getByRole('heading', { name: 'Revoke this access grant?' })).toHaveCount(0, { timeout: 30000 });

  // It leaves the Active tab and is kept, marked revoked, in History.
  await page.getByRole('button', { name: /^history/i }).first().click();
  const revoked = page.locator('.patient-card').filter({ hasText: requester!.name });
  await expect(revoked).toBeVisible({ timeout: 30000 });
  await expect(revoked).toContainText(/revoked/i);

  // And it takes effect at once: the clinician's next attempt is refused.
  expect(await accessContextOpens(), 'a withdrawn grant still authorizes the clinician').toBe(false);
});

test('a request the patient denies never becomes access', async ({ page }) => {
  test.setTimeout(240_000);
  const reason = `E2E denied request ${stamp()}`;
  expect(await accessContextOpens(), 'the clinician unexpectedly has access before the request').toBe(false);
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

  expect(await accessContextOpens(), 'a denied request authorized the clinician').toBe(false);
});

test('a patient cannot approve a request for someone else\'s record', async () => {
  const other = readFixtures().patient_b;
  const list = await api(api_, 'GET', `/api/access/patient/${other.linked_patient_id}/requests`, {
    token: patientToken,
  });
  expect([401, 403, 404]).toContain(list.status);
  expect(JSON.stringify(list.body)).not.toMatch(/"requests"\s*:\s*\[\s*\{/);
  const otherToken = await fixtureToken(api_, { login_id: other.login_id, password: other.password ?? '' });
  const created = await api(api_, 'POST', `/api/access/patient/${other.linked_patient_id}/requests`, {
    token: doctorToken, data: { reason: `E2E cross-patient denial ${stamp()}` },
  });
  expect(created.status).toBe(201);
  const id = String(created.body?.request?.id ?? '');
  expect(id).not.toBe('');
  try {
    const attempted = await api(api_, 'POST', `/api/access/requests/${id}/approve`, {
      token: patientToken, data: { expires_at: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(attempted.status, 'Patient A must not approve Patient B\'s request').toBe(403);
    const unchanged = await api(api_, 'GET', `/api/access/patient/${other.linked_patient_id}/requests`, { token: otherToken });
    expect(unchanged.body?.requests.find((request: { id: string }) => request.id === id)?.status).toBe('pending');
  } finally {
    const cleanup = await api(api_, 'POST', `/api/access/requests/${id}/deny`, { token: otherToken, data: {} });
    expect(cleanup.status).toBe(200);
  }
});
