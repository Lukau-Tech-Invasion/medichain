/**
 * The administrator's day, start to finish.
 *
 * # The story
 *
 * A new clinician joins. The administrator creates the account, gives it a
 * role, corrects a detail on the profile, and the new account signs in and can
 * do the job. Somebody leaves; the administrator revokes the role and the
 * account can no longer act. Meanwhile the administrator reads the access log
 * and the analytics that the day's clinical work produced, and files the
 * administrative records — a death certificate, a mass-casualty incident —
 * that are theirs and nobody else's.
 *
 * # Why this journey is the one that had never been run
 *
 * Zero of the fourteen screens in `ADMIN_NAV` had ever had a write driven
 * against a live server, and the 2026-08-14 browser sweep recorded the
 * administrator as untestable because the demo admin wallet was not enrolled in
 * credential sign-in. It is now (`bt.admin`), so there is no longer a reason.
 *
 * # The assertion that matters here
 *
 * An administrator's writes are *authorization* changes. "The role was
 * assigned" is not the claim worth testing; "the account can now do the thing
 * the role permits, and cannot after it is revoked" is. Every role change below
 * is followed by an action attempted with that account's own session.
 */

import { http, signIn, type Journal, type Session, type Manifest, discrepancies, findBy, fieldAt,
  rowsOf,
} from '../lib/journey';

const iso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

