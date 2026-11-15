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
 * Workflow 10 — access transparency: what a clinician does under a grant
 * the patient gave is counted on that grant and listed in the patient's access
 * history, by the clinician's name.
 *
 * `access-grants.spec.ts` covers request, approval and withdrawal. This covers
 * what the ledger found broken: the grant's "recorded disclosures" read 0 while
 * 31 audit rows named it. The count is now derived from the retained audit
 * evidence, so the test makes a disclosure under the grant and reads it back.
 *
 *   clinician   an unrelated doctor provisioned for the run asks, is approved
 *               (confirmed with the patient's password), and opens the record
 *   patient     sees the grant's disclosures above zero, and the doctor's name
 *               in Access History
 *   cleanup     the grant is withdrawn and the doctor suspended
 */

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'account-creating flows run on the desktop project only');

let api_: APIRequestContext;
let admin: AdminApi | undefined;
let doctor: Throwaway | undefined;
let patientId = '';
let patientToken = '';
let confirm = { loginId: '', password: '' };

test.beforeAll(async ({ playwright }, testInfo) => {
  test.setTimeout(120_000);
  api_ = await apiContext(playwright, testInfo);
  const fixtures = readFixtures();
  patientId = fixtures.patient.linked_patient_id;
  confirm = { loginId: fixtures.patient.login_id, password: fixtures.patient.password ?? '' };
  patientToken = await fixtureToken(api_, { login_id: confirm.loginId, password: confirm.password });
  admin = await AdminApi.signIn(api_);
  doctor = await provisionStaff(api_, admin, 'Doctor', process.env.MEDICHAIN_FIXTURE_PASSWORD);
});

test.afterAll(async () => {
  try {
    if (doctor && patientToken) {
      const grants = await api(api_, 'GET', `/api/access/patient/${patientId}/grants`, { token: patientToken });
      for (const grant of grants.body?.grants ?? []) {
        if (grant.providerId === doctor.userId && grant.status === 'active') {
          await api(api_, 'POST', `/api/access/grants/${grant.id}/revoke`, { token: patientToken, data: {}, confirm });
        }
      }
    }
  } finally {
    try {
      if (doctor && admin) await admin.call('PUT', `/api/users/${doctor.userId}`, { status: 'suspended' });
    } finally {
      try { await admin?.release(); } finally { await api_?.dispose(); }
    }
  }
});

test('a disclosure under a grant is counted on it and named in the access history', async ({ page }) => {
  test.setTimeout(240_000);
  const reason = `Transparency check ${stamp()}`;

  // The clinician asks; the patient approves (Class C, with their password).
  const asked = await api(api_, 'POST', `/api/access/patient/${patientId}/requests`, { token: doctor!.token, data: { reason } });
  expect(asked.status, JSON.stringify(asked.body)).toBe(201);
  const requestId = String(asked.body?.request?.id ?? asked.body?.id ?? '');
  const expires = new Date(Date.now() + 2 * 86400000).toISOString();
  const approved = await api(api_, 'POST', `/api/access/requests/${requestId}/approve`, {
    token: patientToken,
    data: { expires_at: expires },
    confirm,
  });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  // The clinician opens the record under that grant.
  const context = await api(api_, 'POST', `/api/patients/${patientId}/access-context`, {
    token: doctor!.token,
    data: { reason: 'treatment' },
  });
  expect([200, 201]).toContain(context.status);
  const read = await api(api_, 'GET', `/api/records/${patientId}`, { token: doctor!.token });
  expect(read.status, 'the approved clinician could not read the record').toBe(200);

  // The patient sees it counted on the grant.
  await signInAsFixturePatient(page);
  await settle(page, '/consent');
  await page.getByRole('button', { name: /^active/i }).first().click();
  const grant = page.locator('.patient-card').filter({ hasText: doctor!.name });
  await expect(grant).toBeVisible({ timeout: 30000 });
  await grant.click();
  const details = page.getByRole('dialog', { name: 'Access Details' });
  await expect(details).toBeVisible();
  const counted = details.getByText(/\d+ entries/);
  await expect(counted).toBeVisible({ timeout: 20000 });
  const count = Number(/(\d+) entries/.exec(await counted.innerText())?.[1] ?? '0');
  expect(count, 'the disclosure under this grant was not counted').toBeGreaterThanOrEqual(1);
  await page.keyboard.press('Escape');

  // And named in the access history.
  await settle(page, '/access-history');
  await expect(page.locator('main').getByText(doctor!.name).first(), 'the clinician is not named in the access history').toBeVisible({
    timeout: 30000,
  });
});
