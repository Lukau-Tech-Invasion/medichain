import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { signIn, settle, selectPatient, fixturePatientId } from './support';
import { api, fixtureStaff, fixtureToken, readFixtures, FIXTURE_PASSWORD } from './identity';
import { fixtureArtifactPath } from './fixture-manifest';

/**
 * A paediatric assessment stores only what the clinician observed.
 *
 * The form used to preselect "Normal" for all three Paediatric Assessment
 * Triangle findings and "on track" development, and the API then turned every
 * absent observation into 0 or false: no estimated weight, a guardian present,
 * no child-protection concern, CPS not notified. Each of those reads as a
 * finding.
 *
 * The page renders no saved assessment (only growth points, and only for an
 * under-18 register entry), so the readback is the stored record through the
 * same read endpoints the page and the growth chart use, with the signed-in
 * clinician's own token:
 *
 *   1. saved from the browser, then read back after a full page reload;
 *   2. read back again after the API process restarted: stop and restart the
 *      API, then `npx playwright test pediatrics-unknown -g "API restart"`;
 *   3. the patient portal: no patient-role read path exists for paediatric
 *      assessments, so Patient A is refused (recorded as a limitation in
 *      BROWSER_TEST_COVERAGE.md) and Patient B is refused both by id and by
 *      Patient A's record id.
 */

/** Where phase 1 leaves the saved assessment for the after-restart phase. */
function readbackFile(): string {
  return fixtureArtifactPath('peds-readback.json');
}

interface SavedAssessment {
  assessment_id: string;
  marker: string;
  patient_id: string;
  assessed_by: string;
  saved_at: string;
}

/** The stored row matches what was entered, and nothing unobserved became a finding. */
async function expectStoredUnknowns(request: APIRequestContext, token: string, saved: SavedAssessment) {
  const byId = await api(request, 'GET', `/api/clinical/peds/${saved.assessment_id}`, { token });
  expect(byId.status, JSON.stringify(byId.body)).toBe(200);
  const record = byId.body;
  expect(record.id).toBe(saved.assessment_id);
  expect(record.patient_id).toBe(saved.patient_id);
  expect(record.assessed_by).toBe(saved.assessed_by);
  expect(Number(record.weight_kg)).toBeCloseTo(14.2, 5);
  expect(String(record.notes)).toContain(saved.marker);
  for (const field of [
    'weight_estimated',
    'parent_guardian_present',
    'child_protective_concerns',
    'cps_notified',
    'appearance_score',
    'work_of_breathing',
    'circulation_to_skin',
    'age_months',
  ]) {
    expect(record[field], `${field} must stay unknown`).toBeNull();
  }

  // The list the growth chart reads holds the same record.
  const list = await api(request, 'GET', `/api/clinical/peds/patient/${saved.patient_id}`, { token });
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  const items = (Array.isArray(list.body) ? list.body : list.body.items) as Array<{ id: string }>;
  expect(items.map((item) => item.id)).toContain(saved.assessment_id);
}