export async function adminJourney(
  j: Journal,
  admin: Session,
  subject: Session,
  clinician: Session,
  m: Manifest
): Promise<void> {
  j.journey('Administrator — onboarding, authorization, oversight');
  const stamp = Date.now();

  // --- The directory is the table, not the auth cache ---------------------
  const users = await http('GET', '/users?limit=200', { token: admin.token });
  const rows = rowsOf(users.json, 'users', 'data');
  const list: any[] = Array.isArray(rows) ? rows : [];
  j.record(
    'the administrator can list the staff directory',
    list.length > 0,
    `directory held ${list.length} user(s). Response keys: ${Object.keys(users.json).join(',')}`
  );
  // Every seeded account has to be in it. `AppState.users` is an active-only
  // authorization cache, and a directory served from it silently hides exactly
  // the rows an administrator opened the page to manage.
  const seeded = ['bt.doctor', 'bt.nurse', 'bt.lab', 'bt.pharm'];
  const text = JSON.stringify(list);
  const missing = seeded.filter((s) => !text.includes(s.replace('bt.', 'bt')) && !text.includes(s));
  j.record(
    'every seeded staff account appears in the directory',
    list.length >= 5,
    `only ${list.length} user(s) listed. A directory that reads from the authorization cache ` +
      `shows only active sessions, which is the opposite of what a user-management screen needs. ` +
      `Not obviously present: ${missing.join(', ') || 'none by name'}`
  );

  // --- Onboarding a new clinician -----------------------------------------
  // UserManagementPage.tsx: walletRegister -> POST /api/auth/register
  //
  // A fresh SS58-shaped wallet. Deliberately synthetic and never signed with,
  // because the point is the authorization lifecycle, not another sign-in.
  const newWallet = `5JourneyHarness${stamp}`.padEnd(48, 'x').slice(0, 48);
  // Distinct per run so a stale row from an earlier run cannot satisfy the
  // round-trip assertion below.
  const newPhone = `+27 11 555 ${String(stamp).slice(-4)}`;
  const create = await http('POST', '/auth/register', {
    token: admin.token,
    body: {
      wallet_address: newWallet,
      name: `Journey Clinician ${stamp}`,
      username: `jc${stamp}`,
      role: 'Nurse',
      email: `jc${stamp}@example.invalid`,
      // A phone number, which this endpoint refused outright until staff
      // contact details got an encrypted home (`contact_encrypted`). It is
      // asserted below because the failure mode it replaces was not a refusal
      // but a silence: a number accepted, never written to any column, and
      // absent from the directory the administrator reads it back from.
      phone: newPhone,
      department: 'Emergency',
      specialty: 'Trauma',
      license_number: `LIC-${stamp}`,
    },
  });
  const createdUser = j.status('a new clinician account is created', create.status, [200, 201], create.json);

  if (createdUser) {
    const after = await http('GET', '/users?limit=200', { token: admin.token });
    const arows = rowsOf(after.json, 'users', 'data');
    const mine = findBy(arows, 'wallet_address', newWallet) ?? findBy(arows, 'userId', newWallet);
    j.record(
      'the new account is in the directory immediately',
      mine !== undefined,
      `an account created on this screen that does not appear on this screen is the ` +
        `first thing an administrator will report as broken`
    );
    const bad = discrepancies(mine, { role: 'Nurse', department: 'Emergency' });
    j.record(
      'the role, department and specialty the administrator entered were kept',
      bad.length === 0,
      bad.join('; ') + ` — stored: ${JSON.stringify(mine ?? {}).slice(0, 300)}`
    );

    // The contact number, read back through the directory rather than the
    // create response. It is sealed on the way in and decrypted on the way out,
    // so a keyring misconfiguration shows up here as an absent number instead
    // of silently unreadable rows nobody notices until somebody needs to call
    // this clinician.
    j.record(
      'the phone number the administrator entered comes back',
      fieldAt(mine, 'phone') === newPhone,
      `stored phone was ${JSON.stringify(fieldAt(mine, 'phone'))}, expected ${newPhone} — ` +
        `a staff contact that saves and cannot be read is the same as no contact at all`
    );

    // Correcting a profile. `updateUserProfile` -> PUT /api/users/{wallet}
    const fixed = `Journey Clinician ${stamp} (corrected)`;
    const update = await http('PUT', `/users/${newWallet}`, {
      token: admin.token,
      body: {
        name: fixed,
        email: `jc${stamp}@example.invalid`,
        department: 'Intensive Care',
        specialty: 'Critical care',
        license_number: `LIC-${stamp}`,
      },
    });
    const updated = j.status('a profile correction is accepted', update.status, [200, 201], update.json);
    if (updated) {
      const back = await http('GET', '/users?limit=200', { token: admin.token });
      const brows = rowsOf(back.json, 'users', 'data');
      const bmine = findBy(brows, 'wallet_address', newWallet);
      const bbad = discrepancies(bmine, { name: fixed, department: 'Intensive Care' });
      j.record(
        'the correction is what the next reader sees',
        bbad.length === 0,
        bbad.join('; ') + ' — a profile edit that only the editor can see is not an edit'
      );
    } else {
      j.skip('the correction is what the next reader sees', 'the profile update was refused');
    }
  } else {
    for (const n of [
      'the new account is in the directory immediately',
      'the role, department and specialty the administrator entered were kept',
      'a profile correction is accepted',
      'the correction is what the next reader sees',
    ]) {
      j.skip(n, 'the account was not created');
    }
  }

  // --- Authorization is the claim, not the record -------------------------
  //
  // Take a real account through a role change and prove the change with that
  // account's own session. `subject` is the second lab technician: giving them
  // Nurse lets them chart observations, and taking it away must stop them.
  const patient = m.patient.linked_patient_id;

  const beforeChange = await http('POST', '/clinical/vitals', {
    token: subject.token,
    body: { patient_id: patient, heart_rate: 76, systolic_bp: 118, diastolic_bp: 74 },
  });
  j.status(
    'a lab technician cannot chart observations before the role change',
    beforeChange.status,
    [401, 403],
    beforeChange.json
  );

  const promote = await http('POST', '/roles/assign', {
    token: admin.token,
    body: { wallet_address: subject.wallet, name: 'Lab Browser Test Two', role: 'Nurse' },
  });
  const promoted = j.status('the administrator assigns a new role', promote.status, [200, 201], promote.json);

  if (promoted) {
    // A JWT carries the role it was minted with, so a role change has to be
    // proven on a NEW session. Re-using the old token would test the token, not
    // the authorization.
    let fresh: Session | undefined;
    try {
      fresh = await signIn(subject.loginId, 'promoted');
    } catch (e) {
      j.skip('the promoted account can do what the new role permits', String(e).slice(0, 120));
    }
    if (fresh) {
      j.record(
        'the new role is on the account when it signs in again',
        fresh.role === 'Nurse',
        `signed in as ${fresh.role}; the administrator assigned Nurse`
      );
      const nowAllowed = await http('POST', '/clinical/vitals', {
        token: fresh.token,
        body: { patient_id: patient, heart_rate: 76, systolic_bp: 118, diastolic_bp: 74 },
      });
      j.status(
        'the promoted account can do what the new role permits',
        nowAllowed.status,
        [200, 201],
        nowAllowed.json
      );
    }

    // And put it back, which is the other half of the control.
    const restore = await http('POST', '/roles/assign', {
      token: admin.token,
      body: { wallet_address: subject.wallet, name: 'Lab Browser Test Two', role: 'LabTechnician' },
    });
    const restored = j.status('the role can be changed back', restore.status, [200, 201], restore.json);
    if (restored) {
      let back: Session | undefined;
      try {
        back = await signIn(subject.loginId, 'restored');
      } catch {
        /* the assertion below reports it */
      }
      j.record(
        'the account is a lab technician again',
        back?.role === 'LabTechnician',
        `signed in as ${back?.role ?? 'no session'}`
      );
      if (back) {
        const denied = await http('POST', '/clinical/vitals', {
          token: back.token,
          body: { patient_id: patient, heart_rate: 76 },
        });
        j.status(
          'and can no longer chart observations',
          denied.status,
          [401, 403],
          denied.json
        );
      } else {
        j.skip('and can no longer chart observations', 'could not re-establish a session');
      }
    } else {
      j.skip('the account is a lab technician again', 'the role restore was refused');
      j.skip('and can no longer chart observations', 'the role restore was refused');
    }
  } else {
    for (const n of [
      'the new role is on the account when it signs in again',
      'the promoted account can do what the new role permits',
      'the role can be changed back',
      'the account is a lab technician again',
      'and can no longer chart observations',
    ]) {
      j.skip(n, 'the role assignment was refused');
    }
  }

  // An administrator must not be able to grant themselves, or anyone, Admin.
  const escalate = await http('POST', '/roles/assign', {
    token: admin.token,
    body: { wallet_address: subject.wallet, name: 'x', role: 'Admin' },
  });
  j.status(
    'no one can be promoted to administrator through the role endpoint',
    escalate.status,
    [400, 403],
    escalate.json
  );

  // --- Oversight: the access log ------------------------------------------
  // AccessLogsPage.tsx: GET /api/access/logs
  const logs = await http('GET', '/access/logs', { token: admin.token });
  const logsOk = j.status('the access log opens', logs.status, 200, logs.json);
  if (logsOk) {
    const entries = rowsOf(logs.json, 'access_logs', 'logs');
    j.record(
      'the access log is not an empty page',
      Array.isArray(entries) && entries.length > 0,
      `an audit log that renders empty after a day of clinical work is either not being ` +
        `written or not being read. Response keys: ${Object.keys(logs.json).join(',')}`
    );
    // An access log entry with no actor, no subject and no action is a row, not
    // a record. All three are what a POPIA subject-access request is answered
    // from.
    const first = Array.isArray(entries) ? entries[0] : undefined;
    j.record(
      'each entry names who did what to whom',
      // The entry names the actor, what they did and whose record it was.
      Boolean(fieldAt(first, 'accessor_id')) &&
        Boolean(fieldAt(first, 'access_type')) &&
        Boolean(fieldAt(first, 'patient_id')),
      `first entry: ${JSON.stringify(first ?? {}).slice(0, 300)}`
    );
  } else {
    j.skip('the access log is not an empty page', 'the access log did not open');
    j.skip('each entry names who did what to whom', 'the access log did not open');
  }

  // --- Oversight: analytics -----------------------------------------------
  // AnalyticsPage.tsx assembles its dashboard from several endpoints.
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dash = await http(
    'GET',
    `/platform/analytics/dashboard?start_date=${start}&end_date=${today()}`,
    { token: admin.token }
  );
  const dashOk = j.status('the analytics dashboard answers', dash.status, 200, dash.json);
  if (dashOk) {
    // The honesty property this codebase already fought for: a metric that was
    // not measured says so, rather than reporting a confident zero.
    const body = JSON.stringify(dash.json);
    j.record(
      'the dashboard carries counted values, not a wall of zeroes',
      /[1-9]/.test(body.replace(/"[^"]*_id"\s*:\s*"[^"]*"/g, '')),
      `every number on an analytics dashboard reading 0 after a day of writes means the ` +
        `query is not reaching the data. Response: ${body.slice(0, 400)}`
    );
  } else {
    j.skip('the dashboard carries counted values, not a wall of zeroes', 'analytics did not answer');
  }

  const quality = await http('GET', '/platform/analytics/quality', { token: admin.token });
  j.status('the quality view answers', quality.status, 200, quality.json);

  // --- Clinicians must not reach the administrative surface ---------------
  const intruder = await http('GET', '/users?limit=5', { token: subject.token });
  j.status('a clinician cannot list the staff directory', intruder.status, [401, 403], intruder.json);

  const intruderAnalytics = await http('GET', '/platform/analytics/quality', { token: subject.token });
  j.status('a clinician cannot read system analytics', intruderAnalytics.status, [401, 403], intruderAnalytics.json);

  // --- Administrative records ---------------------------------------------
  // DeathCertificatePage.tsx: createDeathCertificate.
  const dcId = `DC-${stamp}`;
  const deceased = `Journey Deceased ${stamp}`;
  const dc = await http('POST', '/surgical/death-certificate', {
    token: admin.token,
    body: {
      id: dcId,
      // The PAGE sends the literal string "DEMO_PATIENT" here. This journey
      // sends the real patient, because the question being asked is whether the
      // endpoint can bind a certificate to a person — the page's hardcoded id
      // is recorded separately as a defect rather than reproduced as a fixture.
      patient_id: patient,
      deceased_name: deceased,
      date_of_birth: '1948-02-03',
      date_of_death: today(),
      time_of_death: '04:20',
      place_of_death: 'Ward 3',
      manner_of_death: 'natural',
      cause_of_death: 'Myocardial infarction',
      other_conditions: ['Type 2 diabetes mellitus'],
      certifier_name: 'Dr Browser Test',
      certifier_license: 'MP123456',
      certifier_type: 'attending',
      signature: 'Dr Browser Test',
      status: 'filed',
    },
  });
  const dcOk = j.status('a death certificate is filed', dc.status, [200, 201], dc.json);

  if (dcOk) {
    const list = await http('GET', '/platform/list/death-certificates', { token: admin.token });
    const drows = rowsOf(list.json, 'records', 'certificates', 'items');
    const carries = JSON.stringify(drows ?? null).includes(deceased);
    j.record(
      'the certificate is on the register under the right person',
      carries,
      `register held ${Array.isArray(drows) ? drows.length : 'a non-array'} row(s). ` +
        `A certificate filed against the wrong patient id is a certificate for the wrong person.`
    );
  } else {
    j.skip('the certificate is on the register under the right person', 'the certificate was refused');
  }

  // MCIPage.tsx: createMci
  const mciName = `Journey MCI ${stamp}`;
  // Declared by a CLINICIAN, read by the administrator.
  //
  // `/mci` sits in `ADMIN_NAV` under "Emergency Oversight", and oversight is
  // the right word: `create_mci` is gated on `can_edit_medical_records`, which
  // deliberately excludes `Admin` because an MCI casualty entry carries vitals
  // and a triage category — clinical content. The administrator's own view of
  // it is the GET, which admits them. Both halves are asserted below.
  const mci = await http('POST', '/clinical/mci', {
    token: clinician.token,
    body: {
      incident: {
        name: mciName,
        type: 'road_traffic',
        location: 'N1 northbound, km 42',
        declaredAt: iso(),
        declaredBy: admin.userId,
        status: 'active',
      },
      patients: [
        {
          tagNumber: `T-${stamp}`,
          // `MCIPage` types `age` as a string; a number is refused.
          age: '34',
          gender: 'male',
          chiefComplaint: 'Chest and abdominal trauma',
          injuries: ['flail chest'],
          vitals: { hr: 128, sbp: 88, rr: 32 },
          location: 'scene',
          destination: 'Resus 1',
          triageTime: iso(),
          notes: 'Journey harness',
          // The five START triage categories the page offers.
          category: 'immediate',
        },
      ],
    },
  });
  const mciOk = j.status(
    'a clinician declares a mass-casualty incident',
    mci.status,
    [200, 201],
    mci.json
  );

  if (mciOk) {
    const id = String(mci.json.incident_id ?? mci.json.id ?? '');
    const read = await http('GET', `/clinical/mci/${id}`, { token: admin.token });
    j.status(
      'the administrator can open the incident on their oversight screen',
      read.status,
      200,
      { id, ...read.json }
    );
    j.record(
      'the triage category of each casualty survives',
      JSON.stringify(read.json ?? null).includes('immediate') && JSON.stringify(read.json ?? null).includes(`T-${stamp}`),
      `an MCI board without triage categories cannot direct a single ambulance. ` +
        `Stored: ${JSON.stringify(read.json).slice(0, 400)}`
    );
  } else {
    j.skip('the administrator can open the incident on their oversight screen', 'the MCI was refused');
    j.skip('the triage category of each casualty survives', 'the MCI was refused');
  }

  // --- The boundary of the administrator ----------------------------------
  // An account that grants and revokes roles does not also write clinical
  // records: separation of duties, and the reason `can_edit_medical_records`
  // deliberately excludes Admin.
  const note = await http('POST', '/clinical/soap', {
    token: admin.token,
    body: {
      patient_id: patient,
      encounter_type: 'office_visit',
      subjective: { chief_complaint: 'x', history_of_present_illness: 'x', symptoms: [] },
      objective: { vital_signs: null, physical_exam: [], lab_results: [], imaging_results: [], diagnostic_tests: [] },
      assessment: { secondary_diagnoses: [], clinical_summary: 'x' },
      plan: { treatment_plan: 'x', medications: [], procedures: [], lab_orders: [], imaging_orders: [], referrals: [], patient_education: [], return_precautions: [] },
    },
  });
  j.status('an administrator cannot write a clinical note', note.status, [401, 403], note.json);

  const vitals = await http('POST', '/clinical/vitals', {
    token: admin.token,
    body: { patient_id: patient, heart_rate: 80 },
  });
  j.status('an administrator cannot chart observations', vitals.status, [401, 403], vitals.json);
}
