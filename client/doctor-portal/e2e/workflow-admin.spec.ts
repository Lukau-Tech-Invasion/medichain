import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { settle, signIn } from './support';

/**
 * Workflow 9 — administration: a research export is proposed and waits for
 * other administrators, and the access-review file downloads with what it says.
 *
 * `admin-accounts.spec.ts`, `retention.spec.ts` and `guardianship.spec.ts` cover
 * accounts, legal holds and guardianship. This covers:
 *
 *   research export   a purpose under the minimum is refused; a stated purpose is
 *                     proposed; the proposer is told two OTHER administrators
 *                     must approve and is offered no Approve button of their own
 *   access review     the CSV downloads, carries the header the reviewer reads,
 *                     and every cell is quoted (a typed value cannot shift columns
 *                     or run as a spreadsheet formula)
 *   review queues     security alerts and national-ID manual reviews load as
 *                     lists or as an honest empty state, never an error
 *
 * Approving an export needs two further administrators; the fixture set has one,
 * so the two-person approval itself is proved in the API tests, not here.
 */

test('a research export waits for other administrators, and the access review downloads intact', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'Admin', 0);

  // Research export.
  await settle(page, '/research-exports');
  const purpose = page.getByLabel('Purpose and recipient');
  await purpose.fill('Too short');
  const propose = page.getByRole('button', { name: 'Propose export' });
  if (await propose.isEnabled()) {
    await propose.click();
    await expect(page.locator('main').getByText(/no export|exports yet/i).or(page.getByRole('alert')).first()).toBeVisible({
      timeout: 15000,
    });
  }
  const run = Date.now().toString(36).toUpperCase();
  await purpose.fill(`Readmission study QA${run} for the provincial outcomes unit`);
  await propose.click();
  await expect(page.locator('main').getByText(/two other administrators must approve/i).first()).toBeVisible({
    timeout: 30000,
  });
  const mine = page.locator('main li, main article, main div').filter({ hasText: /two other administrators must approve/i }).last();
  await expect(mine.getByRole('button', { name: /^approve$/i }), 'the proposer is offered their own approval').toHaveCount(0);

  // Access review download.
  await settle(page, '/access-logs');
  const download = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: /export csv/i }).click();
  const file = await download;
  const path = await file.path();
  const csv = readFileSync(path!, 'utf8');
  const [header, ...rows] = csv.split('\n');
  expect(header).toBe('"Access ID","Patient ID","Accessor ID","Accessor Name","Role","Access Type","Location","Timestamp","Emergency"');
  for (const row of rows.filter(Boolean).slice(0, 50)) {
    expect(row, 'a row is not fully quoted').toMatch(/^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*"){8}$/);
    expect(row, 'a cell would run as a spreadsheet formula').not.toMatch(/(^|,)"[=+\-@]/);
  }

  // The review queues load.
  for (const route of ['/security-incidents', '/national-id-reviews']) {
    await settle(page, route);
    await expect(page.locator('main [role="alert"]').filter({ hasText: /failed|could not|error/i })).toHaveCount(0);
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
  }
});
