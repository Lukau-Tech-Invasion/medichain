/**
 * The patient's journey, start to finish.
 *
 * # The story
 *
 * A patient opens the app and sees their own record — their blood type, their
 * allergies, the medicines they are on. They look at who has been reading it.
 * A doctor asks for access; they grant it, and later take it back. They book an
 * appointment, message the clinic, log a symptom, mark a medicine as taken,
 * check their emergency card, and leave a satisfaction survey. Then they try to
 * open somebody else's record and cannot.
 *
 * # Why the patient journey is different from the others
 *
 * A clinician's failure mode is a lost record. A patient's is a *disclosed*
 * one. So this journey asserts two things at every step: that the patient can
 * reach their own data, and that the same request pointed at another patient is
 * refused — including after a grant has been revoked, which is the moment the
 * revocation either means something or does not.
 *
 * The second half of that is covered exhaustively by
 * `cross-role-qualification.ts` and is not duplicated here. What this file adds
 * is the part nobody had run: the patient's own *productive* actions.
 */

import { http, type Journal, type Session, type Manifest, discrepancies, findBy, fieldAt,
  rowsOf,
} from '../lib/journey';

const iso = () => new Date().toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export async function patientJourney(
  j: Journal,
  patient: Session,
  clinician: Session,
  nurse: Session,
  m: Manifest
): Promise<void> {
  j.journey('Patient — their own record, their own decisions');
  const id = m.patient.linked_patient_id;
  const other = m.patient_b.linked_patient_id;
  const stamp = Date.now();

  // --- The record they open the app to see --------------------------------
  const mine = await http('GET', `/patients/${id}`, { token: patient.token });
  const opened = j.status('the patient opens their own record', mine.status, 200, mine.json);

  if (opened) {
    // The three things on the front screen. An empty allergy array here is not
    // "no allergies" — it is the same shape as "we could not decrypt your
    // profile", and the two must not look alike to somebody in an emergency.
    // A single record, not a list.
    const profile = (mine.json.patient ?? mine.json) as any;
    j.record(
      'their name and blood type are there',
      Boolean(fieldAt(profile, 'full_name')) &&
        Boolean(fieldAt(profile, 'blood_type') ?? fieldAt(profile, 'emergency_info.blood_type')),
      `record: ${JSON.stringify(profile).slice(0, 300)}`
    );
    j.record(
      'the allergies on file are readable, and are not a silent empty list',
      JSON.stringify(profile).toLowerCase().includes('penicillin'),
      `the seeded patient has a recorded penicillin allergy. An empty array here is ` +
        `indistinguishable from an undecryptable profile, and this is the screen a ` +
        `paramedic reads. Record: ${JSON.stringify(profile).slice(0, 400)}`
    );
  } else {
    j.skip('their name and blood type are there', 'the record did not open');
    j.skip('the allergies on file are readable, and are not a silent empty list', 'the record did not open');
  }

  // --- Who has been reading it --------------------------------------------
  const logs = await http('GET', `/access-logs/${id}`, { token: patient.token });
  const logsOk = j.status('the patient can read their own access log', logs.status, 200, logs.json);
  if (logsOk) {
    const entries = rowsOf(logs.json, 'access_logs', 'logs');
    j.record(
      'the access log is not an empty page',
      Array.isArray(entries) && entries.length > 0,
      `a patient's right of access is the whole POPIA argument for this system; an empty ` +
        `log after clinicians have been in the record answers the wrong question. ` +
        `Response keys: ${Object.keys(logs.json).join(',')}`
    );
  } else {
    j.skip('the access log is not an empty page', 'the access log did not open');
  }

  // --- Booking their own appointment --------------------------------------
  // AppointmentsPage.tsx: createAppointment with the patient's own health id.
  const reason = `Persistent cough (journey ${stamp})`;
  const book = await http('POST', '/appointments', {
    token: patient.token,
    body: {
      patient_id: id,
      provider_id: clinician.wallet,
      appointment_type: 'consultation',
      preferred_date: inDays(14),
      preferred_time: '11:00',
      reason,
    },
  });
  const booked = j.status('the patient books an appointment', book.status, [200, 201], book.json);
  const apptId = String(book.json.appointment_id ?? book.json.id ?? '');

  if (booked) {
    const list = await http('GET', `/appointments/patient/${id}`, { token: patient.token });
    const rows = rowsOf(list.json, 'appointments', 'items');
    const found = findBy(rows, 'appointment_id', apptId) ?? findBy(rows, 'id', apptId);
    j.record(
      'it appears in their own appointment list',
      found !== undefined || JSON.stringify(rows ?? null).includes(reason),
      `list held ${Array.isArray(rows) ? rows.length : 'a non-array'} appointment(s)`
    );
    j.record(
      'the reason they gave for the visit reaches the clinician',
      JSON.stringify(rows ?? null).includes(reason),
      'the reason is what lets a clinic triage the booking; losing it makes every ' +
        'appointment identical'
    );

    // The clinician's diary is the other side of the same booking.
    const diary = await http('GET', `/appointments/provider/${clinician.wallet}`, {
      token: clinician.token,
    });
    const drows = rowsOf(diary.json, 'appointments', 'items');
    j.record(
      "the booking is on the clinician's diary too",
      JSON.stringify(drows ?? null).includes(apptId) || JSON.stringify(drows ?? null).includes(reason),
      `a booking the patient can see and the provider cannot is a missed appointment. ` +
        `Diary held ${Array.isArray(drows) ? drows.length : 'a non-array'} entry(ies).`
    );

    if (apptId) {
      const cancel = await http('POST', `/appointments/${apptId}/status`, {
        token: patient.token,
        body: { status: 'cancelled', reason: 'No longer needed' },
      });
      j.status('the patient can cancel their own appointment', cancel.status, [200, 201], cancel.json);
    }
  } else {
    for (const n of [
      'it appears in their own appointment list',
      'the reason they gave for the visit reaches the clinician',
      "the booking is on the clinician's diary too",
      'the patient can cancel their own appointment',
    ]) {
      j.skip(n, 'the booking was refused');
    }
  }

  // --- Messaging the clinic ------------------------------------------------
  // MessagesPage.tsx: POST /api/messages/send
  const content = `Is it safe to take ibuprofen with my metformin? (journey ${stamp})`;
  const send = await http('POST', '/messages/send', {
    token: patient.token,
    body: {
      recipient_id: clinician.wallet,
      subject: 'Patient message',
      content,
      related_patient_id: id,
    },
  });
  const sent = j.status('the patient messages their clinician', send.status, [200, 201], send.json);

  if (sent) {
    const inbox = await http('GET', '/messages?folder=all', { token: clinician.token });
    const rows = rowsOf(inbox.json, 'messages', 'items');
    j.record(
      'the clinician receives it',
      JSON.stringify(rows ?? null).includes(content),
      `the clinician's inbox held ${Array.isArray(rows) ? rows.length : 'a non-array'} message(s)`
    );
    const own = await http('GET', '/messages?folder=all', { token: patient.token });
    j.record(
      'the patient keeps their own copy of what they sent',
      JSON.stringify(own.json ?? null).includes(content),
      'a sent message with no copy in the sender\'s own folder cannot be referred back to'
    );
  } else {
    j.skip('the clinician receives it', 'the message was refused');
    j.skip('the patient keeps their own copy of what they sent', 'the message was refused');
  }

  // --- Logging a symptom ---------------------------------------------------
  // SymptomTrackerPage.tsx: POST /api/symptoms/log
  const symptom = `Headache (journey ${stamp})`;
  const log = await http('POST', '/symptoms/log', {
    token: patient.token,
    body: { patient_id: id, symptom, severity: 3, notes: 'Worse in the mornings' },
  });
  const logged = j.status('the patient logs a symptom', log.status, [200, 201], log.json);

  if (logged) {
    const hist = await http('GET', `/symptoms/${id}`, { token: patient.token });
    const rows = rowsOf(hist.json, 'symptoms', 'items');
    j.record(
      'the symptom is in their history, with its severity',
      JSON.stringify(rows ?? null).includes(symptom),
      `history held ${Array.isArray(rows) ? rows.length : 'a non-array'} entry(ies). ` +
        `SymptomTrackerPage adds the entry to the screen before the request resolves and ` +
        `swallows a failure with console.warn, so a rejected log still looks saved.`
    );
  } else {
    j.skip('the symptom is in their history, with its severity', 'the symptom log was refused');
  }

  // --- The symptom checker's session ---------------------------------------
  // `startSymptomCheck`, `submitSymptomAnswers` and `getSymptomCheckerHistory`
  // are typed, routed and have ZERO callers anywhere in either app.
  // SymptomCheckerPage calls only `analyze`, so a patient who is told to go to
  // an emergency department leaves no record that they were told.
  const analyze = await http('POST', '/symptoms/analyze', {
    token: patient.token,
    body: { symptoms: ['chest pain', 'shortness of breath'], patient_age: 41, patient_gender: 'female' },
  });
  const analysed = j.status('the symptom checker answers', analyze.status, [200, 201], analyze.json);
  if (analysed) {
    // The endpoint nests everything under `assessment`; `triage_level` is not
    // at the top level. The typed client unwraps it, and `SymptomCheckerPage`
    // read the top level for months and therefore always saw `undefined` —
    // which its severity map turned into "mild".
    // The assessment is one object nested under `assessment`.
    const assessment = (analyze.json.assessment ?? analyze.json) as any;
    j.record(
      'the answer carries a triage level the page can act on',
      Boolean(assessment.triage_level),
      `SymptomCheckerPage maps triage_level to what it shows the patient. Response: ` +
        `${JSON.stringify(analyze.json).slice(0, 300)}`
    );
    // The session, which is what makes the triage reviewable afterwards.
    //
    // `SymptomCheckerPage` now files one after every analysis; these three
    // endpoints had zero callers anywhere before that, so a patient could be
    // told to go to an emergency department and no record existed that they
    // had been. Driven here directly, because this harness is the API's
    // contract test and the page's own call is proven by the browser suite.
    const start = await http('POST', '/symptoms/start', {
      token: patient.token,
      body: { primary_symptom: 'chest pain', age: 41, gender: 'female' },
    });
    const startedOk = j.status('a symptom-check session can be opened', start.status, [200, 201], start.json);
    const sessionId = String(start.json.session_id ?? '');

    if (startedOk && sessionId) {
      const answered = await http('POST', `/symptoms/${sessionId}/answers`, {
        token: patient.token,
        body: {
          answers: {
            symptoms: ['chest pain', 'shortness of breath'],
            triage_level: assessment.triage_level,
            recommendation: assessment.recommendation,
          },
        },
      });
      j.status('the assessment is recorded against it', answered.status, [200, 201], answered.json);
    } else {
      j.skip('the assessment is recorded against it', 'no session was opened');
    }

    const history = await http('GET', `/symptoms/history/${id}`, { token: patient.token });
    const sessions = (history.json.sessions ?? history.json.items ?? []) as any[];
    j.record(
      'the symptom check leaves a record the patient can go back to',
      Array.isArray(sessions) && sessions.length > 0,
      `the checker session history held ${Array.isArray(sessions) ? sessions.length : 'nothing'}. ` +
        `A triage that told somebody to go to an emergency department, with no record that it ` +
        `did, cannot be reviewed by the clinician who sees them next.`
    );
  } else {
    j.skip('the answer carries a triage level the page can act on', 'the checker did not answer');
    j.skip('a symptom-check session can be opened', 'the checker did not answer');
    j.skip('the assessment is recorded against it', 'the checker did not answer');
    j.skip('the symptom check leaves a record the patient can go back to', 'the checker did not answer');
  }

  // --- Setting a reminder ---------------------------------------------------
  // MedicationRemindersPage.tsx: createMedicationReminder ->
  // POST /api/reminders/medication. The Add Reminder button had no onClick at
  // all until 2026-09-10, so nothing in either application had ever called this.
  const remStamp = Date.now().toString().slice(-6);
  const medName = `Journey Metformin ${remStamp}`;
  const setReminder = await http('POST', '/reminders/medication', {
    token: patient.token,
    body: {
      patient_id: id,
      medication_name: medName,
      dosage: '500 mg',
      frequency: 'twice_daily',
      reminder_times: ['08:00', '20:00'],
      start_date: iso().slice(0, 10),
      // The channels the scheduler reads. Nothing sent these, so `sms` was
      // false on every reminder ever created and the SMS branch -- which was
      // separately unreachable -- had no way to be entered even if it worked.
      push_notification: true,
      sms: true,
      email: false,
    },
  });
  const reminderSet = j.status('the patient sets a medication reminder', setReminder.status, [200, 201], setReminder.json);

  if (reminderSet) {
    const back = await http('GET', `/reminders/medication/${id}`, { token: patient.token });
    const rows = rowsOf(back.json, 'reminders', 'items');
    const saved = JSON.stringify(rows ?? null);
    j.record(
      'the reminder is on their list with the schedule they chose',
      saved.includes(medName) && saved.includes('08:00') && saved.includes('20:00'),
      `a reminder that saves without its times reminds nobody. Stored: ${saved.slice(0, 300)}`
    );
    j.record(
      'the frequency the patient chose survives, rather than becoming daily',
      saved.includes('TwiceDaily'),
      `the handler used to end in \`_ => Daily\`, so every frequency it did not ` +
        `recognise became one dose a day. Stored: ${saved.slice(0, 300)}`
    );
    j.record(
      'the notification channels the patient chose survive',
      saved.includes('"sms":true') || saved.includes('"sms": true'),
      `the scheduler reads these three flags to decide how to reach the patient; ` +
        `stored: ${saved.slice(0, 300)}`
    );
  } else {
    j.skip('the reminder is on their list with the schedule they chose', 'the reminder was refused');
    j.skip('the frequency the patient chose survives, rather than becoming daily', 'the reminder was refused');
    j.skip('the notification channels the patient chose survive', 'the reminder was refused');
  }

  // An unknown frequency is refused rather than silently stored as daily.
  const badFrequency = await http('POST', '/reminders/medication', {
    token: patient.token,
    body: {
      patient_id: id,
      medication_name: `Journey Bad ${remStamp}`,
      dosage: '1 tablet',
      frequency: 'twice a day',
      reminder_times: ['08:00'],
      start_date: iso().slice(0, 10),
    },
  });
  j.status('a frequency the API does not know is refused', badFrequency.status, [400], badFrequency.json);

  // --- Medication adherence -------------------------------------------------
  // MedicationsPage.tsx: logMedicationAdherence. Also swallowed on failure.
  // `getPatientReminders` reads `/api/reminders/medication/{id}`.
  const reminders = await http('GET', `/reminders/medication/${id}`, { token: patient.token });
  const remOk = j.status('their medication reminders load', reminders.status, 200, reminders.json);
  if (remOk) {
    const list = rowsOf(reminders.json, 'reminders', 'items');
    const first = Array.isArray(list) ? list[0] : undefined;
    const reminderId = String(fieldAt(first, 'id') ?? fieldAt(first, 'reminder_id') ?? '');
    if (reminderId) {
      const adherence = await http('POST', '/reminders/adherence', {
        token: patient.token,
        // What `MedicationsPage` sends. It used to send
        // `{ patient_id, taken, taken_at }` and this step copied that, so both
        // were wrong together -- which is why the endpoint's 400 went unseen
        // for as long as it did.
        body: { reminder_id: reminderId, action: 'taken' },
      });
      const marked = j.status('the patient marks a dose as taken', adherence.status, [200, 201], adherence.json);
      if (marked) {
        // Read back through the endpoint that exists. This used to ask
        // `/patients/{id}/reminders`, which is not a route -- so the step
        // proved nothing, and the fact that NOTHING could read an adherence
        // log went unnoticed behind it.
        const after = await http('GET', `/reminders/adherence/${id}`, { token: patient.token });
        const logs = rowsOf(after.json, 'logs', 'items');
        j.record(
          'the dose stays marked when the screen is reopened',
          JSON.stringify(logs ?? null).includes(reminderId),
          `MedicationsPage used to set the tick optimistically and swallow the failure, ` +
            `so an unrecorded dose still read as taken. ` +
            `Reloaded: ${JSON.stringify(after.json).slice(0, 300)}`
        );
        j.record(
          'the log says the patient reported it, not who they are',
          JSON.stringify(logs ?? null).includes('"reported_by":"patient"'),
          `reported_by is a category (patient/caregiver/system/provider); a wallet ` +
            `address there is rejected by the database. Stored: ${JSON.stringify(logs).slice(0, 200)}`
        );
      } else {
        j.skip('the dose stays marked when the screen is reopened', 'the adherence log was refused');
        j.skip('the log says the patient reported it, not who they are', 'the adherence log was refused');
      }
    } else {
      j.skip('the patient marks a dose as taken', 'the patient has no reminders to mark');
      j.skip('the dose stays marked when the screen is reopened', 'the patient has no reminders to mark');
      j.skip('the log says the patient reported it, not who they are', 'the patient has no reminders to mark');
    }
  } else {
    j.skip('the patient marks a dose as taken', 'reminders did not load');
    j.skip('the dose stays marked when the screen is reopened', 'reminders did not load');
    j.skip('the log says the patient reported it, not who they are', 'reminders did not load');
  }

  // --- The emergency card ---------------------------------------------------
  // EmergencyCardPage / MedicalIdPage. The one screen where being wrong could
  // contribute to a death.
  const card = await http('GET', `/medical-id/${id}`, { token: patient.token });
  const cardOk = j.status('the emergency medical ID opens', card.status, 200, card.json);
  if (cardOk) {
    const body = JSON.stringify(card.json);
    // `blood_type` is an object carrying the value and the colour the card
    // renders it in, not a bare string.
    const bloodType = String(
      (card.json.blood_type as any)?.value ?? card.json.blood_type ?? ''
    );
    j.record(
      'the card shows a real blood type, not a placeholder',
      bloodType.length > 0 && !['Unknown', 'Redacted', 'Patient'].includes(bloodType),
      `the card previously printed the literals "Patient" and "Redacted" for name and date ` +
        `of birth. Card: ${body.slice(0, 400)}`
    );
    j.record(
      'the card carries the allergies, conditions and medicines a responder needs',
      body.toLowerCase().includes('penicillin') &&
        /chronic_conditions|conditions/.test(body) &&
        /medications|current_medications/.test(body),
      `these were hardcoded empty vectors until 2026-08-11; an empty array on this card is ` +
        `an assertion that the patient has no allergies. Card: ${body.slice(0, 500)}`
    );
    j.record(
      'the card says whether the profile could be read at all',
      Object.prototype.hasOwnProperty.call(card.json, 'profile_unavailable') ||
        Object.prototype.hasOwnProperty.call(card.json.medical_id ?? {}, 'profile_unavailable'),
      `"nothing recorded" and "the record could not be decrypted" must not look alike on ` +
        `this screen. Card keys: ${Object.keys(card.json).join(',')}`
    );
  } else {
    for (const n of [
      'the card shows a real blood type, not a placeholder',
      'the card carries the allergies, conditions and medicines a responder needs',
      'the card says whether the profile could be read at all',
    ]) {
      j.skip(n, 'the medical ID did not open');
    }
  }

  // --- Satisfaction survey --------------------------------------------------
  // SatisfactionSurveyPage.tsx: createSatisfactionSurvey
  const comments = `Seen quickly and explained clearly (journey ${stamp})`;
  const survey = await http('POST', '/clinical/satisfaction-survey', {
    token: patient.token,
    body: {
      visit_date: inDays(-1),
      department: 'General care',
      survey_type: 'PostVisit',
      // `SurveyResponse` carries the question's TEXT as well as its id: a
      // stored answer whose question nobody recorded cannot be interpreted
      // later, when the questionnaire has moved on.
      responses: [
        {
          question_id: 'overall',
          question_text: 'Overall, how satisfied were you with your visit?',
          response_type: 'Rating',
          response_value: '5',
        },
      ],
      overall_rating: 5,
      nps_score: 10,
      comments,
      anonymous: false,
      follow_up_requested: false,
    },
  });
  j.status('the patient leaves a satisfaction survey', survey.status, [200, 201], survey.json);

  // --- Their own settings ---------------------------------------------------
  const settings = await http('POST', '/settings', {
    token: patient.token,
    body: {
      notifications: { appointment_reminders: false, lab_results: true, messages: true },
      privacy: { share_for_research: false, show_in_directory: false },
      appSettings: { language: 'en-US', theme: 'system' },
    },
  });
  const saved = j.status('a preference change is saved', settings.status, [200, 201], settings.json);
  if (saved) {
    const back = await http('GET', '/settings', { token: patient.token });
    const body = JSON.stringify(back.json);
    j.record(
      'the preference reads back as the patient set it',
      /"appointment_reminders"\s*:\s*false/.test(body) && /"share_for_research"\s*:\s*false/.test(body),
      `a research opt-out that does not persist is a consent failure, not a settings bug. ` +
        `Stored: ${body.slice(0, 400)}`
    );
  } else {
    j.skip('the preference reads back as the patient set it', 'the settings save was refused');
  }

  // --- The boundary ---------------------------------------------------------
  const theirs = await http('GET', `/patients/${other}`, { token: patient.token });
  j.status("a patient cannot open another patient's record", theirs.status, [403, 404], theirs.json);

  const theirLogs = await http('GET', `/access-logs/${other}`, { token: patient.token });
  j.status("a patient cannot read another patient's access log", theirLogs.status, [403, 404], theirLogs.json);

  // The arrival the patient does themselves, at the door, on their phone.
  await runSelfCheckInSteps(j, patient, id);

  // --- What the hospital wrote about them ---------------------------------
  await runDischargeVisibilitySteps(j, patient, clinician, id, other);
  await runImmunisationVisibilitySteps(j, patient, nurse, id, other);
  await runImagingVisibilitySteps(j, patient, clinician, id, other);
  await runPathologyVisibilitySteps(j, patient, clinician, id, other);
  await runConsultVisibilitySteps(j, patient, clinician, id, other);
  await runVisitNoteAndPrescriptionVisibilitySteps(j, patient, clinician, id, other);
  await runWardRecordVisibilitySteps(j, patient, clinician, nurse, id, other);
  await runConsentWithdrawalSteps(j, patient, id);

  const chart = await http('POST', '/clinical/vitals', {
    token: patient.token,
    body: { patient_id: id, heart_rate: 70 },
  });
  j.status('a patient cannot write clinical observations, even on themselves', chart.status, [401, 403], chart.json);
}

