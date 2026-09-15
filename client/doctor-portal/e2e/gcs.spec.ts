import { test, expect } from '@playwright/test';
import { signIn, settle } from './support';

/**
 * A nurse records a Glasgow Coma Scale assessment.
 *
 * `POST /api/clinical/gcs`, `GET /api/clinical/gcs/{id}` and
 * `GET /api/clinical/patient/{id}/gcs` have existed as long as the feature, and
 * `createGCS` / `getGCS` / `getPatientGCS` sat in the shared client with **no
 * caller at either end**: no screen wrote a GCS assessment and none read one.
 *
 * What the vitals form had instead was a free-typed `gcs_total` — a number with
 * no eye, verbal or motor components behind it, which cannot be checked,
 * trended or defended. This records the components.
 *
 * The scale's options come from `GET /api/clinical/scoring/catalog`, and the
 * total, its interpretation and the airway risk all come back from the server:
 * rule 8, a page never decides a derived clinical value. The assertions below
 * are written against that — the test picks E3/V4/M5 and requires the screen to
 * show **12**, a number it was never told.
 */
test('a nurse records a GCS assessment and the server scores it', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'Nurse');
  await settle(page, '/vitals');

  // Choosing a patient is what reveals the assessment card. `PatientSelect` is
  // a searchable combobox -- a text input over a dropdown of buttons -- not a
  // native <select>, so it is opened and clicked rather than selectOption'd.
  const patientSearch = page.locator('#vitals-patient-select');
  await expect(patientSearch).toBeVisible({ timeout: 20000 });
  await patientSearch.click();
  const firstPatient = page.locator('button', { hasText: /PAT-/ }).first();
  await expect(firstPatient).toBeVisible({ timeout: 20000 });
  await firstPatient.click();

  // The card only renders once the catalogue has loaded, so its presence is
  // itself the assertion that the scale reached the screen.
  const eye = page.locator('#gcs-eye');
  await expect(eye).toBeVisible({ timeout: 20000 });
  await expect(eye.locator('option')).toHaveCount(5); // placeholder + 4 scores
  await expect(page.locator('#gcs-verbal option')).toHaveCount(6); // + 5 scores
  await expect(page.locator('#gcs-motor option')).toHaveCount(7); // + 6 scores

  // An incomplete assessment is refused: a missing component is not a lower
  // score, and the total the server computed would silently be wrong.
  await eye.selectOption('3');
  await page.getByRole('button', { name: /record gcs assessment/i }).click();
  await expect(page.getByRole('alert')).toContainText(/all three components/i);

  // E3 + V4 + M5 = 12. The page is never told that; the server returns it.
  await page.locator('#gcs-verbal').selectOption('4');
  await page.locator('#gcs-motor').selectOption('5');
  await page.locator('#gcs-notes').fill(`Neuro obs (e2e ${Date.now()})`);
  await page.getByRole('button', { name: /record gcs assessment/i }).click();

  const result = page.getByRole('status');
  await expect(result).toContainText('GCS 12', { timeout: 20000 });
  // And the server's own interpretation of that score.
  await expect(result).toContainText(/moderate brain injury/i);

  await page.close();
});
