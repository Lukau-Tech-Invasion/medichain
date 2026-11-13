import { test, expect, type Page } from '@playwright/test';
import { settle, signIn, testFixtures } from './support';
import { api, fixtureToken } from '../../doctor-portal/e2e/identity';

/**
 * Notifications have New and History, and one can be removed.
 *
 * Read state used to be a single "read up to" marker that only "Mark all as
 * read" moved, so opening a notification left it new forever. This walks the
 * patient's own list in the browser:
 *
 *   1. tapping a new notification moves it to History, and it stays there
 *      after a reload (the server holds the mark, not the page);
 *   2. removing one takes it off the screen for good, while the record it
 *      describes (the emergency access in the patient's access history) is
 *      untouched.
 *
 * It needs at least one notification: the fixture patient has emergency
 * accesses from the emergency specs. Run those first on a fresh database.
 */

const tabCount = async (page: Page, name: 'New' | 'History') => {
  const label = await page.getByRole('tab', { name: new RegExp(`^${name} \\(\\d+\\)$`) }).innerText();
  return Number(/\((\d+)\)/.exec(label)?.[1] ?? NaN);
};

test('a read notification moves to History, and a removed one leaves the screen but not the record', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const patient = testFixtures().patient;
  await signIn(page);
  await settle(page, '/notifications');
  await expect(page.getByRole('tab', { name: /^New \(\d+\)$/ })).toBeVisible({ timeout: 30000 });

  const newBefore = await tabCount(page, 'New');
  const historyBefore = await tabCount(page, 'History');
  expect(newBefore + historyBefore, 'the patient has no notifications; run the emergency specs first').toBeGreaterThan(0);

  // 1. Read one.
  if (newBefore > 0) {
    await page.locator('main .patient-card button.text-left').first().click();
    await expect.poll(() => tabCount(page, 'New'), { timeout: 20000 }).toBe(newBefore - 1);
    expect(await tabCount(page, 'History')).toBe(historyBefore + 1);
    await page.reload();
    await expect(page.getByRole('tab', { name: `History (${historyBefore + 1})` })).toBeVisible({ timeout: 30000 });
  }

  // 2. Remove one from History.
  const token = await fixtureToken(request, { login_id: patient.login_id, password: patient.password ?? '' });
  const accessLog = async () => {
    const response = await api(request, 'GET', `/api/patients/${patient.linked_patient_id}/emergency-capsule/access-log`, {
      token,
    });
    return response.status === 200 ? Number(response.body?.count ?? 0) : null;
  };
  const recordsBefore = await accessLog();

  await page.getByRole('tab', { name: /^History/ }).click();
  const historyNow = await tabCount(page, 'History');
  const remove = page.getByRole('button', { name: /^Remove ".*" from your notifications$/ }).first();
  await remove.click();
  await expect.poll(() => tabCount(page, 'History'), { timeout: 20000 }).toBe(historyNow - 1);
  await page.reload();
  await expect(page.getByRole('tab', { name: `History (${historyNow - 1})` })).toBeVisible({ timeout: 30000 });

  // The record underneath is still there.
  if (recordsBefore !== null) {
    expect(await accessLog(), 'removing a notification removed the record it describes').toBe(recordsBefore);
  }
});