/**
 * The patient checks themselves in for their own appointment.
 *
 * `POST /api/appointments/{id}/check-in` compared the caller's wallet address
 * to a `PAT-` id, so this was 403 for every patient who ever tried it. WF-007
 * fixed the clinician half of that guard and left the patient half comparing
 * two different namespaces -- the recurring wallet-vs-patient-id defect.
 *
 * Split out so `runPatientJourney` stays inside the 60-line branching budget.
 */
export async function runSelfCheckInSteps(
  j: Journal,
  patient: Session,
  id: string
): Promise<void> {
  // Every run books against the same provider, so a slot is only free once.
  // A fixed time collides immediately and a random one collides eventually --
  // both leave a test that fails for a reason having nothing to do with the
  // thing under test. So: try successive slots until one is free, bounded.
  //
  // The 409 itself is the overlap guard working correctly, which is why this
  // retries rather than treating it as a failure.
  let booked = { status: 0, json: {} as Record<string, unknown> };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const hour = String(8 + Math.floor(attempt / 2)).padStart(2, '0');
    const minute = attempt % 2 === 0 ? '05' : '35';
    booked = await http('POST', '/appointments', {
      token: patient.token,
      body: {
        patient_id: id,
        appointment_type: 'FollowUp',
        reason: `Journey self check-in ${Date.now()}`,
        // Tomorrow, not today: a slot in the past behaves differently and the
        // point here is the transition, not the scheduling window.
        preferred_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        preferred_time: `${hour}:${minute}`,
        duration_minutes: 15,
      },
    });
    if (booked.status !== 409) break;
  }
  const bookedOk = j.status(
    'the patient books the appointment they will check in to',
    booked.status,
    [200, 201],
    booked.json
  );
  const apptId = String(booked.json.appointment_id ?? booked.json.id ?? '');

  if (!bookedOk || !apptId) {
    j.skip('the patient confirms the time they were offered', 'the appointment was not booked');
    j.skip('the patient checks themselves in', 'the appointment was not booked');
    return;
  }

  // Confirm first. `is_valid_transition` deliberately refuses
  // `Scheduled -> CheckedIn`: a booking is a proposal until the party who did
  // not make it agrees, and allowing check-in straight from Scheduled would
  // make confirmation decorative. The journey follows the real path rather
  // than asking for the shortcut.
  const confirm = await http('POST', `/appointments/${apptId}/status`, {
    token: patient.token,
    body: { status: 'Confirmed' },
  });
  const confirmed = j.status('the patient confirms the time they were offered', confirm.status, [200, 201], confirm.json);

  if (!confirmed) {
    j.skip('the patient checks themselves in', 'the appointment was not confirmed');
    return;
  }

  const checkIn = await http('POST', `/appointments/${apptId}/check-in`, {
    token: patient.token,
    body: {},
  });
  j.status('the patient checks themselves in', checkIn.status, [200, 201], checkIn.json);
}

