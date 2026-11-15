import { test, expect } from '@playwright/test';
import { api, fixtureStaff, fixtureToken, readFixtures } from './identity';

/**
 * A notification reaches the account it is for, and nobody else.
 *
 * Every real-time event used to reach every staff and administrator
 * connection: a doctor set a patient's medication reminder, and "Time to take"
 * appeared on the administrator's screen and every clinician's. This opens the
 * live event stream (`GET /api/events`) as the administrator, a doctor, the
 * patient and a second patient, then
 *
 *   1. a laboratory technician reports a critical value for the patient: the
 *      patient and (only if treating them) the doctor are told; the
 *      administrator and the other patient are not;
 *   2. the doctor sets the patient a medication reminder that falls due: only
 *      the patient is told.
 *
 * The reminder job runs once a minute against the clinic's HH:MM, so the reminder is
 * set for the next two minutes and the streams stay open long enough to see it.
 */

const fixtures = () => readFixtures();

interface Listener {
  events: Array<{ event_type: string; patient_id?: string | null; payload?: Record<string, unknown> }>;
  stop: () => void;
}

/** Open `/api/events` as `token` and collect every event frame until stopped. */
function listen(baseURL: string, token: string): Listener {
  const controller = new AbortController();
  const listener: Listener = { events: [], stop: () => controller.abort() };
  void (async () => {
    const response = await fetch(`${baseURL}/api/events`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`event stream refused: ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (frame.startsWith('data: ')) listener.events.push(JSON.parse(frame.slice(6)));
      }
    }
  })().catch(() => undefined);
  return listener;
}

/**
 * Reminder times are the clinic's wall clock (`CLINIC_TIMEZONE`): South
 * Africa, UTC+2, unless E2E_CLINIC_UTC_OFFSET_MINUTES says otherwise.
 */
const CLINIC_OFFSET_MINUTES = Number(process.env.E2E_CLINIC_UTC_OFFSET_MINUTES ?? 120);
const clinicMinute = (offset: number) =>
  new Date(Date.now() + (offset + CLINIC_OFFSET_MINUTES) * 60_000).toISOString().slice(11, 16);

test('a patient\'s notifications reach that patient and their clinician, not the administrator', async ({
  request,
}, testInfo) => {
  test.setTimeout(300_000);
  const baseURL = String(testInfo.project.use.baseURL ?? '').replace(/\/$/, '');
  const { patient, patient_b: otherPatient } = fixtures();
  expect(otherPatient, 'the fixture has no second patient').toBeTruthy();
  const token = (account: { login_id: string; password?: string }) =>
    fixtureToken(request, { login_id: account.login_id, password: account.password ?? '' });

  const adminToken = await token(fixtureStaff('Admin'));
  const doctorToken = await token(fixtureStaff('Doctor', 0));
  const labToken = await token(fixtureStaff('LabTechnician', 0));
  const patientToken = await token(patient);
  const otherToken = await token(otherPatient!);

  // Whether this doctor is treating the patient decides what they should see.
  const chart = await api(request, 'GET', `/api/patients/${patient.linked_patient_id}`, { token: doctorToken });
  const doctorTreats = chart.status === 200;

  const streams = {
    admin: listen(baseURL, adminToken),
    doctor: listen(baseURL, doctorToken),
    patient: listen(baseURL, patientToken),
    other: listen(baseURL, otherToken),
  };
  try {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const analyte = `Potassium QA-${Date.now().toString(36)}`;
    const reported = await api(request, 'POST', '/api/clinical/critical-value', {
      token: labToken,
      data: { patientId: patient.linked_patient_id, analyte, value: 6.9, unit: 'mmol/L', criticalLevel: 'high' },
    });
    expect(reported.status, JSON.stringify(reported.body)).toBe(201);

    const medication = `Notify-QA ${Date.now().toString(36)}`;
    const reminder = await api(request, 'POST', '/api/reminders/medication', {
      token: doctorToken,
      data: {
        patient_id: patient.linked_patient_id,
        medication_name: medication,
        dosage: '1 tablet',
        frequency: 'once',
        reminder_times: [clinicMinute(1), clinicMinute(2)],
        start_date: new Date().toISOString().slice(0, 10),
        push_notification: true,
      },
    });
    expect(reminder.status, JSON.stringify(reminder.body)).toBeLessThan(300);

    const alertFor = (l: Listener) => l.events.some((e) => e.event_type === 'cds_alert' && String(e.payload?.title ?? '').includes(analyte));
    const reminderFor = (l: Listener) => l.events.some((e) => e.event_type === 'reminder_due' && e.payload?.medication === medication);

    await expect.poll(() => alertFor(streams.patient), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => reminderFor(streams.patient), { timeout: 180_000, intervals: [5_000] }).toBe(true);
    // Both have been delivered; anything else would have arrived by now.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    expect(alertFor(streams.doctor), 'the treating relationship decides the doctor\'s alert').toBe(doctorTreats);
    expect(alertFor(streams.admin), 'the administrator was told about a patient\'s lab value').toBe(false);
    expect(alertFor(streams.other), 'another patient was told about this patient\'s lab value').toBe(false);
    expect(reminderFor(streams.doctor), 'the doctor received the patient\'s own reminder').toBe(false);
    expect(reminderFor(streams.admin), 'the administrator received the patient\'s reminder').toBe(false);
    expect(reminderFor(streams.other), 'another patient received this patient\'s reminder').toBe(false);
    // Nothing about this patient reached the administrator at all.
    expect(streams.admin.events.filter((e) => e.patient_id === patient.linked_patient_id)).toEqual([]);
  } finally {
    Object.values(streams).forEach((stream) => stream.stop());
  }
});
