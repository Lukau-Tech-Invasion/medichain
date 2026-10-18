import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFixtures } from './identity';
import { pickPatientById, settle, signIn } from './support';

/**
 * Workflow 2 — laboratory: a specimen is collected, rejected, re-collected
 * and the replacement linked, by the lab technician who does it.
 *
 * `lab-entry.spec.ts` and `workflows.spec.ts` cover result entry, approval and
 * the patient's read. This covers what happens before a result exists:
 *
 *   collect      the specimen is recorded and appears in the list after a reload
 *   reject       a category the technician did not choose is never preselected;
 *                the rejection is refused until one is chosen, then recorded
 *   recollect    the lab dashboard lists the rejection, asks for a reason through
 *                the in-app prompt, and opens a recollection request
 *   replace      a second specimen is collected and linked as the replacement
 *
 * The test-ordered text carries a run stamp, so nothing from an earlier run can
 * satisfy an assertion.
 */

const fixtures = () => readFixtures();

async function technician(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(page, 'LabTechnician', 0);
  return page;
}

async function collect(page: Page, patientId: string, tests: string) {
  await settle(page, '/specimen');
  await page.getByRole('button', { name: 'Collect Specimen' }).click();
  await pickPatientById(page, '#specimen-patient', patientId);
  await page.locator('#specimen-type').selectOption('blood');
  await page.locator('#specimen-priority').selectOption('stat');
  await page.locator('#specimen-tests-ordered').fill(tests);
  await page.getByRole('button', { name: /record collection/i }).click();
  await expect(page.getByText('Specimen collection recorded.')).toBeVisible({ timeout: 30000 });
}

/** The specimen card for this run, from the list after a reload. */
async function specimenCard(page: Page, tests: string) {
  await page.reload();
  await page.getByRole('button', { name: 'All Specimens' }).click();
  await page.getByRole('textbox', { name: /search/i }).first().fill(tests);
  const card = page.locator('main [role="button"]').filter({ hasText: tests }).first();
  await expect(card, `the specimen "${tests}" is not in the list after a reload`).toBeVisible({ timeout: 30000 });
  return card;
}

/** The collection id printed on a card: "Patient ID: PAT-… • <id>". */
async function specimenId(card: ReturnType<Page['locator']>): Promise<string> {
  const text = await card.innerText();
  const id = /•\s*(\S+)/.exec(text)?.[1];
  expect(id, `no collection id on the card: ${text}`).toBeTruthy();
  return id as string;
}

test('a rejected specimen is re-collected and the replacement linked', async ({ browser }) => {
  test.setTimeout(420_000);
  const patient = fixtures().patient;
  const run = Date.now().toString(36).slice(-6).toUpperCase();
  const tests = `QA full blood count ${run}`;
  const reason = `Haemolysed sample ${run}`;

  const lab = await technician(browser);

  // Collect, and find it again after a reload.
  await collect(lab, patient.linked_patient_id, tests);
  const card = await specimenCard(lab, tests);

  // Reject: no category is preselected, and the form says so before sending.
  await card.click();
  const detail = lab.getByRole('dialog');
  await expect(detail).toBeVisible();
  await expect(detail.locator('#reject-category')).toHaveValue('');
  await detail.locator('#reject-reason').fill(reason);
  await detail.getByRole('button', { name: /reject specimen/i }).click();
  await expect(detail.getByRole('status')).toBeVisible();
  await expect(detail.getByRole('status')).not.toContainText(/recorded/i);

  await detail.locator('#reject-category').selectOption('specimen_quality');
  await detail.getByRole('button', { name: /reject specimen/i }).click();
  await expect(detail.getByRole('status')).toContainText(/rejection .* recorded/i, { timeout: 30000 });
  // Escape closes the detail: it is a real dialog.
  await lab.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);

  // The lab dashboard lists the rejection; request a recollection with a reason.
  await settle(lab, '/dashboard');
  const rejection = lab.locator('main div').filter({ hasText: reason }).filter({
    has: lab.getByRole('button', { name: /request recollection/i }),
  }).last();
  await expect(rejection, 'the rejection is not on the lab dashboard').toBeVisible({ timeout: 30000 });
  await rejection.getByRole('button', { name: /request recollection/i }).click();
  const prompt = lab.getByRole('dialog').filter({ hasText: /why is another sample needed/i });
  await prompt.locator('input, textarea').first().fill(`Recollect ${run}`);
  await prompt.getByRole('button', { name: /^(ok|submit|confirm)$/i }).click();
  await expect(rejection.getByRole('status')).toContainText(/recollection requested/i, { timeout: 30000 });

  // Collect the replacement and link it to the open recollection.
  const replacementTests = `${tests} (replacement)`;
  await collect(lab, patient.linked_patient_id, replacementTests);
  const replacement = await specimenId(await specimenCard(lab, replacementTests));

  await settle(lab, '/dashboard');
  await lab.reload();
  const open = lab.locator('main div').filter({ hasText: `Recollect ${run}` }).filter({
    has: lab.getByRole('button', { name: /complete recollection/i }),
  }).last();
  await expect(open, 'the recollection request is not listed as open').toBeVisible({ timeout: 30000 });
  await open.getByRole('button', { name: /complete recollection/i }).click();
  const link = lab.getByRole('dialog').filter({ hasText: /replacement specimen id/i });
  await link.locator('input, textarea').first().fill(replacement);
  await link.getByRole('button', { name: /^(ok|submit|confirm)$/i }).click();
  // The row leaves the open list once completed; the confirmation stays on the page.
  await expect(lab.getByRole('status').filter({ hasText: /completed and linked/i })).toBeVisible({ timeout: 30000 });

  await lab.close();
});
