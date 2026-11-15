/**
 * The paramedic's run, scene to hospital, and the hospital's receipt.
 *
 * # The story
 *
 * A crew starts a run for a patient they identified, records what they found
 * and what they measured, leaves the scene for a hospital (the pre-alert), and
 * hands over. A nurse at that hospital sees the ambulance on the incoming
 * board, receives the patient with one tap, and then reads the crew's whole
 * timeline on the patient's chart. The patient can read it too (rule 10).
 *
 * # Why this role in particular
 *
 * The paramedic is the one role whose work is all done for somebody else to
 * read. A run that saves but never reaches the receiving board, or reaches the
 * wrong hospital's board, is a patient arriving unannounced.
 *
 * Every payload is the one `AmbulanceRunPage` / `EntrySheet` / `LeaveSceneSheet`
 * builds: only what was entered.
 */

import { http, type Journal, type Session, type Manifest } from '../lib/journey';

type Run = { id?: string; status?: string; destination_facility_id?: string | null };

export async function paramedicJourney(
  j: Journal,
  medic: Session,
  nurse: Session,
  patientSession: Session | undefined,
  m: Manifest
): Promise<void> {
  j.journey('Paramedic — scene to hospital, one handover');
  const patient = m.patient.linked_patient_id;

  // --- Start the run -------------------------------------------------------
  const started = await http('POST', '/ems/runs', {
    token: medic.token,
    body: { patient_id: patient, chief_complaint: 'Journey harness: fall from height' },
  });
  if (!j.status('the crew starts a run for the scanned patient', started.status, [200, 201], started.json)) return;
  const run = (started.json.run ?? started.json) as Run;
  const runId = String(run.id ?? '');

  // --- On scene: what they found and measured --------------------------------
  const onScene = await http('POST', `/ems/runs/${encodeURIComponent(runId)}/events`, {
    token: medic.token,
    body: { kind: 'on_scene' },
  });
  j.status('arrival on scene is recorded', onScene.status, [200, 201], onScene.json);
  const vitals = await http('POST', `/ems/runs/${encodeURIComponent(runId)}/events`, {
    token: medic.token,
    body: { kind: 'vitals', payload: { systolic_bp: 92, diastolic_bp: 58, heart_rate: 118, spo2: 94 } },
  });
  j.status('the crew records vitals (only what was measured)', vitals.status, [200, 201], vitals.json);

  // --- Leave for the nurse's hospital ---------------------------------------
  const board = await http('GET', '/ems/incoming', { token: nurse.token });
  const nurseFacility = typeof board.json.facility_id === 'string' ? board.json.facility_id : null;
  if (!nurseFacility) {
    j.skip('the run reaches the receiving hospital', "the nurse fixture has no facility, so no board can receive the run — assign one and re-seed");
    return;
  }
  const left = await http('POST', `/ems/runs/${encodeURIComponent(runId)}/events`, {
    token: medic.token,
    body: { kind: 'left_scene', destination_facility_id: nurseFacility, eta_minutes: 15 },
  });
  j.status('leaving the scene pre-alerts the hospital', left.status, [200, 201], left.json);

  const incoming = await http('GET', '/ems/incoming', { token: nurse.token });
  const runs = (Array.isArray(incoming.json.runs) ? incoming.json.runs : []) as Run[];
  j.record('the ambulance appears on that hospital’s incoming board', runs.some((r) => r.id === runId),
    `run ${runId} not among ${runs.length} incoming`);

  // --- Handover and receipt --------------------------------------------------
  const handed = await http('POST', `/ems/runs/${encodeURIComponent(runId)}/events`, {
    token: medic.token,
    body: { kind: 'handed_over' },
  });
  j.status('the crew hands over with one button', handed.status, [200, 201], handed.json);
  const received = await http('POST', `/ems/runs/${encodeURIComponent(runId)}/receive`, { token: nurse.token, body: {} });
  j.status('the nurse receives the patient with one tap', received.status, [200], received.json);
  const again = await http('POST', `/ems/runs/${encodeURIComponent(runId)}/events`, {
    token: medic.token,
    body: { kind: 'note', payload: { text: 'late note' } },
  });
  j.status('nothing more is written to a received run', again.status, [409], again.json);

  // --- Read back by someone else ---------------------------------------------
  const chart = await http('GET', `/clinical/patient/${encodeURIComponent(patient)}/ems-runs`, { token: nurse.token });
  const onChart = ((chart.json.runs ?? []) as Run[]).find((r) => r.id === runId) as (Run & { events?: unknown[] }) | undefined;
  j.record('the receiving nurse reads the crew’s timeline on the chart', Boolean(onChart && (onChart.events?.length ?? 0) >= 4),
    `status ${chart.status}, events ${onChart?.events?.length ?? 0}`);

  if (patientSession) {
    const own = await http('GET', `/clinical/patient/${encodeURIComponent(patient)}/ems-runs`, { token: patientSession.token });
    j.record('the patient reads their own ambulance run', ((own.json.runs ?? []) as Run[]).some((r) => r.id === runId),
      `status ${own.status}`);
  }
}
