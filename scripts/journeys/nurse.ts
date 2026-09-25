/**
 * The nurse's shift, start to finish.
 *
 * # The story
 *
 * A patient arrives. The nurse triages them, records a set of observations,
 * gives a scheduled medication, charts the fluids, assesses a wound and an IV
 * site, scores the fall risk, writes the care plan and a progress note, and
 * hands the ward over to the next shift. Then the incoming nurse reads the
 * handoff and finds the patient in it.
 *
 * That last sentence is the reason this file exists. Each of those screens has
 * a unit test that renders it against a mocked `fetch`; none of them proves
 * that the person who inherits the ward can see what the previous nurse
 * recorded. The dominant defect in this codebase is a successful write that no
 * reader can see, and a mocked `fetch` reproduces it perfectly.
 *
 * # Payloads are the page's, not this file's
 *
 * Every body below is the object the corresponding page actually builds in its
 * submit handler, field for field. Sending a tidier payload than the product
 * sends would test a request nobody makes — which is how four pages came to
 * return `201` while discarding everything clinical.
 */

import {
  http,
  type Journal,
  type Session,
  type Manifest,
  discrepancies,
  findBy,
  fieldAt,
  rowsOf,
} from '../lib/journey';

const iso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const epoch = () => Math.floor(Date.now() / 1000);