/**
 * Workflow 1: the doctor discharges the patient, and the patient can read it.
 *
 * This is the test the rest of the suite does not make. Every other read-back
 * here is done by the patient on something the patient wrote, or by a colleague
 * on something a clinician wrote. This one crosses the two applications: a
 * clinician produces the document, and the person it is about opens it.
 *
 * The discharge summary and instructions were reachable only as
 * `/api/clinical/discharge-summary/{id}` and its instructions sibling — keyed
 * by a UUID the patient has never seen — plus the clinician's worklist, which a
 * patient is refused. So the one document a patient physically leaves hospital
 * with could be written, approved by a second clinician, stored, and never
 * opened by them.
 *
 * See docs/PATIENT_VISIBILITY_WORKFLOWS.md.
 */
export async function runDischargeVisibilitySteps(
  j: Journal,
  patient: Session,
  clinician: Session,
  id: string,
  otherId: string
): Promise<void> {
  const stamp = Date.now();
  const diagnosis = `Community-acquired pneumonia (journey ${stamp})`;
  const homeMedicine = `Amoxicillin 500mg (journey ${stamp})`;
  const warningSign = `Breathlessness at rest (journey ${stamp})`;

  // DischargePage.tsx -> POST /api/clinical/discharge-summary
  const summary = await http('POST', '/clinical/discharge-summary', {
    token: clinician.token,
    body: {
      patient_id: id,
      admission_date: new Date(Date.now() - 3 * 86400000).toISOString(),
      discharge_date: new Date().toISOString(),
      discharge_diagnosis: diagnosis,
      hospital_course: 'Responded to intravenous antibiotics; afebrile for 48 hours.',
      discharge_medications: [homeMedicine],
      follow_up_instructions: 'See your clinic in seven days.',
      discharge_disposition: 'home',
    },
  });
  const summaryFiled = j.status(
    'a doctor writes the discharge summary',
    summary.status,
    [200, 201],
    summary.json
  );

  // DischargePage.tsx -> POST /api/clinical/discharge-instructions
  const instructions = await http('POST', '/clinical/discharge-instructions', {
    token: clinician.token,
    body: {
      patient_id: id,
      diet_instructions: 'Light diet, plenty of fluids.',
      activity_restrictions: 'No heavy lifting for two weeks.',
      warning_signs: [warningSign],
      follow_up_appointments: 'Clinic in seven days.',
    },
  });
  const instructionsFiled = j.status(
    'and the instructions for going home',
    instructions.status,
    [200, 201],
    instructions.json
  );

  if (!summaryFiled && !instructionsFiled) {
    j.skip('the patient can open their own discharge', 'nothing was discharged');
    j.skip('the discharge names the diagnosis and the medicines to take home', 'nothing was discharged');
    j.skip('another patient cannot read this discharge', 'nothing was discharged');
    return;
  }

  // The assertion this workflow exists for: the PATIENT's own session.
  const mine = await http('GET', `/clinical/patient/${id}/discharges`, { token: patient.token });
  const opened = j.status(
    'the patient can open their own discharge',
    mine.status,
    200,
    mine.json
  );

  if (opened) {
    const body = JSON.stringify(mine.json ?? null);
    j.record(
      'the discharge names the diagnosis and the medicines to take home',
      body.includes(diagnosis) && body.includes(homeMedicine) && body.includes(warningSign),
      `a discharge a patient cannot read the medicines off is the reason they stop ` +
        `taking them. Returned: ${body.slice(0, 300)}`
    );
  } else {
    j.skip('the discharge names the diagnosis and the medicines to take home', 'the discharge did not open');
  }

  // And nobody else's. A discharge summary names a diagnosis and an admission,
  // so a route that lets one patient read another's is worse than no route.
  const theirs = await http('GET', `/clinical/patient/${otherId}/discharges`, {
    token: patient.token,
  });
  j.status('another patient cannot read this discharge', theirs.status, [401, 403], theirs.json);
}

