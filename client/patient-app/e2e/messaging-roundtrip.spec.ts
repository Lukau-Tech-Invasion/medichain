import { test, expect } from '@playwright/test';
import { signInAsFixturePatient, settle } from './support';

const doctorMessage = 'Doctor browser round-trip 2026-09-21 20:31';
const patientReply = 'Patient browser round-trip 2026-09-21 20:35';

test('patient receives the doctor message, replies, and keeps the full history after reload', async ({ page }, testInfo) => {
  await signInAsFixturePatient(page);
  await settle(page, '/messages');

  const conversation = page.getByRole('button', { name: new RegExp(doctorMessage) });
  await expect(conversation).toBeVisible();
  await conversation.click();
  await expect(page.getByText(doctorMessage, { exact: true })).toBeVisible();

  await page.getByPlaceholder('Type a message...').fill(patientReply);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(patientReply, { exact: true })).toBeVisible();

  await page.reload();
  await page.locator('main').first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: new RegExp(patientReply) }).click();
  await expect(page.getByText(doctorMessage, { exact: true })).toBeVisible();
  await expect(page.getByText(patientReply, { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('patient-doctor-message-history.png'), fullPage: true });
});