export async function nurseJourney(
  j: Journal,
  nurse: Session,
  incoming: Session,
  m: Manifest
): Promise<void> {
  j.journey('Nurse — one shift, handed over to the next');
  const patient = m.patient.linked_patient_id;
  const stamp = Date.now();

  // --- Triage -------------------------------------------------------------
  // TriagePage.tsx: POST /api/clinical/triage
  const chiefComplaint = `Chest tightness on exertion (journey ${stamp})`;
  const TRIAGE_NOTE = `Walked in unaccompanied; states symptoms began 40 minutes ago (journey ${stamp})`;
  // TriagePage's `vitalSigns` state, key for key. `temperature_celsius` and
  // `gcs_score` are the page's names; a tidier `temperature` would deserialize
  // to None and this file would be testing a request nobody makes.
  const vitalSigns = {
    heart_rate: 104,
    respiratory_rate: 22,
    bp_systolic: 148,
    bp_diastolic: 92,
    temperature_celsius: 37.8,
    oxygen_saturation: 94,
    pain_scale: 6,
    gcs_score: 15,
    blood_glucose: 110,
    weight_kg: 68.5,
  };
  const triage = await http('POST', '/clinical/triage', {
    token: nurse.token,
    body: {
      patient_id: patient,
      esi_level: 2,
      chief_complaint: chiefComplaint,
      vital_signs: vitalSigns,
      pain_scale: 6,
      notes: TRIAGE_NOTE,
    },
  });
  const triaged = j.status('triage assessment is accepted', triage.status, [200, 201], triage.json);

  if (triaged) {
    const queue = await http('GET', '/clinical/triage/queue', { token: nurse.token });
    const rows = rowsOf(queue.json, 'queue', 'assessments');
    const mine = findBy(rows, 'chief_complaint', chiefComplaint);
    const bad = discrepancies(mine, { patient_id: patient });
    j.record(
      'the triaged patient appears in the triage queue',
      bad.length === 0,
      bad.join('; ') +
        (mine ? '' : ` — queue held ${Array.isArray(rows) ? rows.length : 'a non-array'} row(s)`)
    );
    // Every observation the triage form collects, read back from the one screen
    // that displays the queue. Four of these are stored on the entity and were
    // being blanked on the way out, which is invisible to any test that stops
    // at the write.
    const vitalsBad = discrepancies(mine, {
      'vital_signs.heart_rate': 104,
      'vital_signs.respiratory_rate': 22,
      'vital_signs.bp_systolic': 148,
      'vital_signs.bp_diastolic': 92,
      'vital_signs.temperature_celsius': 37.8,
      'vital_signs.oxygen_saturation': 94,
      'vital_signs.pain_scale': 6,
      'vital_signs.gcs_score': 15,
      'vital_signs.blood_glucose': 110,
      'vital_signs.weight_kg': 68.5,
      pain_scale: 6,
    });
    j.record(
      'every observation the triage form collected survives to the queue',
      vitalsBad.length === 0,
      vitalsBad.join('; ')
    );
    j.record(
      'the triage note the nurse typed is readable',
      fieldAt(mine, 'notes') === TRIAGE_NOTE,
      `sent notes ${JSON.stringify(TRIAGE_NOTE)}, read back ${JSON.stringify(fieldAt(mine, 'notes'))}`
    );
  } else {
    j.skip('the triaged patient appears in the triage queue with their acuity', 'triage was refused');
  }

  // --- Vital signs --------------------------------------------------------
  // VitalSignsPage.tsx: POST /api/clinical/vitals, read back through the
  // flowsheet the same page renders.
  const vitalsBody = {
    patient_id: patient,
    heart_rate: 104,
    respiratory_rate: 22,
    systolic_bp: 148,
    diastolic_bp: 92,
    temperature_celsius: 37.8,
    oxygen_saturation: 94,
    pain_scale: 6,
    gcs_total: 15,
    blood_glucose: 110,
  };
  const vitals = await http('POST', '/clinical/vitals', { token: nurse.token, body: vitalsBody });
  const recorded = j.status('a set of observations is accepted', vitals.status, [200, 201], vitals.json);

  if (recorded) {
    const fs = await http('GET', `/clinical/vitals/flowsheet/${patient}`, { token: nurse.token });
    const cols = rowsOf(fs.json, 'readings', 'columns', 'entries', 'items');
    // The newest reading by its own timestamp, not by position. The flowsheet
    // is newest-first (VitalSignsPage reads readings[0] as the latest); this
    // took the LAST element, which was right only while each run began on a
    // patient with no earlier readings.
    const when = (r: any) => Number(r?.timestamp ?? Date.parse(r?.recorded_at ?? '') ?? 0);
    const latest = Array.isArray(cols) && cols.length
      ? (cols.reduce((a: any, b: any) => (when(b) > when(a) ? b : a)) as any)
      : undefined;
    // The flowsheet is what a clinician actually reads; a value that survives
    // the write but not the flowsheet is invisible in practice.
    const bad = discrepancies(latest, {
      heart_rate: 104,
      systolic_bp: 148,
      diastolic_bp: 92,
      oxygen_saturation: 94,
    });
    j.record(
      'the observations are readable on the flowsheet',
      bad.length === 0,
      bad.join('; ') + ` — flowsheet keys: ${Object.keys(fs.json).join(',')}`
    );
  } else {
    j.skip('the observations are readable on the flowsheet', 'vitals were refused');
  }

  // --- Medication administration -----------------------------------------
  // MARPage.tsx: POST /api/nursing/mar/administer. The dose is deliberately
  // *held*, not given: a held dose and a given dose must never read alike, and
  // the reason a nurse types is the clinically meaningful part of the record.
  const holdReason = `Systolic 148 — held pending review (journey ${stamp})`;
  const marPost = await http('POST', '/nursing/mar/administer', {
    token: nurse.token,
    body: {
      patient_id: patient,
      medication_id: `MED-${stamp}`,
      medication_name: 'Metoprolol tartrate',
      dose: '25 mg',
      route: 'PO',
      status: 'held',
      administered_time: iso(),
      administered_by: nurse.userId,
      hold_reason: holdReason,
      notes: 'Journey harness — synthetic',
      prn_reason: null,
      date: today(),
    },
  });
  const gave = j.status('a held dose is accepted on the MAR', marPost.status, [200, 201], marPost.json);

  if (gave) {
    const mar = await http('GET', '/nursing/mar', { token: nurse.token });
    const records = rowsOf(mar.json, 'records', 'items');
    const forPatient = Array.isArray(records)
      ? records.filter((r) => fieldAt(r, 'patient_id') === patient)
      : [];
    // `data.administrations`, not `administrations`: the MAR row is a typed
    // record carrying a JSON blob, and the doses live inside the blob.
    const admins = forPatient.flatMap(
      (r) => ((fieldAt(r, 'data.administrations') ?? fieldAt(r, 'administrations')) as any[]) ?? []
    );
    const mine = admins.find((a) => a?.medication_id === `MED-${stamp}`);
    const bad = discrepancies(mine, { status: 'held', dose: '25 mg', route: 'PO' });
    j.record(
      'the MAR shows the dose as held, not given',
      bad.length === 0,
      bad.join('; ') + ` — ${admins.length} administration(s) on ${forPatient.length} record(s)`
    );
    j.record(
      'the reason the dose was held survives the write',
      mine !== undefined &&
        JSON.stringify(mine ?? null).includes(holdReason),
      `no field of the stored administration carries the hold reason. Stored: ${JSON.stringify(mine ?? {}).slice(0, 400)}`
    );
  } else {
    j.skip('the MAR shows the dose as held, not given', 'the administration was refused');
    j.skip('the reason the dose was held survives the write', 'the administration was refused');
  }

  // --- Intake / output ----------------------------------------------------
  // NursingPage.tsx: POST /api/nursing/intake-output/record
  const io = await http('POST', '/nursing/intake-output/record', {
    token: nurse.token,
    body: {
      patient_id: patient,
      entry_type: 'intake',
      fluid_type: 'Oral',
      amount_ml: 240,
      notes: `Journey harness ${stamp}`,
      time: iso(),
    },
  });
  const charted = j.status('a fluid entry is accepted', io.status, [200, 201], io.json);

  if (charted) {
    const list = await http('GET', '/nursing/intake-output', { token: nurse.token });
    const rows = rowsOf(list.json, 'records', 'items');
    const day = new Date().toISOString().slice(0, 10);
    const record = Array.isArray(rows)
      ? rows.find(
          (r) => fieldAt(r, 'patient_id') === patient && String(fieldAt(r, 'record_date') ?? '').startsWith(day)
        )
      : undefined;
    j.record(
      "today's intake/output record exists for this patient",
      record !== undefined,
      `${rows?.length ?? 0} record(s) in the ward list, none for ${patient} on ${day}`
    );
    // 240 mL of oral intake belongs in `oral_intake`, not in the "other"
    // bucket. The bucket matters: the I/O screen shows the breakdown, and a
    // category the server could not read is one it also could not direct — the
    // same fallthrough sends an OUTPUT to `other_intake` and moves the net
    // balance the wrong way.
    j.record(
      'oral intake is counted as oral intake, not as "other"',
      Number(fieldAt(record, 'oral_intake')) >= 240,
      `oral_intake=${JSON.stringify(fieldAt(record, 'oral_intake'))}, ` +
        `other_intake=${JSON.stringify(fieldAt(record, 'other_intake'))}`
    );

    // The direction is the safety property. Chart urine and require that it
    // moves the balance DOWN.
    const before = Number(fieldAt(record, 'net_balance') ?? 0);
    const out = await http('POST', '/nursing/intake-output/record', {
      token: nurse.token,
      body: {
        patient_id: patient,
        entry_type: 'output',
        fluid_type: 'Urine',
        amount_ml: 800,
        notes: `Journey harness output ${stamp}`,
        time: iso(),
      },
    });
    if (j.status('an output entry is accepted', out.status, [200, 201], out.json)) {
      const after = await http('GET', '/nursing/intake-output', { token: nurse.token });
      const arows = rowsOf(after.json, 'records', 'items');
      const arec = Array.isArray(arows)
        ? arows.find(
            (r) => fieldAt(r, 'patient_id') === patient && String(fieldAt(r, 'record_date') ?? '').startsWith(day)
          )
        : undefined;
      const now = Number(fieldAt(arec, 'net_balance') ?? 0);
      j.record(
        '800 mL of urine moves the fluid balance down, not up',
        now === before - 800,
        `net balance went ${before} -> ${now}. An output counted as intake is a 1600 mL error ` +
          `in the wrong direction on the number a clinician titrates fluids against. ` +
          `urine_output=${JSON.stringify(fieldAt(arec, 'urine_output'))}, ` +
          `other_intake=${JSON.stringify(fieldAt(arec, 'other_intake'))}`
      );
    } else {
      j.skip('800 mL of urine moves the fluid balance down, not up', 'the output entry was refused');
    }
  } else {
    j.skip("today's intake/output record exists for this patient", 'the fluid entry was refused');
    j.skip('oral intake is counted as oral intake, not as "other"', 'the fluid entry was refused');
    j.skip('an output entry is accepted', 'the fluid entry was refused');
    j.skip('800 mL of urine moves the fluid balance down, not up', 'the fluid entry was refused');
  }

  // --- Wound --------------------------------------------------------------
  // WoundCarePage.tsx: POST /api/emergency/wound
  const woundNote = `Journey harness wound ${stamp}`;
  const wound = await http('POST', '/emergency/wound', {
    token: nurse.token,
    body: {
      patient_id: patient,
      wound_type: 'pressure_ulcer',
      location: 'Sacrum',
      length_cm: 3.5,
      width_cm: 2.1,
      depth_cm: 0.4,
      exudate: 'moderate',
      pain_level: 4,
      tissue_types: ['granulation', 'slough'],
      notes: woundNote,
    },
  });
  const woundOk = j.status('a wound assessment is accepted', wound.status, [200, 201], wound.json);

  if (woundOk) {
    const list = await http('GET', '/emergency/wound/list', { token: nurse.token });
    const rows = rowsOf(list.json, 'wounds', 'items');
    const mine = findBy(rows, 'notes', woundNote);
    // The list returns storage columns, and WoundCarePage maps them —
    // `wound_location` -> location, `drainage_amount` -> exudate. Asserting the
    // form's names here would fail against a page that renders correctly.
    const bad = discrepancies(mine, {
      wound_location: 'Sacrum',
      length_cm: 3.5,
      width_cm: 2.1,
      depth_cm: 0.4,
      drainage_amount: 'moderate',
      pain_level: 4,
    });
    j.record('the wound measurements read back unchanged', bad.length === 0, bad.join('; '));
  } else {
    j.skip('the wound measurements read back unchanged', 'the wound assessment was refused');
  }

  // --- IV site ------------------------------------------------------------
  // IVSitePage.tsx: POST /api/emergency/iv-site
  const ivRecordId = `IVSITE-${stamp}`;
  // IVSitePage's `IVSite` objects, camelCase, each carrying its assessments.
  // `phlebitisScore` is deliberately absent: the page posts one and the server
  // ignores it, recomputing the VIP score from `conditions`, because a score
  // that decides whether a cannula stays in is not a number a client asserts.
  const ivSites = [
    {
      id: `SITE-${stamp}`,
      patientId: patient,
      location: 'forearm',
      locationDetail: 'Left forearm, mid',
      catheterType: 'peripheral',
      gauge: '20G',
      insertedBy: nurse.userId,
      insertedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      isActive: true,
      assessments: [
        {
          id: `IVA-${stamp}`,
          assessedAt: new Date().toISOString(),
          assessedBy: nurse.userId,
          // The form's fixed vocabulary: `clean-dry-intact`, `tenderness`,
          // `redness`, `swelling`, `warmth`, `induration`, `drainage`. Redness
          // plus tenderness is VIP stage 2 — early phlebitis, resite the cannula.
          conditions: ['redness', 'tenderness'],
          dressingType: 'transparent',
          dressingIntact: true,
          flushPatent: true,
          bloodReturn: true,
          infusing: '0.9% sodium chloride',
          infusionRate: '80 mL/hr',
          notes: `Journey harness ${stamp}`,
        },
      ],
    },
  ];
  const iv = await http('POST', '/emergency/iv-site', {
    token: nurse.token,
    body: {
      record_id: ivRecordId,
      patient_id: patient,
      sites: ivSites,
      documented_by: nurse.userId,
      documented_at: epoch(),
    },
  });
  const ivOk = j.status('an IV site assessment is accepted', iv.status, [200, 201], iv.json);

  if (ivOk) {
    const read = await http('GET', `/clinical/iv-sites/${patient}`, { token: nurse.token });
    const rows = rowsOf(read.json, 'assessments', 'items');
    const mine = findBy(rows, 'record_id', ivRecordId) ?? (Array.isArray(rows) ? rows[0] : rows);
    const stored: any[] = Array.isArray(rows) ? rows : ((rows as any)?.sites ?? []);
    const site = stored.find((x: any) => JSON.stringify(x ?? null).includes(`SITE-${stamp}`));
    j.record(
      'the cannula is on the record with its gauge and site',
      site !== undefined && JSON.stringify(site ?? null).includes('20G'),
      `stored: ${JSON.stringify(stored).slice(0, 400)}`
    );
    // Erythema plus pain is VIP stage 2 — early phlebitis, and the point at
    // which the cannula is meant to be resited. The score has to come from the
    // server (CLAUDE.md rule 8) and it has to be *this* score.
    // The column is `phlebitis_grade`; the page's own field is
    // `phlebitisScore` and the server ignores it.
    const vip =
      fieldAt(site, 'phlebitis_grade') ??
      fieldAt(site, 'phlebitis_score') ??
      fieldAt(site, 'vip_score');
    j.record(
      'the server scored the cannula as VIP stage 2, not the browser',
      Number(vip) === 2,
      `expected a server-computed VIP score of 2 for erythema + pain; read back ${JSON.stringify(vip)}`
    );
  } else {
    j.skip('the IV site and its VIP score read back', 'the IV assessment was refused');
  }

  // --- Fall risk ----------------------------------------------------------
  // FallRiskPage.tsx: POST /api/emergency/fall-risk. Morse is a scored
  // instrument, so the score is the server's to compute (CLAUDE.md rule 8) and
  // the page must not be the one that decided it.
  const fall = await http('POST', '/emergency/fall-risk', {
    token: nurse.token,
    body: {
      patient_id: patient,
      assessment_tool: 'morse',
      // MorseScale is a point value per item, not a yes/no:
      // `0 | 25`, `0 | 15`, `0 | 15 | 30`, `0 | 20`, `0 | 10 | 20`, `0 | 15`.
      history_of_falling: 25,
      secondary_diagnosis: 15,
      ambulatory_aid: 15,
      iv_therapy: 20,
      gait_status: 10,
      mental_status: 15,
      interventions: ['bed_alarm', 'non_slip_socks'],
      additional_factors: [],
      environmental_hazards: [],
      medications: ['sedatives'],
      recent_fall: true,
      mobility: 'assisted',
      notes: `Journey harness ${stamp}`,
      assessed_at: iso(),
    },
  });
  const fallOk = j.status('a Morse fall-risk assessment is accepted', fall.status, [200, 201], fall.json);

  if (fallOk) {
    const read = await http('GET', `/emergency/fall-risk/patient/${patient}`, { token: nurse.token });
    const rows = rowsOf(read.json, 'assessments', 'items');
    const mine = findBy(rows, 'notes', `Journey harness ${stamp}`) ?? (Array.isArray(rows) ? rows[0] : rows);
    const score = fieldAt(mine, 'total_score') ?? fieldAt(mine, 'score') ?? fieldAt(mine, 'morse_score');
    // Morse for this profile: history 25 + secondary dx 15 + crutches 15 +
    // IV 20 + weak gait 10 + overestimates 15 = 100, which is High risk.
    j.record(
      'the server scored the Morse scale rather than trusting the form',
      Number(score) === 100,
      `expected a server-computed total of 100 (high risk); read back ${JSON.stringify(score)}. ` +
        `Stored: ${JSON.stringify(mine ?? {}).slice(0, 300)}`
    );
  } else {
    j.skip('the server scored the Morse scale rather than trusting the form', 'the assessment was refused');
  }

  // --- Care plan ----------------------------------------------------------
  // CarePlanPage.tsx: POST /api/emergency/care-plan
  const planId = `CP-${stamp}`;
  const plan = await http('POST', '/emergency/care-plan', {
    token: nurse.token,
    body: {
      care_plan_id: planId,
      patient_id: patient,
      // CarePlanPage's `NursingDiagnosis[]`, `Goal[]` and `Intervention[]`,
      // camelCase and cross-referenced by id the way the page builds them.
      diagnoses: [
        {
          id: `ND-${stamp}`,
          diagnosis: 'Impaired skin integrity',
          relatedTo: 'immobility',
          evidencedBy: 'stage 2 sacral pressure ulcer',
          priority: 'high',
          dateIdentified: today(),
        },
      ],
      goals: [
        {
          id: `GOAL-${stamp}`,
          diagnosisId: `ND-${stamp}`,
          description: 'Sacral ulcer shows granulation within 7 days',
          targetDate: today(),
          status: 'in-progress',
          measurableOutcome: 'Over 50% granulation tissue on day 7',
          progressNotes: [],
        },
      ],
      interventions: [
        {
          id: `IVN-${stamp}`,
          goalId: `GOAL-${stamp}`,
          description: 'Two-hourly repositioning',
          frequency: 'q2h',
          status: 'active',
          responsibleParty: 'nursing',
        },
      ],
      created_by: nurse.userId,
      created_at: epoch(),
      updated_at: epoch(),
    },
  });
  const planOk = j.status('a nursing care plan is accepted', plan.status, [200, 201], plan.json);

  if (planOk) {
    const list = await http('GET', '/nursing/care-plans', { token: nurse.token });
    const rows = rowsOf(list.json, 'plans', 'items');
    const mine =
      findBy(rows, 'care_plan_id', planId) ??
      findBy(rows, 'id', planId) ??
      (Array.isArray(rows)
        ? (rows as any[]).find((r) => JSON.stringify(r ?? null).includes(`ND-${stamp}`))
        : undefined);
    j.record(
      'the care plan is on the ward list with its diagnoses and goals',
      mine !== undefined &&
        JSON.stringify(mine ?? null).includes('Impaired skin integrity') &&
        JSON.stringify(mine ?? null).includes('granulation') &&
        JSON.stringify(mine ?? null).includes('Two-hourly repositioning'),
      `a care plan without its goals and interventions is a diagnosis list, not a plan. ` +
        `Stored: ${JSON.stringify(mine ?? {}).slice(0, 500)}`
    );
  } else {
    j.skip('the care plan is on the ward list with its diagnoses and goals', 'the care plan was refused');
  }

  // --- Progress note ------------------------------------------------------
  // ProgressNotePage.tsx: POST /api/clinical/progress-note
  const noteId = `PN-${stamp}`;
  const subjective = `Patient reports the chest tightness has eased (journey ${stamp})`;
  const note = await http('POST', '/clinical/progress-note', {
    token: nurse.token,
    body: {
      note_id: noteId,
      patient_id: patient,
      note_date: today(),
      hospital_day: 1,
      post_op_day: null,
      subjective,
      overnight_events: '',
      vital_signs: 'HR 104, BP 148/92, SpO2 94%',
      io_summary: null,
      exam: 'Alert, oriented, chest clear',
      labs_studies: '',
      assessment: [
        { problem_number: 1, problem: 'Hypertensive urgency', status: 'stable', plan: 'Recheck BP q4h' },
      ],
      plan: ['Recheck BP q4h'],
      disposition: null,
      code_status: 'Full code',
      discussed_with: null,
      author: nurse.userId,
      note_time: epoch(),
      cosigned_by: null,
    },
  });
  const noteOk = j.status('a progress note is accepted', note.status, [200, 201], note.json);

  if (noteOk) {
    const read = await http('GET', `/clinical/progress-note/${noteId}`, { token: nurse.token });
    const bad = discrepancies(read.json.note ?? read.json, { subjective, patient_id: patient });
    j.record('the progress note reads back with its subjective intact', bad.length === 0, bad.join('; '));
  } else {
    j.skip('the progress note reads back with its subjective intact', 'the note was refused');
  }

  // --- Incident report ----------------------------------------------------
  // IncidentReportPage.tsx: POST /api/emergency/incident. This page sends
  // camelCase while the rest of the portal sends snake_case, which is exactly
  // the kind of drift a mocked `fetch` cannot see.
  const incidentId = `INC-${stamp}`;
  const incident = await http('POST', '/emergency/incident', {
    token: nurse.token,
    body: {
      // IncidentReportPage spreads its `formData` and adds five fields. Its
      // discriminator is `type`, not `incident_type`, and `staffInvolved` /
      // `witnesses` are comma-split into arrays before they are sent.
      id: incidentId,
      type: 'medication-error',
      severity: 'moderate',
      dateTime: iso(),
      location: 'Ward 3, bed 12',
      department: 'med-surg',
      description: `Journey harness incident ${stamp}`,
      patientInvolved: true,
      patientId: patient,
      immediateActions: 'Dose withheld, prescriber informed, observations increased',
      reportedBy: nurse.userId,
      reportedAt: iso(),
      status: 'open',
      staffInvolved: ['Nurse Browser Test'],
      witnesses: ['Nurse Browser Test Two'],
      followUpActions: [],
    },
  });
  const incOk = j.status('an incident report is accepted', incident.status, [200, 201], incident.json);

  if (incOk) {
    const list = await http('GET', '/platform/list/incidents', { token: nurse.token });
    const rows = rowsOf(list.json, 'incidents', 'items');
    const carries = JSON.stringify(rows ?? null).includes(`Journey harness incident ${stamp}`);
    j.record(
      'the incident is on the register with its description',
      carries,
      `register held ${Array.isArray(rows) ? rows.length : 'a non-array'} row(s), none carrying this incident`
    );
  } else {
    j.skip('the incident is on the register with its description', 'the incident report was refused');
  }

  // --- Shift handoff, and the next nurse reading it -----------------------
  // ShiftHandoffPage.tsx: POST /api/emergency/handoff.
  //
  // This is the step the whole journey exists for. Every write above is only
  // clinically real if the person taking over the ward can see it.
  const handoffId = `HO-${stamp}`;
  const situation = `Hypertensive urgency, metoprolol held (journey ${stamp})`;
  const handoff = await http('POST', '/emergency/handoff', {
    token: nurse.token,
    body: {
      handoff_id: handoffId,
      shift_type: 'day_to_night',
      handoff_date: today(),
      handoff_time: '19:00',
      outgoing_nurse: nurse.userId,
      incoming_nurse: incoming.userId,
      unit: 'Ward 3',
      // ShiftHandoffPage's `PatientHandoff[]`: camelCase, and the clinical
      // content lives inside a nested `sbar` rather than at the top level.
      patients: [
        {
          patientId: patient,
          patientName: 'Thandiwe Browser-Test',
          room: '12',
          admitDate: today(),
          diagnosis: 'Hypertensive urgency',
          codeStatus: 'Full Code',
          priority: 'urgent',
          sbar: {
            situation,
            background: 'Sacral pressure ulcer, IV in situ left forearm',
            assessment: 'ESI 2 at triage, observations trending down',
            recommendation: 'Recheck BP q4h; reposition q2h',
          },
          ivAccess: '20G left forearm',
          diet: 'Low salt',
          activity: 'Assisted mobilisation',
          pendingLabs: 'U and E in the morning',
          pendingTests: 'ECG',
          medications: {
            scheduled: 'Metoprolol 25 mg PO BD',
            prn: 'Paracetamol 1 g PO QDS',
            drips: '',
          },
          safetyRisks: ['falls'],
          pendingOrders: '',
          familyUpdates: 'Daughter updated at 18:40',
          additionalNotes: '',
        },
      ],
      status: 'pending',
      created_by: nurse.userId,
      created_at: epoch(),
    },
  });
  const handoffOk = j.status('the shift handoff is accepted', handoff.status, [200, 201], handoff.json);

  if (handoffOk) {
    // The id the API hands back must be a handle to something. The handler
    // fans the handoff out to one row per patient, keyed `{batch}-{patient_id}`,
    // and then returns the bare batch — so following the id you were given is a
    // 404, and any client that stores it has stored nothing.
    const returnedId = String(handoff.json.id ?? '');
    const read = await http('GET', `/emergency/handoff/${returnedId}`, { token: incoming.token });
    j.status(
      'the id the API returned can be fetched',
      read.status,
      200,
      { returnedId, ...read.json }
    );

    // What the incoming nurse actually opens: their own handoff list.
    const byProvider = await http('GET', `/clinical/shift-handoff/${incoming.userId}`, {
      token: incoming.token,
    });
    const rows = rowsOf(byProvider.json, 'handoffs', 'items');
    const list: any[] = Array.isArray(rows) ? rows : [];
    const mine = list.find((r) => String(r?.situation ?? '').includes(String(stamp)));
    j.record(
      "the handoff reaches the incoming nurse's own list",
      mine !== undefined,
      `their list held ${list.length} handoff(s), none carrying this shift's situation. ` +
        `This is the screen ShiftHandoffPage renders for the signed-in nurse.`
    );
    const bad = discrepancies(mine, {
      situation,
      background: 'Sacral pressure ulcer, IV in situ left forearm',
      assessment: 'ESI 2 at triage, observations trending down',
      recommendation: 'Recheck BP q4h; reposition q2h',
      patient_id: patient,
    });
    j.record(
      'the whole SBAR survives the handoff',
      bad.length === 0,
      bad.join('; ') +
        ' — an SBAR missing a limb is the clinical content of a handoff, not a formatting detail'
    );
  } else {
    j.skip('the id the API returned can be fetched', 'the handoff was refused');
    j.skip("the handoff reaches the incoming nurse's own list", 'the handoff was refused');
    j.skip('the whole SBAR survives the handoff', 'the handoff was refused');
  }
}
