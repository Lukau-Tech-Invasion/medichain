import { test, expect } from '@playwright/test';
import { signIn, settle, selectPatient } from './support';

/**
 * The laceration-repair page files a repair, and the repair comes back.
 *
 * This page had a complete form, a complete list, a detail view and a Save
 * button with **no `onClick` at all**. `createLaceration` and
 * `POST /api/clinical/laceration` had existed the whole time with no caller
 * anywhere in either application, so a clinician could fill the whole form and
 * the button was inert.
 *
 * Underneath it, `list_laceration_repairs` asked the repository for
 * `get_by_patient("all", ...)` -- a literal patient id, which behaves like a
 * wildcard in memory and matches nothing on PostgreSQL. Verified against a live
 * database on 2026-09-15: the write returned 201 and the list returned `[]`.
 *
 * So this test is deliberately a round trip through the browser and back out
 * of the list, not a click that asserts a request was sent. A save the screen
 * cannot read back is the defect class this codebase keeps producing.
 */
test('a doctor documents a laceration repair and it appears on the list', async ({ browser }) => {
  test.setTimeout(180000);
  const page = await browser.newPage();
  await signIn(page, 'Doctor');
  await settle(page, '/laceration-repair');

  const site = `Right forearm, dorsal aspect (e2e ${Date.now()})`;

  await page.getByRole('button', { name: /new repair/i }).click();

  // The picker queries /api/patients as the clinician types; take whatever it
  // offers first rather than naming a fixture, so this encodes no roster.
  await selectPatient(page, '#laceration-patient');

  await page.locator('#laceration-length').fill('3.5');
  await page.locator('#laceration-location').fill(site);
  await page.locator('#laceration-depth').selectOption('partial thickness');
  await page.locator('#laceration-closure-method').selectOption('sutures');
  await page.locator('#laceration-count').fill('6');

  await page.getByRole('button', { name: /save repair documentation/i }).click();

  // The page switches to the list and re-reads it from the API. The site the
  // clinician typed has to be in what comes back -- not in what the screen
  // remembers typing.
  await expect(page.getByText(site, { exact: false })).toBeVisible({ timeout: 20000 });

  // And it survives a fresh read: re-enter the page and look again.
  await settle(page, '/dashboard');
  await settle(page, '/laceration-repair');
  await expect(page.getByText(site, { exact: false })).toBeVisible({ timeout: 20000 });

  await page.close();
});

/**
 * The form refuses a wound length of zero.
 *
 * `length` initialises to 0 and the column is NOT NULL, so without this the
 * screen would file "0 cm" -- which reads as a measurement, not a blank. Rule
 * 10: an unmeasured thing is not a zero.
 */
test('a repair with no length is refused before it is sent', async ({ browser }) => {
  test.setTimeout(120000);
  const page = await browser.newPage();
  await signIn(page, 'Doctor');
  await settle(page, '/laceration-repair');
  await page.getByRole('button', { name: /new repair/i }).click();

  await selectPatient(page, '#laceration-patient');
  await page.locator('#laceration-location').fill('Left knee');
  // Length deliberately left at its initial 0.

  await page.getByRole('button', { name: /save repair documentation/i }).click();
  await expect(page.getByRole('alert')).toContainText(/length/i);

  await page.close();
});