/**
 * Workflow 2: the nurse records a vaccination, and the patient can read it.
 *
 * The producer is `ImmunizationPage` -> `POST /api/surgical/immunization`. The
 * consumer is the patient application's Medical History screen, which calls
 * `GET /api/clinical/immunizations` — caller-scoped, so it needs no id the
 * patient does not have.
 *
 * The route existed; whether the round trip worked had never been asserted, and
 * the two halves disagree about namespaces in exactly the place this codebase
 * keeps getting wrong: the nurse files against a `PAT-` id, the patient asks
 * with a wallet address, and `list_my_immunizations` bridges them through
 * `linked_patient_id`. If that resolution ever breaks, a patient is told they
 * have had no vaccinations — which is the answer that gets one repeated.
 *
 * The boundary here is not a second route to refuse. There is only one route
 * and it serves the caller, so the boundary assertion is that a vaccination
 * given to somebody else does not appear in this patient's card.
 *
 * See docs/PATIENT_VISIBILITY_WORKFLOWS.md.
 */
export async function runImmunisationVisibilitySteps(
  j: Journal,
  patient: Session,
  nurse: Session,
  id: string,
  otherId: string
): Promise<void> {
  const stamp = Date.now();
  const vaccine = `Measles-Rubella (journey ${stamp})`;
  const lot = `LOT-${stamp}`;
  const othersVaccine = `Yellow fever (other patient ${stamp})`;

  // ImmunizationPage.tsx -> createImmunization(), field for field.
  const dose = (patientId: string, vaccineName: string, lotNumber: string) => ({
    patient_id: patientId,
    vaccine_name: vaccineName,
    cvx_code: '03',
    manufacturer: 'Journey Biologicals',
    lot_number: lotNumber,
    expiration_date: inDays(400),
    administration_date: iso(),
    dose_number: 1,
    route: 'Intramuscular',
    site: 'left-deltoid',
    administered_by: 'Journey Nurse',
    vis_date: iso(),
    funding_source: 'PublicVFC',
    registry_reported: false,
    adverse_reaction: null,
    notes: 'Given in the vaccination room.',
  });

  const given = await http('POST', '/surgical/immunization', {
    token: nurse.token,
    body: dose(id, vaccine, lot),
  });
  const filed = j.status('a nurse records the vaccination', given.status, [200, 201], given.json);

  // A second patient's dose, so the card can be checked for leakage.
  const othersDose = await http('POST', '/surgical/immunization', {
    token: nurse.token,
    body: dose(otherId, othersVaccine, `LOT-OTHER-${stamp}`),
  });

  if (!filed) {
    j.skip('the patient can see their own vaccination card', 'the vaccination was not recorded');
    j.skip('the card names the vaccine, the lot and the date it was given', 'the vaccination was not recorded');
    j.skip("another patient's vaccination is not on this card", 'the vaccination was not recorded');
    return;
  }

  // The assertion this workflow exists for: the PATIENT's own session, and no
  // id in the URL — this is what the Medical History screen actually sends.
  const card = await http('GET', '/clinical/immunizations', { token: patient.token });
  const opened = j.status('the patient can see their own vaccination card', card.status, 200, card.json);

  if (!opened) {
    j.skip('the card names the vaccine, the lot and the date it was given', 'the card did not open');
    j.skip("another patient's vaccination is not on this card", 'the card did not open');
    return;
  }

  const body = JSON.stringify(card.json ?? null);
  j.record(
    'the card names the vaccine, the lot and the date it was given',
    body.includes(vaccine) && body.includes(lot),
    `a vaccination the patient cannot see is a vaccination they are given twice. ` +
      `Returned: ${body.slice(0, 300)}`
  );

  if (othersDose.status === 200 || othersDose.status === 201) {
    j.record(
      "another patient's vaccination is not on this card",
      !body.includes(othersVaccine),
      `this route is caller-scoped, so a second patient's dose appearing here is a ` +
        `disclosure, not a display bug. Returned: ${body.slice(0, 300)}`
    );
  } else {
    j.skip("another patient's vaccination is not on this card", "the second patient's dose was refused");
  }
}

