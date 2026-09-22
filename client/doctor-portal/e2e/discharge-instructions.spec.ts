import { test, expect } from '@playwright/test';
import { signIn, settle, selectPatient } from './support';

/**
 * Filing a discharge files the patient's take-home instructions too.
 *
 * `DischargePage` collected the diet, the activity restrictions, the warning
 * signs and the emergency instructions all along — and posted them onto the
 * discharge **summary**, the clinical record of the admission. The separate
 * discharge-instructions record, which is exactly what the patient's own
 * `GET /api/clinical/patient/{id}/discharges` returns under `instructions`,
 * was created by nothing in either client.
 *
 * So a patient could open their discharge and find the summary with no
 * instructions attached: no diet, no restrictions, nothing to come back for.
 * The endpoint had existed the whole time; `createDischargeInstructions` sat in
 * the shared client with no caller.
 *
 * This asserts the page now makes that second call and the server accepts it,
 * by watching the request rather than trusting the banner — a green banner is
 * what this page showed even for a failed save until today.
 */
test('filing a discharge also files the take-home instructions', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();

  const instructionCalls: number[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/clinical/discharge-instructions')) {
      instructionCalls.push(response.status());
    }
  });

  await signIn(page, 'Doctor');
  await settle(page, '/discharge');

  await page.getByRole('button', { name: /new discharge/i }).click();

  // The patient on this form is chosen through the searchable picker: a
  // clinician types a name rather than recalling a `PAT-` id.
  await selectPatient(page, '#dc-patient');

  const diagnosis = `Community-acquired pneumonia (e2e ${Date.now()})`;
  await page.locator('#dc-primary-diagnosis').fill(diagnosis);

  await page.getByRole('button', { name: /create discharge summary/i }).click();

  // The second call is the point of this test.
  await expect
    .poll(() => instructionCalls.length, { timeout: 30000 })
    .toBeGreaterThan(0);
  expect(
    instructionCalls[0],
    `the take-home instructions were rejected with ${instructionCalls[0]}`
  ).toBeLessThan(400);

  // And the screen did not report a failure.
  const alerts = page.getByRole('alert');
  if (await alerts.count()) {
    await expect(alerts.first()).not.toContainText(/could not|failed/i);
  }

  await page.close();
});
