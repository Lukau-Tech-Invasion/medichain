import { test, expect } from '@playwright/test';
import { seedDoctorMessage, signInAsFixturePatient, settle } from './support';

test('patient receives the doctor message, replies, and keeps the full history after reload', async ({ page, request }, testInfo) => {
  // The message this test is about, sent now rather than assumed to survive
  // from a previous session.
  const doctorMessage = await seedDoctorMessage(request);
  const patientReply = `Patient browser round-trip ${Date.now()}`;

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
