/**
 * Wireframe conformance: opens each staff screen drawn in docs/ux-mockups
 * (c1-c10) with real data and keeps a screenshot beside the mockup's, so the
 * two can be compared. Each test also asserts the wireframe's essentials --
 * the things that, missing, make the screen a different screen.
 *
 * Screenshots: .browser-test/wireframes/<id>.png
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { declareAccessReason, fixturePatientId, settle, signIn } from './support';
import { fixtureArtifactPath, fixtureManifestPath } from './fixture-manifest';

const OUT = fixtureArtifactPath('wireframes');
mkdirSync(OUT, { recursive: true });

async function shot(page: Page, id: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${id}.png`, fullPage: false });
}

test.describe.configure({ mode: 'serial' });

test.describe('doctor', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('c8 incoming board, c9 received triage, c4 workspace, c3 vitals, c5 close, c10 glide', async ({ page }) => {
    // Count View Transitions: the glide only exists if one runs.
    await page.addInitScript(() => {
      const w = window as unknown as { __vt: number };
      w.__vt = 0;
      const doc = document as Document & { startViewTransition?: (u: () => void) => unknown };
      const real = doc.startViewTransition?.bind(document);
      if (real) doc.startViewTransition = (u: () => void) => { w.__vt += 1; return real(u); };
    });
    await signIn(page, 'Doctor');

    await settle(page, '/ems-incoming');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'c8-ed-incoming');

    const patientId = fixturePatientId();
    await settle(page, `/patients/${patientId}`);
    await declareAccessReason(page, 'Treatment');
    await expect(page.getByRole('banner', { name: /patient/i }).or(page.locator('header[aria-label]')).first()).toBeVisible();
    await expect(page.getByRole('complementary', { name: /this visit/i })).toBeVisible();
    await shot(page, 'c4-patient-workspace');

    await settle(page, `/patients/${patientId}/triage`);
    await expect(page.getByLabel(/Heart Rate/i)).toBeVisible();
    // Inside the chart: no picker, no queue tabs (c9).
    await expect(page.getByRole('button', { name: /Triage Queue/i })).toHaveCount(0);
    await shot(page, 'c9-received-triage');
    const use = page.getByRole('button', { name: 'Use ambulance values' });
    if (await use.isVisible().catch(() => false)) {
      await use.click();
      await expect(page.getByText(/check and change before saving/i)).toBeVisible();
      await shot(page, 'c9-received-triage-filled');
    }

    await settle(page, `/patients/${patientId}/vitals`);
    // In the chart: no patient picker (the chart chose them), a time taken.
    await expect(page.getByLabel('Time taken')).toBeVisible();
    await expect(page.getByText('patient open in this workspace')).toHaveCount(0);
    await expect(page.getByText('Back to Dashboard')).toHaveCount(0);
    await shot(page, 'c3-patient-first-form');

    await page.getByRole('button', { name: /close patient/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, 'c5-close-patient');
    await page.keyboard.press('Escape');

    await settle(page, '/today');
    await shot(page, 'c10-today');
    const before = await page.evaluate(() => (window as unknown as { __vt: number }).__vt);
    const row = page.getByRole('link').filter({ has: page.locator('[data-patient-identity]') }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.waitForTimeout(800);
      const after = await page.evaluate(() => (window as unknown as { __vt: number }).__vt);
      test.info().annotations.push({ type: 'c10', description: `view transitions on open: ${after - before}` });
      expect(after - before).toBeGreaterThan(0);
    } else {
      test.info().annotations.push({ type: 'c10', description: 'Today lists no patient to open' });
    }
  });

  test('c1 break-glass for a clinician with no care relationship', async ({ page }) => {
    await signIn(page, 'Doctor', 1);
    const fixtures = JSON.parse(readFileSync(fixtureManifestPath(), 'utf8')) as { patient_b?: { linked_patient_id?: string } };
    const other = fixtures.patient_b?.linked_patient_id ?? fixturePatientId();
    await settle(page, `/patients/${other}`);
    await page.waitForTimeout(1500);
    await shot(page, 'c1-reason');
    // No care relationship: the declared reason is refused and break-glass is offered.
    await page.getByRole('button', { name: 'Emergency', exact: true }).click();
    await page.waitForTimeout(2500);
    // Opened from a bare link: who it is was never established in this tab,
    // so the screen names the id and asks the server nothing about them.
    await expect(page.getByText(`Patient ID ${other}`)).toBeVisible();
    await shot(page, 'c1-break-glass');
  });
});

test.describe('nurse', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('c2 shift handoff', async ({ page }) => {
    await signIn(page, 'Nurse');
    await settle(page, '/shift-handoff');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'c2-shift-handoff');
  });
});

test.describe('paramedic', () => {
  test.use({ viewport: { width: 412, height: 915 } });
  test('c6 ambulance run, c7 choose hospital', async ({ page }) => {
    await signIn(page, 'Paramedic');
    await settle(page, '/ems-run');
    // The run screen, not a refusal: the paramedic's dashboard redirects here.
    await expect(page.getByText(/restricted to/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'c6-run-list');
    // c6 is one run open: the newest still on scene, so c7's "leave scene" is offered.
    await page.getByRole('button', { name: /on scene/i }).first().click();
    await expect(page).toHaveURL(/\/ems-run\/.+/);
    await page.waitForTimeout(1500);
    await shot(page, 'c6-ambulance-run');
    const leave = page.getByRole('button', { name: /leave scene|leaving/i }).first();
    if (await leave.isVisible().catch(() => false)) {
      await leave.click();
      await page.waitForTimeout(800);
      await shot(page, 'c7-choose-hospital');
      await page.keyboard.press('Escape');
    }
  });
});
