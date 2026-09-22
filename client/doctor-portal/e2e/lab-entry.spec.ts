import { test, expect, type Page } from '@playwright/test';
import { signIn, settle, selectPatient } from './support';

/**
 * A lab technician can enter a result.
 *
 * The technician's navigation carries a quick action labelled **"Enter
 * Result"**. It pointed at `/lab-results`, which could only *review*: nothing
 * in either client called `POST /api/lab/submit`, so a result could be
 * approved or rejected but never entered. The review queue had nothing in it
 * unless the API was driven directly — which is exactly what the role journey
 * does, so the journey passed while the screen could not do the job.
 *
 * The form reads its panels, units and reference ranges from
 * `GET /api/clinical/lab-panels` — the server's catalogue, which also had no
 * caller until now. Rule 8: a page never decides a clinical threshold.
 */

/**
 * Find a submission by its notes.
 *
 * The queue row shows only the test and patient name, and the notes live in
 * the expanded detail, so a row has to be opened to be identified. Order is
 * not guaranteed, so this opens each in turn rather than assuming the newest
 * is first.
 */
async function queueContainsNote(page: Page, note: string): Promise<boolean> {
  const rows = page.locator('h3');
  const count = Math.min(await rows.count(), 12);
  for (let i = 0; i < count; i += 1) {
    await rows.nth(i).click();
    if (await page.getByText(note, { exact: false }).isVisible().catch(() => false)) {
      return true;
    }
    await rows.nth(i).click(); // collapse again
  }
  return false;
}

test('a lab technician enters a result and it reaches the review queue', async ({ browser }) => {
  test.setTimeout(240000);
  const page = await browser.newPage();
  await signIn(page, 'LabTechnician');
  await settle(page, '/lab-results');

  await page.getByRole('tab', { name: /enter result/i }).click();

  // `PatientSelect` is a searchable combobox, not a native <select>: nobody
  // remembers a PAT- id, so the screens ask for a name. `selectPatient` takes
  // whatever the server offers first, so this still encodes no roster.
  const patientName = await selectPatient(page, '#lab-entry-patient');

  // The panels come from the server catalogue, so this asserts that reached
  // the screen at all.
  const panel = page.locator('#lab-entry-panel');
  const panelValue = await panel.locator('option').nth(1).getAttribute('value');
  expect(panelValue, 'no panels were offered — the catalogue did not load').toBeTruthy();
  await panel.selectOption(panelValue as string);

  // One analyte. The rest stay blank and must not be submitted as results
  // nobody measured.
  const firstValue = page.locator('input[id^="lab-value-"]').first();
  await expect(firstValue).toBeVisible();
  await firstValue.fill('13.1');

  const note = `Entered from the portal (e2e ${Date.now()})`;
  await page.locator('#lab-entry-notes').fill(note);
  await page.getByRole('button', { name: /submit for review/i }).click();

  // The page switches to the pending queue and re-reads it from the API.
  await expect
    .poll(() => queueContainsNote(page, note), { timeout: 30000 })
    .toBe(true);

  // And it is still there on a fresh mount — the queue is the server's, not
  // this screen's memory of what it just typed.
  await settle(page, '/dashboard');
  await settle(page, '/lab-results');
  await expect
    .poll(() => queueContainsNote(page, note), { timeout: 30000 })
    .toBe(true);

  // --- And a blank analyte is not a result -----------------------------------
  //
  // Every row in `results` carries a `value`, so a form that submitted its
  // empty rows would report values nobody measured -- rule 10, an unmeasured
  // thing is not a zero. Checked in the same session rather than its own test:
  // each sign-in costs a burst of requests, and two in a minute walks into the
  // API's 120/minute limiter, which fails as something that looks like a
  // product defect and is not.
  await page.getByRole('tab', { name: /enter result/i }).click();
  await selectPatient(page, '#lab-entry-patient', patientName);
  await page.locator('#lab-entry-panel').selectOption(panelValue as string);
  // Every analyte left blank this time.
  await page.getByRole('button', { name: /submit for review/i }).click();
  await expect(page.getByRole('alert')).toContainText(/at least one value/i);

  await page.close();
});