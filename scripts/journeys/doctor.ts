/**
 * The doctor's day, start to finish.
 *
 * # The story
 *
 * A patient is registered. The doctor takes a history and examination, writes a
 * SOAP note, raises a lab order, asks a colleague for a consult and gets an
 * answer back, prescribes, books a follow-up appointment, and discharges with a
 * summary somebody else has to approve.
 *
 * Every step ends the same way: somebody *else* opens the record and finds what
 * the doctor wrote. A note the author can read back through the same session
 * that wrote it proves nothing about a shared record — the process may simply
 * be handing back its own memory.
 *
 * # Why the doctor journey is the long one
 *
 * 37 screens are in `DOCTOR_NAV` and 3 had ever had a Save driven against a
 * live server. The doctor is also the role whose output every other role
 * consumes: the nurse administers what the doctor prescribed, the pharmacist
 * dispenses it, the lab runs what the doctor ordered.
 */

import { http, type Journal, type Session, type Manifest, discrepancies, findBy, fieldAt,
  rowsOf,
} from '../lib/journey';

const iso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export async function doctorJourney(
  j: Journal,
  doctor: Session,
  colleague: Session,
  m: Manifest
): Promise<void> {
  j.journey('Doctor — admission to discharge');
  const stamp = Date.now();

  // --- Registration --------------------------------------------------------
  // RegisterPatientPage.tsx: POST /api/register
  const fullName = `Journey Harness ${stamp}`;
  const reg = await http('POST', '/register', {
    token: doctor.token,
    body: {
      full_name: fullName,
      wallet_address: '',
      date_of_birth: '1984-04-12',
      national_id: `JH${stamp}`,
      gender: 'female',
      phone: '',
      blood_type: 'O+',
      allergies: ['penicillin'],
      current_medications: ['metformin 500 mg'],
      chronic_conditions: ['type 2 diabetes'],
      emergency_contact_name: 'Journey Contact',
      emergency_contact_phone: '+27-11-555-0100',
      emergency_contact_relationship: 'sister',
      organ_donor: true,
      dnr_status: false,
    },
  });
  const registered = j.status('a patient is registered', reg.status, [200, 201], reg.json);
  // Fall back to the seeded patient so the rest of the journey still runs and
  // still reports on the steps that follow — a broken first step must not
  // silently delete the other twenty.
  const patient = registered ? String(reg.json.patient_id) : m.patient.linked_patient_id;
  if (!registered) {
    j.skip('the registered patient is findable by the clinician who registered them', 'registration failed');
    j.skip('the allergy the clinician recorded is on the patient record', 'registration failed');
  } else {
    const roster = await http('GET', '/patients?limit=200', { token: doctor.token });
    const rows = rowsOf(roster.json, 'data', 'patients');
    const mine = findBy(rows, 'patient_id', patient);
    j.record(
      'the registered patient is findable by the clinician who registered them',
      mine !== undefined,
      `roster held ${Array.isArray(rows) ? rows.length : 'a non-array'} patient(s). ` +
        `A patient who registers and does not appear on the roster is a patient nobody can treat.`
    );
    // An allergy is the single most consequential field on the record, and the
    // one the emergency capsule is built from.
    j.record(
      'the allergy the clinician recorded is on the patient record',
      JSON.stringify(mine ?? {}).toLowerCase().includes('penicillin'),
      `stored: ${JSON.stringify(mine ?? {}).slice(0, 400)}`
    );
  }

  // --- History and physical -----------------------------------------------
  // HistoryAndPhysicalPage.tsx: createHistoryPhysical
  const hpId = `HP-${stamp}`;
  const hpi = `Two days of polyuria and thirst (journey ${stamp})`;
  const hp = await http('POST', '/clinical/hp', {
    token: doctor.token,
    body: {
      hp_id: hpId,
      patient_id: patient,
      patient_name: fullName,
      mrn: patient,
      dateOfExam: iso(),
      exam_type: 'admission',
      chief_complaint: 'Thirst and frequent urination',
      history_of_present_illness: hpi,
      past_medical_history: ['type 2 diabetes'],
      past_surgical_history: [],
      medications: ['metformin 500 mg'],
      allergies: ['penicillin'],
      social_history: 'Non-smoker, no alcohol',
      family_history: ['mother: type 2 diabetes'],
      vital_signs: { heart_rate: 92, bp_systolic: 138, bp_diastolic: 86, temperature_celsius: 36.9 },
      review_of_systems: 'Constitutional: fatigue. Endocrine: polydipsia, polyuria.',
      physical_exam: 'Alert, well perfused. Chest clear. Abdomen soft.',
      assessment: 'Poorly controlled type 2 diabetes',
      plan: 'Check HbA1c and U&E; titrate metformin',
      provider: doctor.userId,
      status: 'final',
    },
  });
  const hpOk = j.status('a history and physical is accepted', hp.status, [200, 201], hp.json);

  if (hpOk) {
    // Read as the COLLEAGUE. The record is shared or it is not a record.
    const list = await http('GET', '/clinical/hp', { token: colleague.token });
    const rows = rowsOf(list.json, 'records', 'items');
    const mine =
      findBy(rows, 'hp_id', hpId) ??
      (Array.isArray(rows)
        ? (rows as any[]).find((r) => JSON.stringify(r ?? null).includes(hpi))
        : undefined);
    j.record(
      'a colleague can open the history and physical',
      mine !== undefined,
      `the colleague's list held ${Array.isArray(rows) ? rows.length : 'a non-array'} record(s)`
    );
    j.record(
      'the history of present illness and the allergy list survive',
      JSON.stringify(rows ?? null).includes(hpi) && JSON.stringify(rows ?? null).includes('penicillin'),
      'an H&P whose HPI and allergies are gone is a form, not a history'
    );
  } else {
    j.skip('a colleague can open the history and physical', 'the H&P was refused');
    j.skip('the history of present illness and the allergy list survive', 'the H&P was refused');
  }

  // --- SOAP note -----------------------------------------------------------
  // SOAPNotePage.tsx: POST /api/clinical/soap with a nested S/O/A/P body.
  const chiefComplaint = `Follow-up of hyperglycaemia (journey ${stamp})`;
  const clinicalSummary = `HbA1c pending; symptoms consistent with hyperglycaemia (journey ${stamp})`;
  const soap = await http('POST', '/clinical/soap', {
    token: doctor.token,
    body: {
      patient_id: patient,
      encounter_type: 'office_visit',
      subjective: {
        chief_complaint: chiefComplaint,
        history_of_present_illness: hpi,
        symptoms: ['polyuria', 'polydipsia', 'fatigue'],
        symptom_duration: '2 days',
        review_of_systems: 'As above',
        modifying_factors: 'Worse after meals',
        previous_treatments: 'Metformin 500 mg BD',
      },
      objective: {
        vital_signs: null,
        general_appearance: 'Well, not dehydrated',
        physical_exam: [
          { system: 'Cardiovascular', findings: 'Normal heart sounds, no murmur', is_normal: true },
        ],
        lab_results: ['capillary glucose 14.2 mmol/L'],
        imaging_results: [],
        diagnostic_tests: [],
      },
      assessment: {
        primary_diagnosis: {
          description: 'Type 2 diabetes mellitus, poorly controlled',
          icd10_code: 'E11.65',
          status: 'active',
        },
        secondary_diagnoses: [],
        clinical_summary: clinicalSummary,
        severity: 'moderate',
      },
      plan: {
        treatment_plan: 'Increase metformin to 1 g BD; dietitian referral',
        medications: [
          {
            medication: 'Metformin',
            dosage: '1 g',
            route: 'PO',
            frequency: 'BD',
            duration: 'ongoing',
          },
        ],
        procedures: [],
        lab_orders: ['HbA1c', 'U&E'],
        imaging_orders: [],
        referrals: ['Dietetics'],
        patient_education: ['Hypoglycaemia awareness'],
        follow_up: 'Review in 4 weeks',
        return_precautions: ['Vomiting', 'Drowsiness'],
        activity_restrictions: 'None',
      },
    },
  });
  const soapOk = j.status('a SOAP note is accepted', soap.status, [200, 201], soap.json);

  if (soapOk) {
    const read = await http('GET', `/clinical/patient/${patient}/soap`, { token: colleague.token });
    const rows = rowsOf(read.json, 'notes', 'items');
    const mine = findBy(rows, 'subjective.chief_complaint', chiefComplaint) ??
      (Array.isArray(rows) ? (rows as any[]).find((r) => JSON.stringify(r ?? null).includes(chiefComplaint)) : undefined);
    j.record(
      "a colleague can read the note on the patient's chart",
      mine !== undefined,
      `the chart held ${Array.isArray(rows) ? rows.length : 'a non-array'} note(s)`
    );
    // The four letters of SOAP, each checked. A note that keeps the subjective
    // and drops the plan is the shape of defect this repository keeps producing.
    for (const [label, needle] of [
      ['subjective', chiefComplaint],
      ['objective', 'capillary glucose 14.2 mmol/L'],
      ['assessment', clinicalSummary],
      ['plan', 'Increase metformin to 1 g BD'],
    ] as [string, string][]) {
      j.record(
        `the ${label} survives the write`,
        JSON.stringify(mine ?? {}).includes(needle),
        `expected the stored note to carry ${JSON.stringify(needle)}`
      );
    }
    j.record(
      'the ICD-10 code on the primary diagnosis survives',
      JSON.stringify(mine ?? {}).includes('E11.65'),
      'the code is what billing, reporting and every downstream registry read'
    );
  } else {
    for (const name of [
      "a colleague can read the note on the patient's chart",
      'the subjective survives the write',
      'the objective survives the write',
      'the assessment survives the write',
      'the plan survives the write',
      'the ICD-10 code on the primary diagnosis survives',
    ]) {
      j.skip(name, 'the SOAP note was refused');
    }
  }

  // --- Physician order -----------------------------------------------------
  // OrdersPage.tsx: POST /api/clinical/order, then PUT .../status
  const orderId = `ORD-${stamp}`;
  const orderText = `HbA1c and U&E (journey ${stamp})`;
  const now = Date.now();
  const order = await http('POST', '/clinical/order', {
    token: doctor.token,
    body: {
      order_id: orderId,
      patient_id: patient,
      category: 'Laboratory',
      order_text: orderText,
      priority: 'Routine',
      start_time: now,
      end_time: null,
      frequency: null,
      instructions: 'Fasting sample',
      ordering_provider: doctor.wallet,
      order_time: now,
      verbal_order: false,
      read_back: null,
      cosign_required: false,
      cosigned_by: null,
      status: 'Pending',
      acknowledged_by: null,
      acknowledged_time: null,
    },
  });
  const orderOk = j.status('a physician order is raised', order.status, [200, 201], order.json);

  if (orderOk) {
    const list = await http('GET', '/clinical/orders', { token: colleague.token });
    const rows = rowsOf(list.json, 'orders', 'items');
    // The server generates the order id; `OrdersPage` advances the one it read
    // back off the list, so the journey does the same.
    const mine = Array.isArray(rows)
      ? (rows as any[]).find((o) => JSON.stringify(o ?? null).includes(orderText))
      : undefined;
    const serverOrderId = String(fieldAt(mine, 'order_id') ?? fieldAt(mine, 'id') ?? orderId);
    j.record(
      'the order is on the ward order list',
      mine !== undefined,
      `list held ${Array.isArray(rows) ? rows.length : 'a non-array'} order(s)`
    );
    j.record(
      'the order text and its instructions survive',
      JSON.stringify(rows ?? null).includes(orderText) && JSON.stringify(rows ?? null).includes('Fasting sample'),
      'an order whose text is gone cannot be actioned by the person who receives it'
    );

    const advance = await http('PUT', `/clinical/orders/${serverOrderId}/status`, {
      token: doctor.token,
      body: { status: 'Completed' },
    });
    const advanced = j.status('the order can be advanced to completed', advance.status, [200, 201], advance.json);
    if (advanced) {
      const after = await http('GET', '/clinical/orders', { token: colleague.token });
      const arows = rowsOf(after.json, 'orders', 'items');
      const amine = findBy(arows, 'order_id', serverOrderId) ?? findBy(arows, 'id', serverOrderId);
      j.record(
        'the new status is what the next reader sees',
        String(fieldAt(amine, 'status') ?? '').toLowerCase() === 'completed',
        `status read back as ${JSON.stringify(fieldAt(amine, 'status'))}. ` +
          `A status change that only the caller can see is how two clinicians act on one order twice.`
      );
    } else {
      j.skip('the new status is what the next reader sees', 'the status change was refused');
    }
  } else {
    j.skip('the order is on the ward order list', 'the order was refused');
    j.skip('the order text and its instructions survive', 'the order was refused');
    j.skip('the order can be advanced to completed', 'the order was refused');
    j.skip('the new status is what the next reader sees', 'the order was refused');
  }

  // --- Consult: asked, and answered ---------------------------------------
  // ConsultPage.tsx: createConsult, then PUT /consult/{id}/response.
  // The answer is the half that matters and the half that was silently dropped
  // for seventeen repositories, so it is asserted from the ASKER's session.
  const consultId = `CONS-${stamp}`;
  const question = `Is basal insulin indicated now? (journey ${stamp})`;
  const consult = await http('POST', '/clinical/consult', {
    token: doctor.token,
    body: {
      consultId,
      patientId: patient,
      patientName: fullName,
      specialty: 'Endocrinology',
      urgency: 'routine',
      status: 'requested',
      reason: 'Poorly controlled type 2 diabetes',
      clinicalQuestion: question,
      relevantHistory: 'Metformin 1 g BD, HbA1c pending',
      currentMedications: 'Metformin',
      requestedBy: doctor.userId,
      requestedAt: iso(),
      notes: `Journey harness ${stamp}`,
    },
  });
  const consultOk = j.status('a consult is requested', consult.status, [200, 201], consult.json);
  const consultRef = String(consult.json.consult_id ?? consult.json.id ?? consultId);

  if (consultOk) {
    const inbox = await http('GET', '/platform/list/consults', { token: colleague.token });
    const rows = rowsOf(inbox.json, 'consults', 'items');
    j.record(
      'the consult reaches the specialty it was addressed to',
      JSON.stringify(rows ?? null).includes(question),
      `inbox held ${Array.isArray(rows) ? rows.length : 'a non-array'} consult(s)`
    );

    const findings = `Start basal insulin 10 units nocte (journey ${stamp})`;
    const answer = await http('PUT', `/clinical/consult/${consultRef}/response`, {
      token: colleague.token,
      // `ConsultPage` sends exactly these three: the endpoint requires an
      // assessment and a recommendation, because a consult closed with neither
      // is a consult answered with nothing.
      body: {
        assessment: findings,
        recommendations: 'Titrate by 2 units every 3 days to fasting glucose 5-7 mmol/L',
        follow_up: 'Review fasting glucose in one week',
      },
    });
    const answered = j.status('the specialist answers it', answer.status, [200, 201], answer.json);

    if (answered) {
      // Read back as the person who ASKED. This is the exact defect that let a
      // consult be answered — status, findings and recommendations written and
      // returned as `success: true` — and still read back as unanswered to
      // every clinician who opened it.
      const back = await http('GET', '/platform/list/consults', { token: doctor.token });
      const brows = rowsOf(back.json, 'consults', 'items');
      const mine = Array.isArray(brows)
        ? (brows as any[]).find((c) => JSON.stringify(c ?? null).includes(question))
        : undefined;
      j.record(
        'the doctor who asked sees the answer',
        JSON.stringify(mine ?? {}).includes(findings),
        `stored consult: ${JSON.stringify(mine ?? {}).slice(0, 500)}`
      );
      j.record(
        'the consult no longer reads as outstanding',
        ['completed', 'answered', 'responded'].includes(
          String(fieldAt(mine, 'status') ?? '').toLowerCase()
        ),
        `status read back as ${JSON.stringify(fieldAt(mine, 'status'))}`
      );
    } else {
      j.skip('the doctor who asked sees the answer', 'the response was refused');
      j.skip('the consult no longer reads as outstanding', 'the response was refused');
    }
  } else {
    j.skip('the consult reaches the specialty it was addressed to', 'the consult was refused');
    j.skip('the specialist answers it', 'the consult was refused');
    j.skip('the doctor who asked sees the answer', 'the consult was refused');
    j.skip('the consult no longer reads as outstanding', 'the consult was refused');
  }

  // --- Appointment ---------------------------------------------------------
  // AppointmentSchedulerPage.tsx: createAppointment, then setAppointmentStatus.
  const reason = `Diabetes review (journey ${stamp})`;
  const appt = await http('POST', '/appointments', {
    token: doctor.token,
    body: {
      patient_id: patient,
      appointment_type: 'consultation',
      preferred_date: inDays(28),
      preferred_time: '09:30',
      reason,
    },
  });
  const apptOk = j.status('a follow-up appointment is booked', appt.status, [200, 201], appt.json);
  const apptId = String(appt.json.appointment_id ?? appt.json.id ?? '');

  if (apptOk && apptId) {
    const mineList = await http('GET', `/appointments/provider/${doctor.wallet}`, {
      token: doctor.token,
    });
    const rows = rowsOf(mineList.json, 'appointments', 'items');
    j.record(
      "the appointment is on the provider's own diary",
      JSON.stringify(rows ?? null).includes(apptId),
      `the diary held ${Array.isArray(rows) ? rows.length : 'a non-array'} appointment(s)`
    );

    // The booker cannot confirm their own appointment — the patient does. That
    // is the product's decision and a good one, so it is asserted rather than
    // worked around.
    const confirm = await http('POST', `/appointments/${apptId}/status`, {
      token: doctor.token,
      body: { status: 'confirmed' },
    });
    j.status(
      'the clinician who booked it cannot also confirm it',
      confirm.status,
      403,
      confirm.json
    );

    // A scheduled appointment is not a completed one. If nothing structurally
    // prevents the jump, two states that mean different things collapse.
    const skipAhead = await http('POST', `/appointments/${apptId}/status`, {
      token: doctor.token,
      body: { status: 'no_show' },
    });
    const then = await http('POST', `/appointments/${apptId}/status`, {
      token: doctor.token,
      body: { status: 'confirmed' },
    });
    j.status(
      'an appointment marked no-show cannot be silently un-marked',
      then.status,
      [400, 403, 409],
      { noShow: skipAhead.status, ...then.json }
    );
  } else {
    j.skip("the appointment is on the provider's own diary", 'the appointment was refused');
    j.skip('it can be confirmed', 'the appointment was refused');
    j.skip('an appointment marked no-show cannot be silently un-marked', 'the appointment was refused');
  }

  // --- Discharge summary, approved by somebody else -----------------------
  // DischargePage.tsx: POST /api/clinical/discharge-summary, then
  // POST /api/clinical/discharges/{id}/approve
  const primaryDiagnosis = `Type 2 diabetes mellitus, poorly controlled (journey ${stamp})`;
  const discharge = await http('POST', '/clinical/discharge-summary', {
    token: doctor.token,
    body: {
      patient_id: patient,
      patient_name: fullName,
      admission_date: today(),
      discharge_date: today(),
      discharge_disposition: 'home',
      primary_diagnosis: primaryDiagnosis,
      secondary_diagnoses: ['Hypertension'],
      procedures_performed: [],
      discharge_condition: 'stable',
      discharge_instructions: [
        { category: 'general', instructions: ['Check capillary glucose twice daily'] },
      ],
      follow_up_appointments: [
        { provider: 'Endocrinology', timeframe: '4 weeks', reason: 'Diabetes review' },
      ],
      discharge_medications: [
        { medication: 'Metformin', dosage: '1 g', frequency: 'BD', duration: 'ongoing' },
      ],
      activity_restrictions: [],
      diet_instructions: 'Reduced refined carbohydrate',
      warning_signs: ['Vomiting', 'Drowsiness'],
      emergency_contact_instructions: 'Return to the emergency unit',
      prepared_by: doctor.wallet,
    },
  });
  const dischargeOk = j.status('a discharge summary is prepared', discharge.status, [200, 201], discharge.json);
  const summaryId = String(discharge.json.summary_id ?? discharge.json.id ?? '');

  if (dischargeOk && summaryId) {
    const list = await http('GET', '/clinical/discharges', { token: colleague.token });
    const rows = rowsOf(list.json, 'discharges', 'summaries', 'items');
    j.record(
      'the summary is on the discharge list',
      JSON.stringify(rows ?? null).includes(summaryId) || JSON.stringify(rows ?? null).includes(primaryDiagnosis),
      `list held ${Array.isArray(rows) ? rows.length : 'a non-array'} summary(ies)`
    );
    // The medicines the patient goes home on are the most-copied part of a
    // discharge summary and the part most often lost.
    j.record(
      'the discharge medicines and the warning signs survive',
      JSON.stringify(rows ?? null).includes('Metformin') && JSON.stringify(rows ?? null).includes('Drowsiness'),
      'a discharge summary without its medicines is the reason a patient stops taking them'
    );

    const approve = await http('POST', `/clinical/discharges/${summaryId}/approve`, {
      token: colleague.token,
      body: {},
    });
    j.status('a second clinician approves the discharge', approve.status, [200, 201], approve.json);
  } else {
    j.skip('the summary is on the discharge list', 'the discharge summary was refused');
    j.skip('the discharge medicines and the warning signs survive', 'the discharge summary was refused');
    j.skip('a second clinician approves the discharge', 'the discharge summary was refused');
  }

  // --- The boundary of the role ------------------------------------------
  const roles = await http('POST', '/roles/assign', {
    token: doctor.token,
    // `name` is required by the endpoint. Omitting it answers 400 before the
    // authorization check runs, which proves nothing about the control.
    body: { wallet_address: colleague.wallet, name: 'Dr Browser Test Two', role: 'Nurse' },
  });
  j.status('a doctor cannot assign roles', roles.status, [401, 403], roles.json);

  // --- The card the whole product is named for ---------------------------
  await runHealthIdCardSteps(j, doctor, patient);
}

