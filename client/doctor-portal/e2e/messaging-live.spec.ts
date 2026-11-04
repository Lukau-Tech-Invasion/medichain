import { test, expect } from '@playwright/test';
import { api, fixtureStaff, fixtureToken, readFixtures } from './identity';
import { settle, signIn, choose } from './support';

/**
 * A doctor on a phone writes to a patient, and the patient's open Messages
 * screen shows it without a reload.
 *
 * Reported from the live site as "the message is not sending": the patient's
 * message was saved (201) but appeared nowhere until a reload, because nothing
 * told an open screen; and on a phone the doctor's compose form opened below a
 * 520px conversation list, so tapping Compose looked like nothing happened.
 */

const PATIENT_APP = process.env.PATIENT_APP_URL || 'http://127.0.0.1/patient';

test('a doctor on a phone messages a patient, who sees it arrive live', async ({ browser, request }, testInfo) => {
  test.setTimeout(240_000);
  const patient = readFixtures().patient;
  const text = `Live message check ${Date.now().toString(36)}`;

  // The doctor must be treating the patient: the patient approves their
  // request for access, as in the patient app.
  const doctorAccount = fixtureStaff('Doctor', 0);
  const doctorToken = await fixtureToken(request, doctorAccount);
  const patientToken = await fixtureToken(request, { login_id: patient.login_id, password: patient.password ?? '' });
  const asked = await api(request, 'POST', `/api/access/patient/${patient.linked_patient_id}/requests`, {
    token: doctorToken,
    data: { reason: 'Messaging check' },
  });
  expect(asked.status, JSON.stringify(asked.body)).toBe(201);
  const approved = await api(request, 'POST', `/api/access/requests/${asked.body.request.id}/approve`, {
    token: patientToken,
    data: { expires_at: new Date(Date.now() + 86_400_000).toISOString() },
    confirm: { loginId: patient.login_id, password: patient.password ?? '' },
  });
  expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);

  // The patient, with Messages open.
  const patientContext = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const reader = await patientContext.newPage();
  await reader.goto(`${PATIENT_APP}/login`);
  await reader.locator('input#username').fill(patient.login_id);
  await reader.locator('input#password').fill(patient.password ?? '');
  await reader.locator('button[type="submit"]').click();
  await expect(reader).toHaveURL(/\/dashboard$/, { timeout: 30000 });
  await reader.goto(`${PATIENT_APP}/messages`);
  await expect(reader.locator('main')).toBeVisible({ timeout: 20000 });

  // The doctor, on an iPhone-sized screen.
  const doctorContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 390, height: 844 },
  });
  const doctor = await doctorContext.newPage();
  await signIn(doctor, 'Doctor', 0);
  await settle(doctor, '/messages');
  await doctor.getByRole('button', { name: /start a new conversation/i }).click();

  // The form is brought into view, not left below the conversation list.
  const recipient = doctor.locator('#msg-recipient');
  await expect(recipient).toBeInViewport({ timeout: 10000 });
  const patientOption = recipient.locator(
    `optgroup[label="Patients you are treating"] option[value="${patient.user_id}"]`
  );
  await expect(patientOption, 'the patient is not offered to the doctor who treats them').toHaveCount(1, {
    timeout: 20000,
  });
  await choose(recipient, { value: patient.user_id });
  await doctor.locator('textarea').first().fill(text);
  await doctor.getByRole('button', { name: /^send/i }).click();
  await expect(doctor.getByText(/sent/i).first()).toBeVisible({ timeout: 20000 });

  // The patient sees it without reloading: the conversation list updates live.
  await expect(reader.getByText(text).first(), 'the message did not reach the open patient screen').toBeVisible({
    timeout: 30000,
  });


  await doctorContext.close();
  await patientContext.close();
});