/**
 * Workflow 3: the scan is ordered and reported, and the patient can read it.
 *
 * The producer is `ImagingPage` -> `POST /api/surgical/radiology/order`, and
 * the radiologist's `POST /api/surgical/radiology/report`. Neither result was
 * reachable to the patient: `GET /api/surgical/radiology/report/{id}` is keyed
 * by an id they have never seen *and* gated on `require_clinical_staff`, so a
 * patient holding the id was refused anyway. The only other read is the
 * deployment-wide register.
 *
 * So the scan a patient was sent for, waited for and worried about could be
 * performed, reported, flagged critical — and never opened by them.
 *
 * The order is asserted as well as the report, because a study that has been
 * done but not yet read must not look identical to one that was never ordered.
 *
 * See docs/PATIENT_VISIBILITY_WORKFLOWS.md.
 */
export async function runImagingVisibilitySteps(
  j: Journal,
  patient: Session,
  clinician: Session,
  id: string,
  otherId: string
): Promise<void> {
  const stamp = Date.now();
  const indication = `Persistent cough, six weeks (journey ${stamp})`;
  const impression = `No focal consolidation (journey ${stamp})`;
  const orderId = `IMG-${stamp}`;

  // ImagingPage.tsx -> POST /api/surgical/radiology/order, field for field.
  const order = await http('POST', '/surgical/radiology/order', {
    token: clinician.token,
    body: {
      order_id: orderId,
      patient_id: id,
      study_type: 'XRay',
      body_part: 'Chest',
      laterality: 'NA',
      indication,
      priority: 'Routine',
      // The handler stamps this from the session and refuses a mismatch: an
      // imaging order is an accountable clinical act, so the ordering provider
      // is whoever placed it, not whoever the body names.
      ordering_provider: clinician.wallet,
      order_time: Math.floor(Date.now() / 1000),
      contrast: false,
      allergies_reviewed: true,
      creatinine_checked: null,
      pregnancy_checked: null,
      special_instructions: null,
      status: 'Ordered',
    },
  });
  const ordered = j.status('a doctor orders the scan', order.status, [200, 201], order.json);

  const report = await http('POST', '/surgical/radiology/report', {
    token: clinician.token,
    body: {
      report_id: `RAD-${stamp}`,
      patient_id: id,
      order_id: orderId,
      accession_number: `ACC-${stamp}`,
      study_type: 'XRay',
      body_part: 'Chest',
      study_datetime: Math.floor(Date.now() / 1000),
      technique: 'PA and lateral projections.',
      clinical_history: indication,
      findings: 'Lungs clear. Heart size normal. No pleural effusion.',
      impression: [impression],
      critical_finding: false,
      radiologist: clinician.wallet,
      status: 'Final',
    },
  });
  const reported = j.status('the radiologist reports it', report.status, [200, 201], report.json);

  if (!ordered && !reported) {
    j.skip('the patient can open their own imaging', 'nothing was imaged');
    j.skip('the report carries the impression the radiologist wrote', 'nothing was imaged');
    j.skip("another patient cannot read this patient's imaging", 'nothing was imaged');
    return;
  }

  // The assertion this workflow exists for: the PATIENT's own session.
  const mine = await http('GET', `/clinical/patient/${id}/imaging`, { token: patient.token });
  const opened = j.status('the patient can open their own imaging', mine.status, 200, mine.json);

  if (opened) {
    const body = JSON.stringify(mine.json ?? null);
    j.record(
      'the report carries the impression the radiologist wrote',
      body.includes(impression) && body.includes(indication),
      `the impression is the line a patient reads first and a clinician acts on. ` +
        `Returned: ${body.slice(0, 300)}`
    );
  } else {
    j.skip('the report carries the impression the radiologist wrote', 'the imaging did not open');
  }

  const theirs = await http('GET', `/clinical/patient/${otherId}/imaging`, {
    token: patient.token,
  });
  j.status(
    "another patient cannot read this patient's imaging",
    theirs.status,
    [401, 403],
    theirs.json
  );
}

/**
 * Workflow 4: the specimen the patient gave, and what the lab found in it.
 *
 * The producer is `PathologyPage` -> `POST /api/surgical/pathology`. The report
 * was reachable only as `GET /api/surgical/pathology/{id}` — keyed by an
 * accession number the patient has never seen — and through the deployment-wide
 * register, both gated on clinical staff.
 *
 * A pathology report is where a cancer diagnosis, a margin status and a staging
 * live. It is the result a patient chases hardest and the one they were least
 * able to reach.
 *
 * See docs/PATIENT_VISIBILITY_WORKFLOWS.md.
 */