/**
 * The health ID card, end to end.
 *
 * MediChain's headline is a paramedic tapping a card. Four endpoints have
 * backed it since the beginning and, until `HealthIdCardsPage` was built, no
 * screen in either application called any of them -- so this path had never
 * been exercised by anything but curl. Worse, `CardRegistry` had no storage
 * behind it, so a card issued here and read back in the same process looked
 * perfect and was gone at the next restart.
 *
 * Split out of `runDoctorJourney` so the function stays inside the 60-line
 * branching budget; called at the end of it.
 */
export async function runHealthIdCardSteps(
  j: Journal,
  doctor: Session,
  patient: string
): Promise<void> {
  // HealthIdCardsPage.tsx: generateNFCCard -> POST /api/nfc/generate
  const issue = await http('POST', '/nfc/generate', {
    token: doctor.token,
    body: { patient_id: patient, national_id_type: 'ghana' },
  });
  const issued = j.status('a health ID card is issued', issue.status, [200, 201], issue.json);

  if (!issued) {
    j.skip('the issued card is findable by patient', 'the card was not issued');
    j.skip('the card records the ID type the clinician chose', 'the card was not issued');
    return;
  }

  const cardHash = String(issue.json.card_hash ?? '');
  j.record(
    'the issued card comes back with a hash to tap',
    cardHash.length > 0,
    'a card with no hash is a card no reader can match'
  );

  // getCardInfo -> GET /api/nfc/card/{patient_id}
  const found = await http('GET', `/nfc/card/${patient}`, { token: doctor.token });
  const card = (found.json.card ?? found.json) as Record<string, unknown>;
  j.record(
    'the issued card is findable by patient',
    found.status === 200 && String(card.card_hash ?? '') === cardHash,
    `lookup answered ${found.status} with ${JSON.stringify(found.json).slice(0, 200)}`
  );
  j.record(
    'the card records the ID type the clinician chose',
    String(card.national_id_type ?? '').includes('Ghana'),
    `stored ID type was ${JSON.stringify(card.national_id_type)} — a Ghana Card issued as ` +
      `"Other ID" is verified against no national ID system at all`
  );

  // An unknown ID type is refused rather than silently becoming `Other`.
  const bogus = await http('POST', '/nfc/generate', {
    token: doctor.token,
    body: { patient_id: patient, national_id_type: 'ghanacrd' },
  });
  j.status('a misspelt national ID type is refused', bogus.status, [400], bogus.json);
}