test.describe.serial('paediatric assessment readback', () => {
  test('a paediatric assessment leaves unobserved findings unknown', async ({ browser, request }) => {
    test.setTimeout(180000);
    const marker = process.env.PEDS_QA_MARKER ?? `QA-PEDS-UNKNOWN-${Date.now()}`;
    const shots = process.env.E2E_SCREENSHOT_DIR;
    const page = await browser.newPage();
    // Doctor #0, the same account `fixtureStaff('Doctor')` reads back as the author;
    // `signIn` otherwise rotates through the fixture doctors.
    await signIn(page, 'Doctor', 0);
    await settle(page, '/pediatrics');
    await page.getByRole('button', { name: 'Assessment', exact: true }).click();

    for (const label of ['Appearance', 'Work of Breathing', 'Circulation']) {
      // A chip group now: nothing chosen until somebody observes it.
      await expect(page.getByRole('group', { name: label, exact: true }).getByRole('radio', { checked: true })).toHaveCount(0);
    }
    await expect(page.getByRole('radio', { name: 'Not assessed' })).toBeChecked();

    // An incomplete form names what is missing; it used to do nothing at all.
    await page.getByRole('button', { name: /sign & submit assessment/i }).click();
    await expect(page.getByText('Enter a patient')).toBeVisible();
    await expect(page.getByText('Enter the heart rate')).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/doctor-pediatrics-required-named.png`, fullPage: true });

    await selectPatient(page, '#peds-patient');
    await page.locator('#peds-weight').fill('14.2');
    await page.locator('#peds-hr').fill('104');
    await page.locator('#peds-notes').fill(`Fictional synthetic QA record, no care given. ${marker}`);
    if (shots) await page.screenshot({ path: `${shots}/doctor-pediatrics-unknown-before-save.png`, fullPage: true });

    const created = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/api\/clinical\/peds$/.test(response.url())
    );
    await page.getByRole('button', { name: /sign & submit assessment/i }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const assessmentId = String((await response.json()).assessment_id ?? '');
    expect(assessmentId).toMatch(/\S/);

    await expect(page.getByText('Pediatric assessment successfully submitted.')).toBeVisible({ timeout: 20000 });
    if (shots) await page.screenshot({ path: `${shots}/doctor-pediatrics-unknown-saved.png`, fullPage: true });

    // A full reload: nothing of the submitted form survives in the page, and
    // the record is read back from storage rather than from component state.
    // Whether the session survives a full load depends on `restoreSession`
    // (on 2026-10-13 it did); if it lands on sign-in the clinician signs in again.
    await page.reload();
    const sidebar = page.getByRole('navigation', { name: /sidebar/i });
    const signInForm = page.locator('input#identifier');
    await expect(sidebar.or(signInForm)).toBeVisible({ timeout: 30000 });
    if (await signInForm.isVisible()) await signIn(page, 'Doctor', 0);
    await settle(page, '/pediatrics');
    await page.getByRole('button', { name: 'Assessment', exact: true }).click();
    await expect(page.locator('#peds-notes')).toHaveValue('');
    if (shots) await page.screenshot({ path: `${shots}/doctor-pediatrics-after-reload.png`, fullPage: true });
    await page.close();

    const doctor = fixtureStaff('Doctor');
    const saved: SavedAssessment = {
      assessment_id: assessmentId,
      marker,
      patient_id: fixturePatientId(),
      assessed_by: doctor.user_id,
      saved_at: new Date().toISOString(),
    };
    await expectStoredUnknowns(request, await fixtureToken(request, doctor), saved);
    mkdirSync(dirname(readbackFile()), { recursive: true });
    writeFileSync(readbackFile(), JSON.stringify(saved, null, 2));
  });

  test('the patient portal has no read path; Patient B cannot reach Patient A', async ({ request }) => {
    const saved = JSON.parse(readFileSync(readbackFile(), 'utf8')) as SavedAssessment;
    const fixtures = readFixtures();
    for (const [who, account] of [
      ['Patient A', fixtures.patient],
      ['Patient B', fixtures.patient_b],
    ] as const) {
      const token = await fixtureToken(request, {
        login_id: account.login_id,
        password: account.password ?? FIXTURE_PASSWORD,
      });
      const byId = await api(request, 'GET', `/api/clinical/peds/${saved.assessment_id}`, { token });
      expect(byId.status, `${who} by id: ${JSON.stringify(byId.body)}`).toBe(403);
      const list = await api(request, 'GET', `/api/clinical/peds/patient/${saved.patient_id}`, { token });
      expect([401, 403], `${who} list: ${JSON.stringify(list.body)}`).toContain(list.status);
      expect(JSON.stringify(list.body)).not.toContain(saved.marker);
    }
  });

  test('the saved assessment survives an API restart', async ({ request }) => {
    const file = readbackFile();
    test.skip(!existsSync(file), 'no saved assessment; run the first test');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as SavedAssessment;
    const health = await api(request, 'GET', '/api/health/detailed');
    expect(health.status).toBe(200);
    const secondsSinceSave = (Date.now() - Date.parse(saved.saved_at)) / 1000;
    // Only a process that started after the save proves durability; in a plain
    // suite run the API has not restarted, so this phase is run on its own after one.
    test.skip(
      Number(health.body.uptime_seconds) >= secondsSinceSave,
      'the API has not restarted since the save; restart it and re-run with -g "API restart"'
    );
    const doctor = fixtureStaff('Doctor');
    await expectStoredUnknowns(request, await fixtureToken(request, doctor), saved);
  });
});
