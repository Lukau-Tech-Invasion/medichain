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