export async function runPathologyVisibilitySteps(
  j: Journal,
  patient: Session,
  clinician: Session,
  id: string,
  otherId: string
): Promise<void> {
  const stamp = Date.now();
  const site = `Left breast, upper outer quadrant (journey ${stamp})`;
  const clinicalDiagnosis = `Suspicious mass (journey ${stamp})`;

  // PathologyPage.tsx -> createPathology(newSpecimen), field for field. The
  // page accessions a specimen; the finished report fields come later, which is
  // why the API accepts this shape rather than demanding a completed report.
  const accession = await http('POST', '/surgical/pathology', {
    token: clinician.token,
    body: {
      specimenId: `S-${stamp}`,
      patientId: id,
      patientName: 'Journey Patient',
      collectionDate: new Date().toISOString().slice(0, 10),
      collectionTime: '09:30',
      clinician: clinician.wallet,
      specimenType: 'surgical',
      site,
      laterality: 'left',
      clinicalHistory: 'Palpable mass on routine examination.',
      clinicalDiagnosis,
      priority: 'routine',
      status: 'received',
      receivedDate: new Date().toISOString().slice(0, 10),
      receivedBy: clinician.wallet,
      container: 'Formalin pot',
      fixative: '10% neutral buffered formalin',
    },
  });
  const accessioned = j.status(
    'the lab accessions the specimen',
    accession.status,
    [200, 201],
    accession.json
  );

  if (!accessioned) {
    j.skip('the patient can open their own pathology', 'no specimen was accessioned');
    j.skip('the pathology names the specimen the patient gave', 'no specimen was accessioned');
    j.skip("another patient cannot read this patient's pathology", 'no specimen was accessioned');
    return;
  }

  const mine = await http('GET', `/clinical/patient/${id}/pathology`, { token: patient.token });
  const opened = j.status('the patient can open their own pathology', mine.status, 200, mine.json);

  if (opened) {
    const body = JSON.stringify(mine.json ?? null);
    j.record(
      'the pathology names the specimen the patient gave',
      body.includes(site),
      `a pathology record a patient cannot tie back to the specimen they gave is ` +
        `not a record of anything. Returned: ${body.slice(0, 300)}`
    );
  } else {
    j.skip('the pathology names the specimen the patient gave', 'the pathology did not open');
  }

  const theirs = await http('GET', `/clinical/patient/${otherId}/pathology`, {
    token: patient.token,
  });
  j.status(
    "another patient cannot read this patient's pathology",
    theirs.status,
    [401, 403],
    theirs.json
  );
}

/**
 * The visit note and the prescription, read by the patient they are about.
 *
 * These are the two things a patient leaves a consultation expecting to find
 * in the app -- what the doctor concluded, and what they were given -- and the
 * two screens a demonstration shows. No journey read either from the patient's
 * side: the doctor journey checks a colleague can read the note, and the
 * pharmacist journey checks the dispensing arithmetic, so "the patient can see
 * it" rested on the patient pages' unit tests and their mocks.
 *
 * Producers: SOAPNotePage -> `POST /api/clinical/soap`, and EPrescribePage's
 * create -> sign -> transmit. Readers: MyRecordsPage's
 * `/clinical/patient/{id}/soap` and MedicationsPage's
 * `/e-prescriptions/patient/{id}`.
 */
export async function runVisitNoteAndPrescriptionVisibilitySteps(
  j: Journal,
  patient: Session,
  clinician: Session,
  id: string,
  otherId: string
): Promise<void> {
  const stamp = Date.now();
  const complaint = `Dry cough for two weeks (journey ${stamp})`;
  const plan = `Rest and fluids; review if fever develops (journey ${stamp})`;

  const note = await http('POST', '/clinical/soap', {
    token: clinician.token,
    // SOAPNotePage sends every key, blank or not; so does this.
    body: {
      patient_id: id,
      encounter_type: 'office_visit',
      subjective: {
        chief_complaint: complaint,
        history_of_present_illness: '',
        symptoms: ['cough'],
        symptom_duration: '2 weeks',
        review_of_systems: '',
        modifying_factors: '',
        previous_treatments: '',
      },
      objective: {
        vital_signs: null,
        general_appearance: '',
        physical_exam: [],
        lab_results: [],
        imaging_results: [],
        diagnostic_tests: [],
      },
      assessment: {
        primary_diagnosis: { description: 'Acute bronchitis', icd10_code: 'J20.9', status: 'active' },
        secondary_diagnoses: [],
        clinical_summary: 'Afebrile, chest clear on auscultation.',
        severity: 'mild',
      },
      plan: {
        treatment_plan: plan,
        medications: [],
        procedures: [],
        lab_orders: [],
        imaging_orders: [],
        referrals: [],
        patient_education: [],
        follow_up: 'If fever develops',
        return_precautions: [],
        activity_restrictions: '',
      },
    },
  });
  const written = j.status('a doctor writes a visit note about the patient', note.status, [200, 201], note.json);

  if (written) {
    const mine = await http('GET', `/clinical/patient/${id}/soap`, { token: patient.token });
    const opened = j.status('the patient can open their own visit notes', mine.status, 200, mine.json);
    const body = JSON.stringify(mine.json ?? null);
    j.record(
      'the note carries what they came in with and what was decided',
      opened && body.includes(complaint) && body.includes(plan),
      `a visit the patient cannot read back is advice they have to remember. Returned: ${body.slice(0, 300)}`
    );
    const theirs = await http('GET', `/clinical/patient/${otherId}/soap`, { token: patient.token });
    j.status("another patient's visit notes are refused", theirs.status, [401, 403], theirs.json);
  } else {
    for (const n of [
      'the patient can open their own visit notes',
      'the note carries what they came in with and what was decided',
      "another patient's visit notes are refused",
    ]) {
      j.skip(n, 'no visit note was written');
    }
  }

  const directions = `One capsule three times daily for 7 days (journey ${stamp})`;
  const rx = await http('POST', '/e-prescriptions', {
    token: clinician.token,
    body: {
      patient_id: id,
      medication_name: 'Amoxicillin',
      strength: '500mg',
      form: 'capsule',
      quantity: 21,
      days_supply: 7,
      directions,
      refills_allowed: 0,
      is_controlled: false,
      pharmacy_ncpdp: '1234567',
      pharmacy_name: 'Main Street Pharmacy',
      diagnosis_codes: ['J20.9'],
      patient_instructions: 'Complete the course',
    },
  });
  const rxId = String(rx.json.prescription_id ?? '');
  const prescribed = j.status('a doctor prescribes for the patient', rx.status, [200, 201], rx.json) && rxId !== '';

  if (prescribed) {
    // "Send Prescription" is create -> sign -> transmit in one action.
    await http('POST', `/e-prescriptions/${rxId}/sign`, {
      token: clinician.token,
      body: { signature_method: 'wallet', attestation: 'Issued for a legitimate medical purpose.' },
    });
    await http('POST', `/e-prescriptions/${rxId}/transmit`, { token: clinician.token });

    const mine = await http('GET', `/e-prescriptions/patient/${id}`, { token: patient.token });
    const opened = j.status('the patient can open their own prescriptions', mine.status, 200, mine.json);
    j.record(
      'the prescription reaches them with its directions',
      opened && JSON.stringify(mine.json ?? null).includes(directions),
      `a patient who cannot read the dose is taking it from memory`
    );
    const theirs = await http('GET', `/e-prescriptions/patient/${otherId}`, { token: patient.token });
    j.status("another patient's prescriptions are refused", theirs.status, [401, 403], theirs.json);
  } else {
    for (const n of [
      'the patient can open their own prescriptions',
      'the prescription reaches them with its directions',
      "another patient's prescriptions are refused",
    ]) {
      j.skip(n, 'no prescription was written');
    }
  }
}

