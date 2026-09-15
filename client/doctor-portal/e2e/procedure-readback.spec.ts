import { test, expect, type Page } from '@playwright/test';
import { signIn, settle } from './support';

/**
 * Three screens that documented a procedure and then forgot it.
 *
 * `IntubationPage`, `SplintPage` and `AnesthesiaPage` each posted their record
 * and then did `setRecords([newRecord, ...records])` -- local React state,
 * never read back. What the worklist showed was this session's typing; a reload
 * emptied it, while every record sat in the database reachable only by an id
 * the screen never displayed.
 *
 * Anaesthesia was worse: `create_anesthesia` demanded the COMPLETE typed
 * `AnesthesiaRecord` (38 required fields, five nested structs) while the page
 * documents a flat summary, so every save failed with `missing field record_id`
 * and surfaced as a generic error. Its list endpoint was unreachable too --
 * registered after `/{id}`, so the literal path `list` was captured as a record
 * id and answered 404.
 *
 * So each test here does the same thing, and it is deliberately the round trip
 * rather than a click that asserts a request was sent: document the procedure,
 * leave the page, come back, and require the record to still be there. That
 * second visit is the whole point -- it is what a local list cannot survive.
 */

/**
 * Open the worklist.
 *
 * All three screens put the saved records behind a "History" tab; the form is
 * the default view. A test that saves and then looks at the page it is already
 * on sees the form, which is exactly what these assertions did on their first
 * run.
 */
async function openHistory(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^history$/i }).click();
}

/** Pick the first real patient the page offers, rather than naming a fixture. */
async function selectFirstPatient(page: Page, selector: string): Promise<void> {
  const select = page.locator(selector);
  await expect(select).toBeVisible({ timeout: 20000 });
  const value = await select.locator('option').nth(1).getAttribute('value');
  expect(value, `no patients were offered by ${selector}`).toBeTruthy();
  await select.selectOption(value as string);
}

test('an intubation survives leaving the page and coming back', async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage();
  await signIn(page, 'Doctor');
  await settle(page, '/intubation');

  const indication = await page
    .locator('#intub-indication option')
    .nth(1)
    .getAttribute('value');
  expect(indication, 'no indication options were offered').toBeTruthy();

  await selectFirstPatient(page, '#intub-patient');
  await page.locator('#intub-indication').selectOption(indication as string);
  await page.getByRole('button', { name: /document intubation/i }).click();

  // The worklist is re-read from the API after the save.
  await openHistory(page);
  await expect(page.locator('h3').first()).toBeVisible({ timeout: 20000 });

  // The assertion a local list cannot pass.
  await settle(page, '/dashboard');
  await settle(page, '/intubation');
  await openHistory(page);
  await expect(page.locator('h3').first()).toBeVisible({ timeout: 20000 });

  await page.close();
});

test('a splint survives leaving the page and coming back', async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage();
  await signIn(page, 'Doctor');
  await settle(page, '/splint');

  // Every field on this form is a select, so there is no free text to tag the
  // record with. The list is ward-wide and already holds other people's
  // records, so "a card is visible" would pass without this save having worked
  // at all. Counting is what actually distinguishes them.
  await openHistory(page);
  const before = await page.locator('h3').count();

  // Exactly this label: the sidebar also carries "New SOAP" and "New Rx".
  await page.getByRole('button', { name: /^new application$/i }).click();
  await selectFirstPatient(page, '#splint-patient');
  for (const id of ['#splint-body-part', '#splint-indication']) {
    const value = await page.locator(`${id} option`).nth(1).getAttribute('value');
    expect(value, `no options offered by ${id}`).toBeTruthy();
    await page.locator(id).selectOption(value as string);
  }
  await page.getByRole('button', { name: /save splint\/cast record/i }).click();

  await openHistory(page);
  await expect
    .poll(async () => page.locator('h3').count(), { timeout: 20000 })
    .toBeGreaterThan(before);
  const after = await page.locator('h3').count();

  // The assertion a local list cannot pass: the count survives a fresh mount.
  await settle(page, '/dashboard');
  await settle(page, '/splint');
  await openHistory(page);
  await expect
    .poll(async () => page.locator('h3').count(), { timeout: 20000 })
    .toBe(after);

  await page.close();
});

test('an anaesthetic record saves at all, and survives a return visit', async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage();
  await signIn(page, 'Doctor');
  await settle(page, '/anesthesia');

  const procedure = `Open reduction (e2e ${Date.now()})`;
  await selectFirstPatient(page, '#anes-patient');
  await page.locator('#anes-procedure').fill(procedure);
  await page.getByRole('button', { name: /save anesthesia record/i }).click();

  // Before the fix this never appeared: the request 400'd on every submission.
  await openHistory(page);
  await expect(page.getByText(procedure, { exact: false })).toBeVisible({ timeout: 20000 });

  await settle(page, '/dashboard');
  await settle(page, '/anesthesia');
  await openHistory(page);
  await expect(page.getByText(procedure, { exact: false })).toBeVisible({ timeout: 20000 });

  await page.close();
});