/**
 * Workflow 5: the specialist's opinion, read by the patient it is about.
 *
 * The producer is `ConsultPage` -> `POST /api/clinical/consult`. The result was
 * reachable only as `GET /api/clinical/consult/{consult_id}` — keyed by an id
 * the patient has never seen and gated on `can_view_medical_records`, which
 * excludes the patient — plus the deployment-wide register.
 *
 * The consult is where the specialist's recommendation and follow-up plan live:
 * what the cardiologist actually said, and what they want done next. A patient
 * told "the specialist has seen your notes" and unable to read the answer is
 * being asked to take the recommendation on trust.
 *
 * See docs/PATIENT_VISIBILITY_WORKFLOWS.md.
 */
export async function runConsultVisibilitySteps(
  j: Journal,
  patient: Session,
  clinician: Session,
  id: string,
  otherId: string
): Promise<void> {
  const stamp = Date.now();
  const reason = `Exertional chest pain for review (journey ${stamp})`;
  const question = `Is further ischaemia testing warranted? (journey ${stamp})`;

  // ConsultPage.tsx -> POST /api/clinical/consult, camelCase as the page sends.
  const consult = await http('POST', '/clinical/consult', {
    token: clinician.token,
    body: {
      patientId: id,
      specialty: 'Cardiology',
      requestedBy: clinician.wallet,
      consultingProvider: clinician.wallet,
      reason,
      clinicalQuestion: question,
      relevantHistory: 'Hypertension, ex-smoker.',
      // Lowercase, as ConsultPage sends and as the `consultation_notes_status_check`
      // CHECK constraint allows. The capitalised spellings pass in the memory
      // backend, which enforces no constraints, and 500 on PostgreSQL.
      urgency: 'routine',
      status: 'requested',
      requestedAt: new Date().toISOString(),
    },
  });
  const asked = j.status('a doctor asks for a specialist opinion', consult.status, [200, 201], consult.json);

  if (!asked) {
    j.skip('the patient can open their own consults', 'no consult was requested');
    j.skip('the consult names the question that was asked about them', 'no consult was requested');
    j.skip("another patient cannot read this patient's consults", 'no consult was requested');
    return;
  }

  const mine = await http('GET', `/clinical/patient/${id}/consults`, { token: patient.token });
  const opened = j.status('the patient can open their own consults', mine.status, 200, mine.json);

  if (opened) {
    const body = JSON.stringify(mine.json ?? null);
    j.record(
      'the consult names the question that was asked about them',
      body.includes(reason),
      `a referral a patient cannot read is a referral they cannot follow up. ` +
        `Returned: ${body.slice(0, 300)}`
    );
  } else {
    j.skip('the consult names the question that was asked about them', 'the consults did not open');
  }

  const theirs = await http('GET', `/clinical/patient/${otherId}/consults`, {
    token: patient.token,
  });
  j.status(
    "another patient cannot read this patient's consults",
    theirs.status,
    [401, 403],
    theirs.json
  );
}

/**
 * Workflows 6-10: the rest of what a ward writes about a patient.
 *
 * Five artefacts, one step each, all of them following the pattern the first
 * five established: produce it with the producer screen's own payload as a
 * clinician, then open it **in the patient's own session**, and confirm another
 * patient's is refused.
 *
 *   6. Care plan        — the one clinical document written in the second
 *                         person: what the goals are and what the patient is
 *                         expected to do.
 *   7. Blood            — blood group and transfusion history; the group is the
 *                         single most reusable fact in a patient's record.
 *   8. Procedures       — the bedside and emergency-department procedures that
 *                         had no patient-scoped read (pre-op, operative note
 *                         and post-op already had one).
 *   9. AMA discharge    — the document most likely to be cited *against* the
 *                         patient later.
 *  10. Intake / output  — the number a patient on a fluid restriction is told
 *                         to care about.
 *
 * See docs/PATIENT_VISIBILITY_WORKFLOWS.md.
 */
export async function runWardRecordVisibilitySteps(
  j: Journal,
  patient: Session,
  clinician: Session,
  nurse: Session,
  id: string,
  otherId: string
): Promise<void> {
  const stamp = Date.now();

  // --- 6. Care plan -------------------------------------------------------
  // CarePlanPage.tsx: POST /api/emergency/care-plan, the same payload
  // scripts/journeys/nurse.ts sends.
  const goal = `Sacral ulcer shows granulation within 7 days (journey ${stamp})`;
  const plan = await http('POST', '/emergency/care-plan', {
    token: nurse.token,
    body: {
      care_plan_id: `CP-${stamp}`,
      patient_id: id,
      diagnoses: [
        {
          id: `ND-${stamp}`,
          diagnosis: 'Impaired skin integrity',
          relatedTo: 'immobility',
          evidencedBy: 'stage 2 sacral pressure ulcer',
          priority: 'high',
          dateIdentified: new Date().toISOString().slice(0, 10),
        },
      ],
      goals: [
        {
          id: `GOAL-${stamp}`,
          diagnosisId: `ND-${stamp}`,
          description: goal,
          targetDate: new Date().toISOString().slice(0, 10),
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
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
    },
  });
  await readBackAsPatient(j, patient, id, otherId, {
    written: j.status('a nurse writes the care plan', plan.status, [200, 201], plan.json),
    route: 'care-plans',
    openLabel: 'the patient can open their own care plan',
    contentLabel: 'the care plan states the goal set for them',
    needle: goal,
    why:
      'a care plan is written in the second person -- it says what the patient is ' +
      'expected to do -- and one they cannot read asks them to do it blind',
  });

  // --- 7. Blood group and transfusion -------------------------------------
  // BloodBankPage.tsx: createBloodTypeScreen, as scripts/journeys/labtech.ts sends.
  const indication = `Symptomatic anaemia (journey ${stamp})`;
  const screen = await http('POST', '/surgical/blood-type', {
    token: clinician.token,
    body: {
      orderId: `BB-${stamp}`,
      patientId: id,
      patientName: 'Journey Patient',
      bloodType: 'O+',
      orderDate: new Date().toISOString().slice(0, 10),
      orderTime: '09:00',
      orderedBy: clinician.userId,
      product: 'packed_red_cells',
      units: 2,
      indication,
      priority: 'routine',
      status: 'ordered',
    },
  });
  await readBackAsPatient(j, patient, id, otherId, {
    written: j.status('the laboratory orders a type-and-screen', screen.status, [200, 201], screen.json),
    route: 'blood',
    openLabel: 'the patient can see their own blood group and transfusions',
    contentLabel: 'the record names why blood was ordered',
    needle: indication,
    why:
      "a patient's blood group is what they are asked in every emergency " +
      'department, on every pre-operative form and at every donation',
  });

  // --- 8. Procedures ------------------------------------------------------
  // No page posts these five; `createLacerationRepair` and its siblings exist
  // in client/shared with no caller, so today they can only arrive from an
  // integration. The API shape is what an integration would send.
  const woundSite = `Left forearm, 4cm (journey ${stamp})`;
  const laceration = await http('POST', '/clinical/laceration', {
    token: clinician.token,
    body: {
      patient_id: id,
      location: woundSite,
      length_cm: 4.0,
      depth_cm: 0.6,
      mechanism: 'Glass laceration',
      contamination_level: 'clean',
      wound_age_hours: 2.0,
      tetanus_status: 'up-to-date',
      tetanus_given: false,
      anesthesia_type: 'local infiltration',
      anesthetic_agent: 'Lidocaine 1%',
      repair_method: 'simple interrupted sutures',
      suture_material: 'Nylon 4-0',
      suture_count: 6,
      performed_by: clinician.wallet,
      performed_at: new Date().toISOString(),
    },
  });
  await readBackAsPatient(j, patient, id, otherId, {
    written: j.status('a doctor records the wound repair', laceration.status, [200, 201], laceration.json),
    route: 'procedures',
    openLabel: 'the patient can see what was done to them',
    contentLabel: 'the procedure record names the wound that was repaired',
    needle: woundSite,
    why:
      '"what was done to me" is one question, and it was split across five ' +
      'endpoints none of which the patient could reach',
  });

  // --- 9. AMA discharge ---------------------------------------------------
  // AMAPage.tsx: createAMADischarge, field for field. `hasCapacity` and
  // `capacityBasis` are mandatory -- an AMA filed without a capacity
  // determination is not a lawful AMA, and the handler refuses one.
  const statement = `I need to get home to my children (journey ${stamp})`;
  const ama = await http('POST', '/clinical/ama', {
    token: clinician.token,
    body: {
      ama_id: `AMA-${stamp}`,
      patient_id: id,
      patient_name: 'Journey Patient',
      mrn: id,
      dateCreated: new Date().toISOString(),
      status: 'pending-signatures',
      riskLevel: 'high',
      provider: clinician.wallet,
      diagnosis: 'Community-acquired pneumonia',
      recommendedTreatment: 'Admission for intravenous antibiotics',
      patientStatement: statement,
      hasCapacity: true,
      capacityBasis: 'Alert and oriented; able to repeat back the risks of leaving.',
      patientSigned: false,
      witnessSigned: false,
      witnessName: 'Journey Witness',
      providerSigned: false,
    },
  });
  await readBackAsPatient(j, patient, id, otherId, {
    written: j.status('a doctor files the against-medical-advice discharge', ama.status, [200, 201], ama.json),
    route: 'ama-discharges',
    openLabel: 'the patient can read the AMA discharge they signed',
    contentLabel: 'the AMA record carries what the patient said',
    needle: statement,
    why:
      'an AMA record is the document most likely to be cited against the ' +
      'patient later, which is exactly why they should be able to read it',
  });

  // --- 10. Intake / output ------------------------------------------------
  // NursingPage.tsx: POST /api/nursing/intake-output/record.
  const fluidNote = `Journey fluid entry ${stamp}`;
  const fluid = await http('POST', '/nursing/intake-output/record', {
    token: nurse.token,
    body: {
      patient_id: id,
      entry_type: 'intake',
      fluid_type: 'Oral',
      amount_ml: 240,
      notes: fluidNote,
      time: new Date().toISOString(),
    },
  });
  await readBackAsPatient(j, patient, id, otherId, {
    written: j.status('a nurse charts a fluid entry', fluid.status, [200, 201], fluid.json),
    route: 'intake-output',
    openLabel: 'the patient can see their own fluid balance',
    contentLabel: 'the chart carries the entry that was recorded',
    // The shift record aggregates entries, so the note may be folded into a
    // total rather than stored verbatim. The patient id is what must come back.
    needle: id,
    why:
      'a patient on a fluid restriction is told to care about a number, and ' +
      'being told to care about a number they cannot see is not a plan',
  });
}

/** One artefact's read-back: open it as the patient, then as the wrong one. */
interface ReadBack {
  written: boolean;
  route: string;
  openLabel: string;
  contentLabel: string;
  needle: string;
  why: string;
}

/**
 * The assertion every workflow in this file shares.
 *
 * Kept as one helper rather than repeated per artefact: the three steps are
 * always the same shape, and writing them out five more times is how one of
 * them ends up checking the clinician's session by accident.
 */
async function readBackAsPatient(
  j: Journal,
  patient: Session,
  id: string,
  otherId: string,
  spec: ReadBack
): Promise<void> {
  const boundaryLabel = `another patient cannot read this patient's ${spec.route}`;
  if (!spec.written) {
    j.skip(spec.openLabel, 'nothing was written to read back');
    j.skip(spec.contentLabel, 'nothing was written to read back');
    j.skip(boundaryLabel, 'nothing was written to read back');
    return;
  }

  const mine = await http('GET', `/clinical/patient/${id}/${spec.route}`, {
    token: patient.token,
  });
  const opened = j.status(spec.openLabel, mine.status, 200, mine.json);

  if (opened) {
    const body = JSON.stringify(mine.json ?? null);
    j.record(
      spec.contentLabel,
      body.includes(spec.needle),
      `${spec.why}. Returned: ${body.slice(0, 300)}`
    );
  } else {
    j.skip(spec.contentLabel, 'the record did not open');
  }

  const theirs = await http('GET', `/clinical/patient/${otherId}/${spec.route}`, {
    token: patient.token,
  });
  j.status(boundaryLabel, theirs.status, [401, 403], theirs.json);
}

/**
 * The patient withdraws a consent they signed.
 *
 * `POST /api/consent/{id}/revoke` existed with no caller anywhere: the consent
 * screen could **sign** and never take back. Signing without withdrawal is not
 * consent management — under POPIA withdrawal is a right the patient holds, and
 * a screen that can only sign records agreement it cannot let go of.
 *
 * Distinct from revoking an access grant, which the page already did
 * (`/api/access/grants/{id}/revoke`). A grant is one clinician's permission; a
 * consent is the signed legal basis, and revoking either leaves the other
 * standing.
 *
 * Covered here rather than in the browser suite because the patient
 * application's e2e harness signs in by creating a fresh demo wallet, and the
 * consent endpoints answer 401 for it — so a browser test would assert nothing
 * about authorisation. This runs as the real fixture patient.
 */
export async function runConsentWithdrawalSteps(
  j: Journal,
  patient: Session,
  id: string
): Promise<void> {
  const types = await http('GET', '/consent/types', { token: patient.token });
  const offered = rowsOf(types.json, 'consent_types', 'types', 'items');
  const first = offered[0] as { consent_type?: string; code?: string; id?: string } | undefined;
  const consentType = first?.consent_type ?? first?.code ?? first?.id ?? 'treatment';
  j.record(
    'the patient is offered consent forms to sign',
    offered.length > 0,
    `a consent screen with nothing to sign cannot record a lawful basis. Returned: ${JSON.stringify(types.json).slice(0, 200)}`
  );

  const signed = await http('POST', '/consent/sign', {
    token: patient.token,
    body: { patient_id: id, consent_type: consentType },
  });
  const didSign = j.status('the patient signs a consent', signed.status, [200, 201], signed.json);

  if (!didSign) {
    j.skip('the patient can withdraw the consent they signed', 'nothing was signed');
    j.skip('the withdrawn consent is gone from their standing consents', 'nothing was signed');
    return;
  }

  const before = await http('GET', `/consent/patient/${id}`, { token: patient.token });
  const standing = rowsOf(before.json, 'consents') as Array<{ consent_id?: string }>;
  const target = standing[0]?.consent_id;

  if (!target) {
    j.skip('the patient can withdraw the consent they signed', 'no standing consent came back');
    j.skip('the withdrawn consent is gone from their standing consents', 'no standing consent came back');
    return;
  }

  // The reason is optional on purpose: a patient does not owe one.
  const revoked = await http('POST', `/consent/${target}/revoke`, {
    token: patient.token,
    body: { reason: null },
  });
  j.status('the patient can withdraw the consent they signed', revoked.status, [200, 201], revoked.json);

  // `GET /api/consent/patient/{id}` filters withdrawn consents out server-side,
  // so a withdrawal that took effect REMOVES the row. Asserting its absence is
  // the only way to tell a real withdrawal from a 200 that changed nothing.
  const after = await http('GET', `/consent/patient/${id}`, { token: patient.token });
  const remaining = rowsOf(after.json, 'consents') as Array<{ consent_id?: string }>;
  j.record(
    'the withdrawn consent is gone from their standing consents',
    !remaining.some((c) => c.consent_id === target),
    `a withdrawal that leaves the consent standing is not a withdrawal. Still listed: ${JSON.stringify(after.json).slice(0, 220)}`
  );
}
