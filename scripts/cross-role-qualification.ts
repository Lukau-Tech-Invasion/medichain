/**
 * Cross-role authorization and clinical-workflow qualification.
 *
 * # Why this exists
 *
 * `docs/CAMPAIGN_REPORT_2026-08-26.md` closed with four of seven personas never
 * exercised and every cross-role clinical workflow unproven. The blocker was
 * fixtures: Pharmacist and LabTechnician had no accounts, so no probe could
 * even sign in as them. That is fixed
 * (`scripts/seed-browser-test-fixtures.ts`), and this is what the fixtures were
 * for.
 *
 * # What it proves, and what it deliberately does not
 *
 * Every session here is obtained through the **real** credential flow — login
 * id and a proof derived from the password, `POST /api/auth/login`, bearer
 * token issued. No probe authenticates by asserting an identity, and section K
 * proves the API refuses one that tries to. A test that authenticated by
 * asserting an identity would prove nothing about a system whose whole point is
 * that it does not accept one.
 *
 * This is API-level proof. It is not browser proof: it says nothing about what
 * a clinician sees on screen, and the completion gates that ask for browser
 * evidence are not satisfied by it.
 *
 * # Safety
 *
 * Synthetic fixtures only, read from `.browser-test/fixtures.json`. It refuses
 * to run against anything but a local endpoint.
 *
 * # Running it
 *
 *   cd client
 *   MEDICHAIN_API_URL=http://127.0.0.1:8090/api \
 *   ./node_modules/.bin/vite-node ../scripts/cross-role-qualification.ts
 */

import { deriveAuthProof } from './lib/auth';
import { PASSWORD, loadManifest, passwordFor, type Manifest, type PatientFixture } from './lib/journey';

const API = process.env.MEDICHAIN_API_URL ?? 'http://127.0.0.1:8090/api';

type Json = Record<string, any>;

// ---------------------------------------------------------------------------
// Result accounting
// ---------------------------------------------------------------------------

interface Check {
  section: string;
  name: string;
  passed: boolean;
  /** A control correctly refusing us is not a product failure. */
  skipped?: boolean;
  detail: string;
}

const checks: Check[] = [];
/** Set when any sign-in was refused by a request rate limit this run. */
let sessionsRateLimited = false;
let section = 'unknown';

function record(name: string, passed: boolean, detail: string): void {
  checks.push({ section, name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${passed ? '' : `  -- ${detail}`}`);
}

/**
 * Record a check that could not run because a control correctly refused us.
 *
 * The API rate-limits requests per client address. Running this harness twice
 * inside a minute can legitimately exhaust it, and reporting that as a failure
 * would train a reader to ignore a red result caused by security working. A
 * skip is honest and keeps the suite re-runnable; it is deliberately NOT a
 * pass, so a section that never runs cannot be mistaken for one that did.
 */
function skip(name: string, reason: string): void {
  checks.push({ section, name, passed: false, skipped: true, detail: reason });
  console.log(`  SKIP  ${name}  -- ${reason}`);
}

/** Assert an exact HTTP status, reporting what actually came back when it differs. */
function expectStatus(name: string, got: number, want: number | number[], body?: Json): boolean {
  const wanted = Array.isArray(want) ? want : [want];
  const passed = wanted.includes(got);
  record(name, passed, `expected ${wanted.join(' or ')}, got ${got} ${JSON.stringify(body ?? {}).slice(0, 200)}`);
  return passed;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * A signed-in actor.
 *
 * `token` is a real bearer token from `POST /api/auth/login`. There is no
 * fallback: if a session cannot be established the run stops, because a probe
 * that silently degrades to an unauthenticated request reports "denied" for
 * the wrong reason.
 */
interface Session {
  label: string;
  role: string;
  /** `users.id`: the JWT `sub` and the value every actor column holds. */
  userId: string;
  loginId: string;
  token: string;
}

async function http(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (method !== 'GET') headers['Idempotency-Key'] = globalThis.crypto.randomUUID();

  // A transport failure is not a result. `fetch` rejects when the connection
  // never completes — which happened repeatedly while a heavy build saturated
  // this host — and reporting that as an authorization outcome would put a red
  // FAIL against a control that was never consulted. HTTP statuses, including
  // 4xx and 5xx, are answers and are returned unretried.
  let res: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      break;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  if (!res) {
    throw new Error(
      `transport failure after 3 attempts for ${method} ${path}: ${String(lastError)}`
    );
  }

  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* empty bodies are legitimate */
  }
  return { status: res.status, json };
}

/**
 * Thrown when a request rate limit refuses a sign-in.
 *
 * Distinguished from every other sign-in failure on purpose. The limiter is a
 * control doing its job, and running this harness twice inside a minute can
 * legitimately run into it. A section that could not obtain a session for that
 * reason is SKIPPED; one that could not obtain a session for any other reason
 * (a locked account included) has FAILED.
 */
class SignInRateLimited extends Error {
  constructor(loginId: string) {
    super(`sign-in rate limited for ${loginId}`);
    this.name = 'SignInRateLimited';
  }
}

/** The whole sign-in, exactly as the portals perform it. */
async function loginAs(loginId: string, password: string, label: string, role?: string): Promise<Session> {
  const authProof = await deriveAuthProof(password, loginId);
  const login = await http('POST', '/auth/login', {
    body: { identifier: loginId, auth_proof: authProof },
  });
  if (login.status === 429 && codeOf(login.json) !== 'ACCOUNT_LOCKED') {
    throw new SignInRateLimited(loginId);
  }
  if (login.status !== 200 || !login.json.access_token) {
    throw new Error(`login failed for ${loginId}: ${login.status} ${JSON.stringify(login.json)}`);
  }
  const user = (login.json.user ?? {}) as Json;
  return {
    label,
    role: String(role ?? user.role),
    userId: String(user.user_id),
    loginId,
    token: String(login.json.access_token),
  };
}

/** Sign in as a staff fixture. */
async function signIn(loginId: string, label: string): Promise<Session> {
  return loginAs(loginId, passwordFor(loginId), label);
}

/**
 * Sign in as a patient.
 *
 * A patient signs in with the username they chose when they redeemed their
 * activation code. Without this, "the patient" could only ever be probed through
 * a clinician's session, which cannot show whether the patient's own boundary
 * holds.
 */
async function signInPatient(fx: PatientFixture, label: string): Promise<Session> {
  return loginAs(fx.login_id, passwordFor(fx.login_id), label, 'Patient');
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * Establish that every seeded role can actually authenticate.
 *
 * Run first and separately from the authorization probes: if a session cannot
 * be built, every later 403 would be indistinguishable from a correct denial.
 */
async function qualifySessions(m: Manifest): Promise<Record<string, Session>> {
  section = 'A. Authentication — every role, real credential flow';
  console.log(`\n${section}`);

  const wanted: Array<[string, string]> = [
    ['doctorA', 'bt.doctor'],
    ['doctorB', 'bt.doctor2'],
    ['nurse', 'bt.nurse'],
    ['pharmacist', 'bt.pharm'],
    ['pharmacist2', 'bt.pharm2'],
    ['labtech', 'bt.lab'],
    ['admin', 'bt.admin'],
  ];

  const sessions: Record<string, Session> = {};
  for (const [label, prefix] of wanted) {
    const fixture = m.staff.find((s) => s.login_id.startsWith(`${prefix}.`) || s.login_id === prefix);
    if (!fixture) {
      record(`${label} fixture exists`, false, `no fixture whose login_id starts with '${prefix}.'`);
      continue;
    }
    try {
      const s = await signIn(fixture.login_id, label);
      sessions[label] = s;
      record(`${label} (${s.role}) signs in and receives a bearer token`, true, '');
    } catch (e) {
      if (e instanceof SignInRateLimited) {
        sessionsRateLimited = true;
        skip(`${label} signs in`, 'sign-in rate limit — re-run after a minute');
      } else {
        record(`${label} signs in`, false, String(e));
      }
    }
  }
  return sessions;
}

/**
 * The role matrix: who may reach the administrative surface.
 *
 * Read-only probes, chosen so a wrong answer is a disclosure rather than a
 * mutation.
 */
async function qualifyRoleMatrix(sessions: Record<string, Session>): Promise<void> {
  section = 'B. Role matrix — administrative surface';
  console.log(`\n${section}`);

  const adminOnly = [
    ['/dashboard/admin', 'admin dashboard'],
    ['/users', 'staff directory'],
  ];

  for (const [path, what] of adminOnly) {
    for (const label of ['doctorA', 'nurse', 'pharmacist', 'labtech']) {
      const s = sessions[label];
      if (!s) continue;
      const r = await http('GET', path, { token: s.token });
      expectStatus(`${label} (${s.role}) is refused ${what}`, r.status, [401, 403], r.json);
    }
    const admin = sessions.admin;
    if (admin) {
      const r = await http('GET', path, { token: admin.token });
      expectStatus(`admin reaches ${what}`, r.status, 200, r.json);
    }
  }
}

/**
 * Role-specific clinical surfaces.
 *
 * These are the endpoints Pharmacist and LabTechnician exist for, and until
 * this pass nothing had ever called them as those roles.
 */
async function qualifyRoleSurfaces(sessions: Record<string, Session>): Promise<void> {
  section = 'C. Role-specific dashboards';
  console.log(`\n${section}`);

  if (sessions.pharmacist) {
    const r = await http('GET', '/dashboard/pharmacist', { token: sessions.pharmacist.token });
    expectStatus('pharmacist reaches the pharmacist dashboard', r.status, 200, r.json);
  }
  if (sessions.labtech) {
    const r = await http('GET', '/dashboard/lab', { token: sessions.labtech.token });
    expectStatus('lab technician reaches the lab dashboard', r.status, 200, r.json);
  }
  if (sessions.pharmacist) {
    // A pharmacist has no business signing off lab results.
    const r = await http('POST', '/lab/review', {
      token: sessions.pharmacist.token,
      body: { submission_id: 'LAB-DOES-NOT-EXIST', action: 'approve' },
    });
    expectStatus('pharmacist cannot review lab results', r.status, 403, r.json);
  }
}

/**
 * The lab workflow across three people, which is the point of the workflow.
 *
 * LabTechnician submits, a Doctor reviews, the patient's record gains the
 * result. The maker-checker rule is exercised in the same run: the submitter's
 * own approval must be refused, and a different clinician's must succeed.
 */
async function qualifyLabWorkflow(
  m: Manifest,
  sessions: Record<string, Session>,
  patients: Record<string, Session>
): Promise<void> {
  section = 'D. Cross-role clinical workflow — lab result';
  console.log(`\n${section}`);

  const { labtech, doctorA, doctorB } = sessions;
  const patientA = patients.patientA;
  if (!labtech || !doctorA || !doctorB || !patientA) {
    // A section cannot run without its sessions. When those were refused by
    // a rate limit rather than by a defect, this is a SKIP.
    if (sessionsRateLimited) {
      skip('lab workflow', 'sessions unavailable — sign-in rate limit, re-run after a minute');
    } else {
      record('lab workflow prerequisites', false, 'needs labtech + two doctors + patient');
    }
    return;
  }

  const patientId = m.patient.linked_patient_id;

  const submit = await http('POST', '/lab/submit', {
    token: labtech.token,
    body: {
      patient_id: patientId,
      test_name: 'Complete Blood Count',
      test_category: 'Hematology',
      results: [
        { parameter: 'Hemoglobin', value: '14.1', unit: 'g/dL', reference_range: '12.0-17.5', flag: null },
      ],
      notes: 'synthetic qualification sample',
    },
  });
  if (!expectStatus('lab technician submits a result', submit.status, [200, 201], submit.json)) return;

  const submissionId = String(submit.json.submission_id ?? submit.json.id ?? '');
  record('submission has an id', Boolean(submissionId), JSON.stringify(submit.json).slice(0, 200));
  if (!submissionId) return;

  // Maker-checker. The submitter is a LabTechnician, who cannot review at all,
  // so this proves the role rule; the self-review rule is proved below with a
  // doctor-submitted result.
  const selfReview = await http('POST', '/lab/review', {
    token: labtech.token,
    body: { submission_id: submissionId, action: 'approve' },
  });
  expectStatus('the submitting lab technician cannot approve it', selfReview.status, 403, selfReview.json);

  const review = await http('POST', '/lab/review', {
    token: doctorA.token,
    body: { submission_id: submissionId, action: 'approve' },
  });
  if (!expectStatus('a doctor approves it', review.status, 200, review.json)) return;

  const second = await http('POST', '/lab/review', {
    token: doctorB.token,
    body: { submission_id: submissionId, action: 'reject', rejection_reason: 'second opinion' },
  });
  expectStatus('a second review cannot overturn the first', second.status, 400, second.json);

  // The approval's purpose: the result must now be on the patient's chart.
  const records = await http('GET', `/records/${patientId}`, { token: patientA.token });
  const body = JSON.stringify(records.json);
  record(
    'the approved result reaches the patient record',
    records.status === 200 && body.includes(`lab-${submissionId}`),
    `status ${records.status}; body did not mention lab-${submissionId}`
  );

  // And the sign-off must be attributable afterwards. This check is the reason
  // UI-003 was found: the audit row was being written correctly and the
  // access-log endpoint returned an empty page for every caller, because its
  // pagination arguments were swapped. Reading the audit back through the
  // endpoint a patient would actually use is what made that visible; asserting
  // only that the write returned 200 would not have.
  const logs = await http('GET', `/access-logs/${patientId}?limit=100`, { token: doctorA.token });
  const logBody = JSON.stringify(logs.json);
  const entries = (logs.json.access_logs ?? []) as Json[];
  record(
    'the access log is readable and not an empty page',
    logs.status === 200 && entries.length > 0,
    `status ${logs.status}; ${entries.length} entries but total_accesses=${logs.json.total_accesses}`
  );
  record(
    'the approval is recorded in the audit trail',
    logBody.includes('lab_review_approve'),
    `no lab_review_approve among ${entries.length} entries`
  );
}

/**
 * Maker-checker where both parties *can* review — the case the role rule alone
 * does not cover.
 */
async function qualifySelfReview(m: Manifest, sessions: Record<string, Session>): Promise<void> {
  section = 'E. Maker-checker — self-approval by a qualified reviewer';
  console.log(`\n${section}`);

  const { doctorA, doctorB } = sessions;
  if (!doctorA || !doctorB) {
    // A section cannot run without its sessions. When those were refused by
    // a rate limit rather than by a defect, this is a SKIP.
    if (sessionsRateLimited) {
      skip('self-review', 'sessions unavailable — sign-in rate limit, re-run after a minute');
    } else {
      record('self-review prerequisites', false, 'needs two doctors');
    }
    return;
  }

  const submit = await http('POST', '/lab/submit', {
    token: doctorA.token,
    body: {
      patient_id: m.patient.linked_patient_id,
      test_name: 'Basic Metabolic Panel',
      test_category: 'Chemistry',
      results: [
        { parameter: 'Potassium', value: '4.1', unit: 'mmol/L', reference_range: '3.5-5.1', flag: null },
      ],
      notes: 'synthetic self-review probe',
    },
  });
  if (!expectStatus('a doctor submits a result', submit.status, [200, 201], submit.json)) return;

  const id = String(submit.json.submission_id ?? submit.json.id ?? '');
  if (!id) {
    record('submission has an id', false, JSON.stringify(submit.json).slice(0, 200));
    return;
  }

  const self = await http('POST', '/lab/review', {
    token: doctorA.token,
    body: { submission_id: id, action: 'approve' },
  });
  const selfOk = self.status === 403 && String(self.json?.error?.code) === 'SELF_REVIEW_FORBIDDEN';
  record(
    'the submitting doctor cannot approve their own result',
    selfOk,
    `status ${self.status} code ${self.json?.error?.code}`
  );

  const other = await http('POST', '/lab/review', {
    token: doctorB.token,
    body: { submission_id: id, action: 'approve' },
  });
  expectStatus('a different doctor can', other.status, 200, other.json);
}

/**
 * Object-level authorization: wrong patient, forged identifiers, and the
 * patient's own boundary.
 */
async function qualifyObjectAuthorization(m: Manifest, sessions: Record<string, Session>): Promise<void> {
  section = 'F. Object authorization — wrong patient and forged identifiers';
  console.log(`\n${section}`);

  const patientA = m.patient;
  const patientB = m.patient_b;

  const doctorA = sessions.doctorA;
  if (!doctorA) {
    record('object authorization prerequisites', false, 'needs a doctor session');
    return;
  }

  for (const [name, id] of [
    ['a fabricated patient id', 'PAT-does-not-exist'],
    ['a SQL-quoted patient id', "PAT-1' OR '1'='1"],
    ['a traversal patient id', '..%2F..%2Fusers'],
  ] as Array<[string, string]>) {
    const r = await http('GET', `/patients/${encodeURIComponent(id)}`, { token: doctorA.token });
    expectStatus(`${name} is refused without disclosure`, r.status, [400, 403, 404], r.json);
  }

  // Break-glass must not be mintable from a patient id alone. The control is
  // that it demands an NFC tag, binding it to physical possession of the card.
  const breakGlass = await http('POST', '/emergency/access', {
    token: doctorA.token,
    body: { patient_id: patientB.linked_patient_id, reason: 'synthetic probe' },
  });
  expectStatus(
    'break-glass cannot be minted from a patient id alone',
    breakGlass.status,
    [400, 403, 422],
    breakGlass.json
  );

  // An unauthenticated request must reach nothing.
  const anon = await http('GET', `/patients/${patientA.linked_patient_id}`);
  expectStatus('an unauthenticated request reaches no patient', anon.status, 401, anon.json);

  // A token is not a bypass for a malformed one.
  const garbage = await http('GET', `/patients/${patientA.linked_patient_id}`, { token: 'not-a-real-token' });
  expectStatus('a forged bearer token is refused', garbage.status, 401, garbage.json);
}

/**
 * Prescriptions across the clinical/pharmacy boundary.
 */
async function qualifyPrescriptionWorkflow(m: Manifest, sessions: Record<string, Session>): Promise<void> {
  section = 'G. Cross-role clinical workflow — prescription';
  console.log(`\n${section}`);

  const { doctorA, pharmacist } = sessions;
  if (!doctorA) {
    record('prescription prerequisites', false, 'needs a doctor session');
    return;
  }

  const create = await http('POST', '/e-prescriptions', {
    token: doctorA.token,
    // Field names are `CreateEPrescriptionRequest`'s, not the ones the
    // clinical types use: `form` not `dosage_form`, `directions` not `sig`,
    // and the pharmacy arrives as an NCPDP id plus a name rather than an id.
    // A mismatch here is answered with a bare 400 and an empty body, which
    // reads as a rejected prescription rather than a malformed request.
    body: {
      patient_id: m.patient.linked_patient_id,
      medication_name: 'Amoxicillin',
      generic_name: null,
      strength: '500mg',
      form: 'capsule',
      quantity: 21,
      days_supply: 7,
      directions: 'one capsule three times a day',
      refills_allowed: 0,
      is_controlled: false,
      dea_schedule: null,
      pharmacy_ncpdp: '1234567',
      pharmacy_name: 'Synthetic Test Pharmacy',
      diagnosis_codes: [],
      patient_instructions: 'Take with food',
      pharmacy_notes: null,
    },
  });
  if (!expectStatus('a doctor creates a prescription', create.status, [200, 201], create.json)) return;

  const rxId = String(create.json.prescription_id ?? '');
  if (!rxId) {
    record('prescription has an id', false, JSON.stringify(create.json).slice(0, 200));
    return;
  }

  // A pharmacist must not be able to sign a prescription into existence.
  if (pharmacist) {
    const pharmSign = await http('POST', `/e-prescriptions/${rxId}/sign`, {
      token: pharmacist.token,
      body: { signature_method: 'password', attestation: 'I attest' },
    });
    expectStatus('a pharmacist cannot sign a prescription', pharmSign.status, [401, 403], pharmSign.json);
  }

  const sign = await http('POST', `/e-prescriptions/${rxId}/sign`, {
    token: doctorA.token,
    body: { signature_method: 'password', attestation: 'I attest this prescription' },
  });
  if (!expectStatus('the prescriber signs it', sign.status, 200, sign.json)) return;

  // Re-signing a signed prescription must be refused: the state machine, not
  // the last writer, decides what the record says.
  const reSign = await http('POST', `/e-prescriptions/${rxId}/sign`, {
    token: doctorA.token,
    body: { signature_method: 'password', attestation: 'again' },
  });
  expectStatus('it cannot be signed twice', reSign.status, 400, reSign.json);

  const transmit = await http('POST', `/e-prescriptions/${rxId}/transmit`, { token: doctorA.token });
  if (!expectStatus('the prescriber transmits it', transmit.status, 200, transmit.json)) return;

  const reTransmit = await http('POST', `/e-prescriptions/${rxId}/transmit`, { token: doctorA.token });
  expectStatus('it cannot be transmitted twice', reTransmit.status, 400, reTransmit.json);

  // And the transmitted prescription must not be re-signable back to Signed.
  const signAfterTransmit = await http('POST', `/e-prescriptions/${rxId}/sign`, {
    token: doctorA.token,
    body: { signature_method: 'password', attestation: 'walk it back' },
  });
  expectStatus(
    'a transmitted prescription cannot be re-signed',
    signAfterTransmit.status,
    400,
    signAfterTransmit.json
  );
}

/**
 * Session revocation: signing out must end the session server-side, not merely
 * forget the token in the client.
 */
async function qualifySessionLifecycle(sessions: Record<string, Session>): Promise<void> {
  section = 'H. Session lifecycle — revocation is server-side';
  console.log(`\n${section}`);

  const s = sessions.nurse;
  if (!s) {
    // A section cannot run without its sessions. When those were refused by
    // a rate limit rather than by a defect, this is a SKIP.
    if (sessionsRateLimited) {
      skip('session lifecycle', 'sessions unavailable — sign-in rate limit, re-run after a minute');
    } else {
      record('session lifecycle prerequisites', false, 'needs a nurse session');
    }
    return;
  }

  const before = await http('GET', '/auth/me', { token: s.token });
  if (!expectStatus('the session works before sign-out', before.status, 200, before.json)) return;

  const out = await http('POST', '/auth/logout', { token: s.token });
  expectStatus('sign-out is accepted', out.status, [200, 204], out.json);

  const after = await http('GET', '/auth/me', { token: s.token });
  expectStatus('the same token is refused after sign-out', after.status, 401, after.json);

  // The nurse session is now dead; drop it so later sections do not reuse it.
  delete sessions.nurse;
}

/**
 * The patient's own boundary.
 *
 * A patient may read their own record and must reach nothing of anyone else's.
 * This is the one authorization question a clinician's session cannot answer.
 */
async function qualifyPatientBoundary(m: Manifest): Promise<Record<string, Session>> {
  section = 'I. Patient boundary — own record only';
  console.log(`\n${section}`);

  const patients: Record<string, Session> = {};
  for (const [label, fx] of [['patientA', m.patient], ['patientB', m.patient_b]] as const) {
    try {
      patients[label] = await signInPatient(fx, label);
      record(`${label} signs in with their username and password`, true, '');
    } catch (e) {
      record(`${label} signs in with their username and password`, false, String(e));
    }
  }

  const a = patients.patientA;
  const b = patients.patientB;
  if (!a || !b) return patients;

  const own = await http('GET', `/patients/${m.patient.linked_patient_id}`, { token: a.token });
  expectStatus('patient A reads their own record', own.status, 200, own.json);

  const other = await http('GET', `/patients/${m.patient_b.linked_patient_id}`, { token: a.token });
  expectStatus("patient A cannot read patient B's record", other.status, [403, 404], other.json);

  const otherLogs = await http('GET', `/access-logs/${m.patient_b.linked_patient_id}`, { token: a.token });
  expectStatus("patient A cannot read patient B's access log", otherLogs.status, [403, 404], otherLogs.json);

  return patients;
}

/**
 * Consent: request, approve, use, revoke, and lose access.
 *
 * The property that matters is the last step. A grant that is revoked but keeps
 * working — because the decision was cached, or because the clinician's
 * existing token still carries the old answer — is the failure mode this exists
 * to catch, so the same session is reused across the revocation rather than
 * signing in again.
 */
async function qualifyConsentLifecycle(
  m: Manifest,
  sessions: Record<string, Session>,
  patients: Record<string, Session>
): Promise<void> {
  section = 'J. Consent lifecycle — request, approve, revoke';
  console.log(`\n${section}`);

  const doctorB = sessions.doctorB;
  const patientA = patients.patientA;
  const patientB = patients.patientB;
  if (!doctorB || !patientA || !patientB) {
    // A section cannot run without its sessions. When those were refused by
    // a rate limit rather than by a defect, this is a SKIP.
    if (sessionsRateLimited) {
      skip('consent lifecycle', 'sessions unavailable — sign-in rate limit, re-run after a minute');
    } else {
      record('consent prerequisites', false, 'needs doctorB and both patient sessions');
    }
    return;
  }

  const patientId = m.patient.linked_patient_id;

  const beforeGrant = await http('GET', `/records/${patientId}`, { token: doctorB.token });
  expectStatus(
    'a doctor without patient consent cannot list the patient records',
    beforeGrant.status,
    403,
    beforeGrant.json
  );

  const request = await http('POST', `/access/patient/${patientId}/requests`, {
    token: doctorB.token,
    body: { reason: 'synthetic qualification — ongoing care' },
  });

  // A previous run that stopped before revoking leaves a pending request, and
  // the database's unique index correctly refuses a second one. That is the
  // control working, so it is asserted rather than worked around — and then
  // the existing request is adopted, because a qualification harness that only
  // passes on a clean database cannot be re-run, and one that cannot be re-run
  // stops being used.
  let requestId = '';
  if (request.status === 409 && String(request.json?.error?.code) === 'ACCESS_REQUEST_ALREADY_PENDING') {
    record('a duplicate pending request is refused', true, '');
    const pending = await http('GET', `/access/patient/${patientId}/requests`, { token: patientA.token });
    const list: Json[] = Array.isArray(pending.json)
      ? pending.json
      : (pending.json.requests ?? pending.json.items ?? []);
    const mine = list.find(
      (r) =>
        (r.providerId ?? r.provider_id) === doctorB.userId &&
        (r.status ?? 'pending') === 'pending'
    );
    requestId = String(mine?.id ?? mine?.requestId ?? mine?.request_id ?? '');
    record('the existing pending request is recoverable', Boolean(requestId), JSON.stringify(pending.json).slice(0, 300));
  } else {
    if (!expectStatus('a doctor requests access to a patient', request.status, [200, 201], request.json)) return;

    // The API nests the created object and serialises camelCase
    // (`{ request: { id, providerId, ... } }`).
    requestId = String(
      (request.json.request as Json | undefined)?.id ?? request.json.request_id ?? request.json.id ?? ''
    );

    // Asserted on the fresh path too: the same request twice must be refused.
    const duplicate = await http('POST', `/access/patient/${patientId}/requests`, {
      token: doctorB.token,
      body: { reason: 'synthetic qualification — duplicate probe' },
    });
    expectStatus('a duplicate pending request is refused', duplicate.status, 409, duplicate.json);
  }

  if (!requestId) {
    record('access request has an id', false, JSON.stringify(request.json).slice(0, 200));
    return;
  }

  const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  // Maker-checker: the requester decides nothing.
  const selfApprove = await http('POST', `/access/requests/${requestId}/approve`, {
    token: doctorB.token,
    body: { expires_at: future },
  });
  expectStatus('the requesting doctor cannot approve their own request', selfApprove.status, 403, selfApprove.json);

  // Nor may an unrelated patient decide someone else's.
  const foreignApprove = await http('POST', `/access/requests/${requestId}/approve`, {
    token: patientB.token,
    body: { expires_at: future },
  });
  expectStatus('an unrelated patient cannot approve it', foreignApprove.status, [403, 404], foreignApprove.json);

  // Indefinite access is prohibited; so is an expiry already in the past.
  const past = new Date(Date.now() - 3600 * 1000).toISOString();
  const pastGrant = await http('POST', `/access/requests/${requestId}/approve`, {
    token: patientA.token,
    body: { expires_at: past },
  });
  expectStatus('an expiry in the past is refused', pastGrant.status, 400, pastGrant.json);

  const tooLong = new Date(Date.now() + 400 * 24 * 3600 * 1000).toISOString();
  const longGrant = await http('POST', `/access/requests/${requestId}/approve`, {
    token: patientA.token,
    body: { expires_at: tooLong },
  });
  expectStatus('an expiry beyond the maximum window is refused', longGrant.status, 400, longGrant.json);

  const approve = await http('POST', `/access/requests/${requestId}/approve`, {
    token: patientA.token,
    body: { expires_at: future },
  });
  if (!expectStatus('the patient approves it', approve.status, 200, approve.json)) return;

  const duringGrant = await http('GET', `/records/${patientId}`, { token: doctorB.token });
  expectStatus(
    'the approved doctor can list the patient records',
    duringGrant.status,
    200,
    duringGrant.json
  );

  const grants = await http('GET', `/access/patient/${patientId}/grants`, { token: patientA.token });
  const grantsBody = JSON.stringify(grants.json);
  record(
    'the grant is visible to the patient',
    grants.status === 200 && grantsBody.includes(doctorB.userId),
    `status ${grants.status}; grants did not mention the provider`
  );

  const grantList: Json[] = Array.isArray(grants.json)
    ? grants.json
    : (grants.json.grants ?? grants.json.items ?? []);
  const mine = grantList.find(
    (g) => (g.providerId ?? g.provider_id) === doctorB.userId
  );
  const grantId = String(mine?.grantId ?? mine?.id ?? mine?.grant_id ?? '');
  if (!grantId) {
    record('the grant has an id', false, grantsBody.slice(0, 300));
    return;
  }

  // A second approval of a decided request must not re-open it.
  const reApprove = await http('POST', `/access/requests/${requestId}/approve`, {
    token: patientA.token,
    body: { expires_at: future },
  });
  expectStatus('an already-decided request cannot be re-approved', reApprove.status, [400, 404, 409], reApprove.json);

  const revoke = await http('POST', `/access/grants/${grantId}/revoke`, { token: patientA.token });
  if (!expectStatus('the patient revokes the grant', revoke.status, 200, revoke.json)) return;

  const afterRevoke = await http('GET', `/records/${patientId}`, { token: doctorB.token });
  expectStatus(
    'the same doctor session loses record access immediately after revocation',
    afterRevoke.status,
    403,
    afterRevoke.json
  );

  const reRevoke = await http('POST', `/access/grants/${grantId}/revoke`, { token: patientA.token });
  expectStatus('revoking twice is refused', reRevoke.status, [400, 404, 409], reRevoke.json);

  // The revoked grant must be gone from the patient's own view.
  const after = await http('GET', `/access/patient/${patientId}/grants`, { token: patientA.token });
  const afterList: Json[] = Array.isArray(after.json)
    ? after.json
    : (after.json.grants ?? after.json.items ?? []);
  const stillActive = afterList.some(
    (g) =>
      (g.grantId ?? g.id ?? g.grant_id) === grantId &&
      (g.revokedAt ?? g.revoked_at ?? null) === null &&
      g.status !== 'revoked'
  );
  record('the revoked grant is no longer active', !stillActive, JSON.stringify(after.json).slice(0, 300));
}

/** The error code of a response, whichever envelope carried it. */
function codeOf(json: Json): string {
  return String(json?.error?.code ?? json?.code ?? '');
}

/** A credential proof for `loginId` under a password nobody holds. */
async function wrongProofFor(loginId: string): Promise<string> {
  return deriveAuthProof('Not-The-Fixture-Password!2026', loginId);
}

/** `POST /api/auth/login`, exactly as a portal sends it. */
async function rawLogin(identifier: string, authProof: string, totpCode?: string) {
  return http('POST', '/auth/login', {
    body: { identifier, auth_proof: authProof, ...(totpCode ? { totp_code: totpCode } : {}) },
  });
}

/** A well-formed activation code that was never issued to anybody. */
const NEVER_ISSUED_CODE = '0000-0000-0000';

let disposableCounter = 0;

/** A staff account this run owns, made only to be attacked. */
interface Disposable {
  userId: string;
  loginId: string;
  /** The one-time code the registration returned. */
  code: string;
}

/**
 * Register and activate a throwaway staff account.
 *
 * The rejection paths below consume grants, lock accounts and revoke sessions.
 * Doing that to a shared fixture would starve every later section, so each path
 * gets an account made for it.
 */
async function createDisposable(admin: Session, purpose: string): Promise<Disposable | null> {
  disposableCounter += 1;
  const loginId = `xr.${Date.now().toString(36)}.${disposableCounter}`;
  const reg = await http('POST', '/auth/register', {
    token: admin.token,
    body: { name: `Qualification ${purpose}`, role: 'Nurse', login_id: loginId },
  });
  const userId = String(reg.json.user_id ?? '');
  const code = String(reg.json.credential_code ?? '');
  if (![200, 201].includes(reg.status) || !userId || !code) {
    record(`a disposable account for '${purpose}' is registered`, false, `status ${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);
    return null;
  }
  const act = await http('PUT', `/users/${userId}`, { token: admin.token, body: { status: 'active' } });
  if (![200, 201, 204].includes(act.status)) {
    record(`a disposable account for '${purpose}' is activated`, false, `status ${act.status} ${JSON.stringify(act.json).slice(0, 200)}`);
    return null;
  }
  return { userId, loginId, code };
}

/** `POST /api/auth/credentials/redeem` with the fixture password's proof. */
async function redeemCode(identifier: string, code: string, loginId: string, username?: string) {
  const authProof = await deriveAuthProof(PASSWORD, loginId);
  return http('POST', '/auth/credentials/redeem', {
    body: { identifier, code, auth_proof: authProof, ...(username ? { username } : {}) },
  });
}

/** True when a 429 is the general request limiter rather than a lock the API set. */
function isGeneralRateLimit(r: { status: number; json: Json }, lockCode: string): boolean {
  return r.status === 429 && codeOf(r.json) !== lockCode;
}

/**
 * The sign-in endpoint refuses what it must refuse, and says the same thing
 * about a wrong password and an account that does not exist.
 */
async function qualifyLoginRefusals(sessions: Record<string, Session>): Promise<void> {
  const subject = sessions.pharmacist2 ?? sessions.pharmacist;
  if (!subject) {
    skip('login refusals', 'no pharmacist session to name an account with');
    return;
  }

  const wrong = await rawLogin(subject.loginId, await wrongProofFor(subject.loginId));
  expectStatus('a wrong proof is refused', wrong.status, 401, wrong.json);
  record('the refusal says INVALID_CREDENTIALS', codeOf(wrong.json) === 'INVALID_CREDENTIALS', `code ${codeOf(wrong.json)}`);

  const ghostId = `nobody.${Date.now().toString(36)}`;
  const unknown = await rawLogin(ghostId, await wrongProofFor(ghostId));
  record(
    'an unknown login id is refused exactly like a wrong password',
    unknown.status === wrong.status && codeOf(unknown.json) === codeOf(wrong.json),
    `unknown -> ${unknown.status} ${codeOf(unknown.json)}, wrong password -> ${wrong.status} ${codeOf(wrong.json)}; ` +
      `a difference tells an attacker which login ids exist`
  );

  const malformed = await rawLogin(subject.loginId, 'not-a-proof');
  expectStatus('a malformed proof is refused', malformed.status, [400, 401], malformed.json);

  const empty = await rawLogin('', '');
  expectStatus('an empty identifier and proof are refused', empty.status, [400, 401, 422], empty.json);

  // One failure must not lock a real account: the counter is a threshold, not a
  // tripwire, and the fixture has to keep working for every later section.
  const right = await rawLogin(subject.loginId, await deriveAuthProof(passwordFor(subject.loginId), subject.loginId));
  expectStatus('the right proof still signs in after one failure', right.status, 200, right.json);
}

/**
 * Endpoints the removal deleted stay deleted.
 *
 * Probed with a signed-in session so the answer is the router's, not the
 * idempotency or authentication layers refusing an anonymous caller first.
 */
async function qualifyRetiredEndpoints(sessions: Record<string, Session>): Promise<void> {
  const caller = sessions.doctorA;
  if (!caller) {
    skip('retired endpoints', 'no doctor session');
    return;
  }
  for (const path of [
    '/auth/challenge',
    '/auth/jwt',
    '/auth/staff/login',
    '/auth/demo-login',
    '/auth/credentials',
    '/auth/staff/rotate-credentials',
    '/auth/step-up/challenge',
    '/auth/step-up/verify',
  ]) {
    const r = await http('POST', path, { token: caller.token, body: {} });
    expectStatus(`POST ${path} no longer exists`, r.status, [404, 405, 410], r.json);
  }
}

/**
 * One-time credential codes: wrong, replayed, malformed-proof, and exhausted.
 *
 * Each case gets its own account, because a code that is refused five times is
 * dead and the point is to prove it.
 */
async function qualifyCredentialCodes(admin: Session): Promise<void> {
  // A code that was never issued.
  const first = await createDisposable(admin, 'code paths');
  if (!first) return;

  const bogus = await redeemCode(first.loginId, NEVER_ISSUED_CODE, first.loginId);
  if (isGeneralRateLimit(bogus, 'GRANT_LOCKED')) {
    skip('credential code paths', 'the general request limiter fired — re-run after a minute');
    return;
  }
  expectStatus('a code that was never issued is refused', bogus.status, 401, bogus.json);
  record('and the refusal says INVALID_GRANT', codeOf(bogus.json) === 'INVALID_GRANT', `code ${codeOf(bogus.json)}`);

  // A malformed proof is refused as one, and does not burn the real code.
  const badProof = await http('POST', '/auth/credentials/redeem', {
    body: { identifier: first.loginId, code: first.code, auth_proof: 'zz-not-a-proof' },
  });
  expectStatus('a malformed proof is refused at redemption', badProof.status, 400, badProof.json);
  record('and the refusal says INVALID_AUTH_PROOF', codeOf(badProof.json) === 'INVALID_AUTH_PROOF', `code ${codeOf(badProof.json)}`);

  const redeemed = await redeemCode(first.loginId, first.code, first.loginId);
  expectStatus('the real code still redeems afterwards', redeemed.status, 200, redeemed.json);
  if (redeemed.status === 200) {
    const me = await http('GET', '/auth/me', { token: String(redeemed.json.access_token) });
    expectStatus('redemption signs the person in', me.status, 200, me.json);
  }

  // Single use.
  const replay = await redeemCode(first.loginId, first.code, first.loginId);
  expectStatus('a redeemed code cannot be redeemed again', replay.status, 401, replay.json);
  record('and the refusal says INVALID_GRANT', codeOf(replay.json) === 'INVALID_GRANT', `code ${codeOf(replay.json)}`);

  // A code is bound to the account it was issued for.
  const second = await createDisposable(admin, 'code for another account');
  if (second) {
    const crossed = await redeemCode(first.loginId, second.code, first.loginId);
    expectStatus("one account's code does not redeem another's", crossed.status, 401, crossed.json);
  }

  // Five wrong attempts kill the grant, so the right code stops working too.
  const third = await createDisposable(admin, 'grant lockout');
  if (third) {
    let locked = false;
    for (let attempt = 0; attempt < 8 && !locked; attempt += 1) {
      const r = await redeemCode(third.loginId, NEVER_ISSUED_CODE, third.loginId);
      locked = r.status === 429 && codeOf(r.json) === 'GRANT_LOCKED';
    }
    record('repeated wrong codes lock the grant (GRANT_LOCKED)', locked, 'eight wrong codes never produced GRANT_LOCKED');
    const after = await redeemCode(third.loginId, third.code, third.loginId);
    record(
      'a locked grant refuses even the real code',
      [401, 429].includes(after.status),
      `status ${after.status} ${JSON.stringify(after.json).slice(0, 160)}`
    );
  }
}

/**
 * Sign-in lockout, and an administrator's reset revoking live sessions.
 */
async function qualifyLockoutAndReset(admin: Session): Promise<void> {
  const victim = await createDisposable(admin, 'lockout');
  if (victim) {
    const redeemed = await redeemCode(victim.loginId, victim.code, victim.loginId);
    if (redeemed.status === 200) {
      const wrong = await wrongProofFor(victim.loginId);
      let locked = false;
      for (let attempt = 0; attempt < 25 && !locked; attempt += 1) {
        const r = await rawLogin(victim.loginId, wrong);
        if (isGeneralRateLimit(r, 'ACCOUNT_LOCKED')) {
          skip('sign-in lockout', 'the general request limiter fired — re-run after a minute');
          return;
        }
        locked = r.status === 429 && codeOf(r.json) === 'ACCOUNT_LOCKED';
      }
      record('repeated wrong proofs lock the account (ACCOUNT_LOCKED)', locked, 'twenty-five wrong proofs never produced ACCOUNT_LOCKED');
      const right = await rawLogin(victim.loginId, await deriveAuthProof(PASSWORD, victim.loginId));
      record(
        'a locked account refuses even the right proof',
        [401, 429].includes(right.status),
        `status ${right.status} — a lock the correct password walks through is not a lock`
      );
    } else {
      record('the lockout account can be activated', false, `redeem -> ${redeemed.status} ${JSON.stringify(redeemed.json).slice(0, 160)}`);
    }
  }

  // Reset revokes sessions.
  const target = await createDisposable(admin, 'reset');
  if (!target) return;
  const first = await redeemCode(target.loginId, target.code, target.loginId);
  if (first.status !== 200) {
    record('the reset account can be activated', false, `redeem -> ${first.status}`);
    return;
  }
  const token = String(first.json.access_token);
  const live = await http('GET', '/auth/me', { token });
  expectStatus('the account has a live session before the reset', live.status, 200, live.json);

  const reset = await http('POST', `/admin/users/${target.userId}/credential-reset`, { token: admin.token, body: {} });
  if (reset.status === 403 && codeOf(reset.json) === 'MFA_REQUIRED') {
    skip('credential reset', 'the administrator session lacks step-up assurance on this deployment');
    return;
  }
  if (!expectStatus('an administrator resets the credential', reset.status, [200, 201], reset.json)) return;
  const resetCode = String(reset.json.credential_code ?? '');
  record('the reset returns a one-time code and an expiry', resetCode !== '' && Boolean(reset.json.expires_at), JSON.stringify(reset.json).slice(0, 160));

  const dead = await http('GET', '/auth/me', { token });
  expectStatus('the reset revoked the live session', dead.status, 401, dead.json);

  const again = await redeemCode(target.loginId, resetCode, target.loginId);
  expectStatus('the reset code redeems', again.status, 200, again.json);
  const replay = await redeemCode(target.loginId, resetCode, target.loginId);
  expectStatus('the reset code cannot be redeemed twice', replay.status, 401, replay.json);

  const notAdmin = await http('POST', `/admin/users/${target.userId}/credential-reset`, { token, body: {} });
  expectStatus('a nurse cannot reset credentials', notAdmin.status, [401, 403], notAdmin.json);
}

/**
 * A patient's activation code: username rules, single use, and what a fresh
 * account can and cannot reach.
 */
async function qualifyPatientActivation(m: Manifest, sessions: Record<string, Session>): Promise<void> {
  const doctor = sessions.doctorA;
  if (!doctor) {
    skip('patient activation', 'no doctor session');
    return;
  }
  const stamp = Date.now().toString(36);
  const reg = await http('POST', '/register', {
    token: doctor.token,
    body: {
      full_name: `Activation Probe ${stamp}`,
      date_of_birth: '1990-01-01',
      national_id: `XR-${stamp}`,
      phone: '+27000000300',
      blood_type: 'O+',
      allergies: [],
      current_medications: [],
      chronic_conditions: [],
      emergency_contact_name: 'Probe Contact',
      emergency_contact_phone: '+27000000301',
      emergency_contact_relationship: 'friend',
      organ_donor: false,
      dnr_status: false,
      languages: ['en'],
    },
  });
  const patientId = String(reg.json.patient_id ?? '');
  const activation = reg.json.activation as Json | undefined;
  const code = String(activation?.code ?? reg.json.activation_code ?? '');
  if (![200, 201].includes(reg.status) || !patientId || !code) {
    record('registering a patient returns an activation code', false, `status ${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);
    return;
  }
  record('registering a patient returns an activation code', true, '');
  record(
    'the code has the documented shape (XXXX-XXXX-XXXX)',
    /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code),
    `got '${code}'`
  );

  const taken = await redeemCode(patientId, code, m.patient.login_id, m.patient.login_id);
  expectStatus("a username somebody already holds is refused", taken.status, 409, taken.json);
  record('and the refusal says USERNAME_TAKEN', codeOf(taken.json) === 'USERNAME_TAKEN', `code ${codeOf(taken.json)}`);

  const badName = await redeemCode(patientId, code, 'a b!', 'a b!');
  expectStatus('a username with spaces or punctuation is refused', badName.status, 400, badName.json);
  record('and the refusal says INVALID_USERNAME', codeOf(badName.json) === 'INVALID_USERNAME', `code ${codeOf(badName.json)}`);

  const foreign = await redeemCode(m.patient_b.linked_patient_id, code, `xr${stamp}`, `xr${stamp}`);
  expectStatus("a code does not activate a different patient's account", foreign.status, 401, foreign.json);

  const username = `xr${stamp}`;
  const good = await redeemCode(patientId, code, username, username);
  if (!expectStatus('the patient activates their account with a username of their own', good.status, 200, good.json)) return;
  const linked = String(good.json?.user?.linked_patient_id ?? '');
  record('the new account is bound to the registered record', linked === patientId, `linked_patient_id ${linked}`);

  const token = String(good.json.access_token);
  const own = await http('GET', `/patients/${patientId}`, { token });
  expectStatus('the new patient reads their own record', own.status, 200, own.json);
  const other = await http('GET', `/patients/${m.patient.linked_patient_id}`, { token });
  expectStatus("and cannot read another patient's record", other.status, [403, 404], other.json);

  const reuse = await redeemCode(patientId, code, `xs${stamp}`, `xs${stamp}`);
  expectStatus('an activation code cannot be used twice', reuse.status, 401, reuse.json);

  const reissue = await http('POST', `/patients/${patientId}/activation-code`, { token: doctor.token, body: {} });
  record(
    'a second activation code is not issued for an activated patient',
    reissue.status === 409 && codeOf(reissue.json) === 'ALREADY_ACTIVATED',
    `status ${reissue.status} code ${codeOf(reissue.json)}`
  );
}

/**
 * Class C: one challenge, one factor, one use, one session.
 *
 * The challenge names the factor the account must present. Fixtures carry no
 * TOTP secret, so the positive path is exercised only when the factor is the
 * password; the refusals are exercised for either.
 */
async function qualifyTransactionAuthorization(sessions: Record<string, Session>): Promise<void> {
  const { doctorA, doctorB } = sessions;
  if (!doctorA || !doctorB) {
    skip('transaction authorization', 'needs two doctor sessions');
    return;
  }
  const issue = async (who: Session) =>
    http('POST', '/auth/transaction/challenge', {
      token: who.token,
      body: { action: 'qualification.probe', method: 'POST', path: '/api/qualification/probe' },
    });

  const issued = await issue(doctorA);
  if (!expectStatus('a signed-in clinician is issued a transaction challenge', issued.status, [200, 201], issued.json)) return;
  const challenge = ((issued.json.challenge as Json | undefined) ?? issued.json) as Json;
  const challengeId = String(challenge.challenge_id ?? '');
  const factor = String(challenge.required_factor ?? '');
  record(
    'the challenge names its factor and lifetime',
    challengeId !== '' && ['totp', 'password'].includes(factor) && Number(challenge.expires_in_secs) > 0,
    JSON.stringify(challenge).slice(0, 200)
  );
  if (!challengeId) return;

  const wrongFactor =
    factor === 'password'
      ? { auth_proof: await wrongProofFor(doctorA.loginId) }
      : { code: '000000' };
  const wrong = await http('POST', '/auth/transaction/verify', {
    token: doctorA.token,
    body: { challenge_id: challengeId, ...wrongFactor },
  });
  expectStatus('the wrong factor does not authorize', wrong.status, [400, 401, 403], wrong.json);

  const stolen = await http('POST', '/auth/transaction/verify', {
    token: doctorB.token,
    body: {
      challenge_id: challengeId,
      ...(factor === 'password'
        ? { auth_proof: await deriveAuthProof(passwordFor(doctorB.loginId), doctorB.loginId) }
        : { code: '000000' }),
    },
  });
  expectStatus("another clinician cannot spend this session's challenge", stolen.status, [400, 401, 403, 404], stolen.json);

  const ghost = await http('POST', '/auth/transaction/verify', {
    token: doctorA.token,
    body: { challenge_id: '00000000-0000-4000-8000-000000000000', ...wrongFactor },
  });
  expectStatus('a challenge id that was never issued is refused', ghost.status, [400, 401, 403, 404], ghost.json);

  if (factor !== 'password') {
    skip('the right factor authorizes, once', 'this account is asked for a TOTP code and fixtures hold no TOTP secret');
    return;
  }
  const good = await http('POST', '/auth/transaction/verify', {
    token: doctorA.token,
    body: {
      challenge_id: challengeId,
      auth_proof: await deriveAuthProof(passwordFor(doctorA.loginId), doctorA.loginId),
    },
  });
  expectStatus('the right password proof authorizes', good.status, 200, good.json);
  const replay = await http('POST', '/auth/transaction/verify', {
    token: doctorA.token,
    body: {
      challenge_id: challengeId,
      auth_proof: await deriveAuthProof(passwordFor(doctorA.loginId), doctorA.loginId),
    },
  });
  expectStatus('the same challenge cannot be spent twice', replay.status, [400, 401, 403, 404, 409], replay.json);
}

/**
 * Credential authentication — rejection paths.
 *
 * Every one of these is decided by the API, so they are asserted here rather
 * than settled for a weaker proof of the same property in a browser. Run last:
 * it registers accounts, spends grants and locks one of them.
 */
async function qualifyCredentialRejectionPaths(m: Manifest, sessions: Record<string, Session>): Promise<void> {
  section = 'K. Credential authentication — rejection paths';
  console.log(`\n${section}`);

  await qualifyLoginRefusals(sessions);
  await qualifyRetiredEndpoints(sessions);
  await qualifyPatientActivation(m, sessions);
  await qualifyTransactionAuthorization(sessions);

  const admin = sessions.admin;
  if (!admin) {
    skip('credential codes, lockout and reset', 'no administrator session');
    return;
  }
  await qualifyCredentialCodes(admin);
  await qualifyLockoutAndReset(admin);
}

/**
 * Authorization boundaries, probed directly rather than through a screen.
 *
 * A UI mutation proves the happy path exists. It proves nothing about what
 * happens when the same request arrives without the UI's cooperation, which is
 * the only way an attacker will ever send it. Everything here bypasses the
 * portal entirely and speaks to the API as a client that has decided not to
 * behave.
 *
 * Grouped by the boundary each probe attacks, because "403" alone is not the
 * interesting part — *which* rule produced it is.
 */
async function qualifyAuthorizationBoundaries(
  m: Manifest,
  sessions: Record<string, Session>,
  patients: Record<string, Session>
): Promise<void> {
  section = 'L. Authorization boundaries — direct API, no UI';
  console.log(`\n${section}`);

  const { doctorA, pharmacist, labtech, admin } = sessions;
  const patientA = patients.patientA;
  const patientB = patients.patientB;

  if (!doctorA || !pharmacist || !labtech || !admin) {
    // A section cannot run without its sessions. When those were refused by
    // a rate limit rather than by a defect, this is a SKIP.
    if (sessionsRateLimited) {
      skip('authorization boundaries', 'sessions unavailable — sign-in rate limit, re-run after a minute');
    } else {
      record('boundary prerequisites', false, 'needs doctor, pharmacist, labtech and admin sessions');
    }
    return;
  }

  const pidA = m.patient.linked_patient_id;
  const pidB = m.patient_b.linked_patient_id;

  // --- identity substitution ---------------------------------------------
  //
  // The legacy identity header was removed outright: no route reads it, with or
  // without a token. These probes send it anyway (the gate
  // check-legacy-identity-headers.py exempts exactly the lines marked
  // `identity-header-negative-assertion`) because the property under test is
  // that a caller cannot become somebody else by naming them.
  const substituted = await fetch(`${API}/patients/${pidA}`, {
    headers: {
      Authorization: `Bearer ${pharmacist.token}`,
      // Claim to be the admin while holding a pharmacist's token.
      'X-User-Id': m.administrator_user_id, // identity-header-negative-assertion
    },
  });
  const pharmacistOwn = await http('GET', `/patients/${pidA}`, { token: pharmacist.token });
  record(
    'a contradicting identity header does not change what a bearer session can do',
    substituted.status === pharmacistOwn.status,
    `with the header ${substituted.status}, without ${pharmacistOwn.status}`
  );

  const adminOnlyAsPharmacist = await fetch(`${API}/dashboard/admin`, {
    headers: {
      Authorization: `Bearer ${pharmacist.token}`,
      'X-User-Id': m.administrator_user_id, // identity-header-negative-assertion
    },
  });
  record(
    'a pharmacist naming the administrator still cannot reach the admin dashboard',
    [401, 403].includes(adminOnlyAsPharmacist.status),
    `status ${adminOnlyAsPharmacist.status}`
  );

  const headerOnly = await fetch(`${API}/dashboard/admin`, {
    headers: {
      'X-User-Id': m.administrator_user_id, // identity-header-negative-assertion
    },
  });
  record(
    'the identity header alone authenticates nobody',
    headerOnly.status === 401,
    `status ${headerOnly.status}`
  );

  // --- cross-patient ------------------------------------------------------
  if (patientA && patientB) {
    for (const [label, path] of [
      ["another patient's record", `/patients/${pidB}`],
      ["another patient's access log", `/access-logs/${pidB}`],
      ["another patient's lab submissions", `/lab/patient/${pidB}`],
      ["another patient's records list", `/records/${pidB}`],
    ] as Array<[string, string]>) {
      const r = await http('GET', path, { token: patientA.token });
      expectStatus(`patient A cannot read ${label}`, r.status, [403, 404], r.json);
    }

    // And a patient must not be able to write into anyone's chart.
    const write = await http('POST', '/clinical/vitals', {
      token: patientA.token,
      body: { patient_id: pidA, heart_rate: 80, systolic_bp: 120, diastolic_bp: 80, respiratory_rate: 16 },
    });
    expectStatus('a patient cannot record vitals, even on themselves', write.status, [401, 403], write.json);
  }

  // --- cross-role writes --------------------------------------------------
  const roleWrites: Array<[string, Session | undefined, string, unknown]> = [
    ['a pharmacist', pharmacist, '/clinical/vitals',
      { patient_id: pidA, heart_rate: 80, systolic_bp: 120, diastolic_bp: 80, respiratory_rate: 16 }],
    ['a lab technician', labtech, '/clinical/vitals',
      { patient_id: pidA, heart_rate: 80, systolic_bp: 120, diastolic_bp: 80, respiratory_rate: 16 }],
    ['a pharmacist', pharmacist, '/lab/review',
      { submission_id: 'LAB-NOPE', action: 'approve' }],
  ];
  for (const [who, sess, path, body] of roleWrites) {
    if (!sess) continue;
    const r = await http('POST', path, { token: sess.token, body });
    expectStatus(`${who} cannot POST ${path}`, r.status, [401, 403], r.json);
  }

  // --- a revoked session --------------------------------------------------
  //
  // Signing out must end authority server-side. A token that still parses is
  // not a token that still authorises.
  //
  // A DEDICATED session, signed in fresh and destroyed here. An earlier version
  // revoked the shared nurse session, which left section H with nothing to test
  // and reported that as a product failure — a harness eating its own fixtures.
  const nurseFixture = m.staff.find((st) => st.login_id.startsWith('bt.nurse.'));
  if (nurseFixture) {
    let disposable: Session | null = null;
    try {
      disposable = await signIn(nurseFixture.login_id, 'revocation-probe');
    } catch (e) {
      if (e instanceof SignInRateLimited) {
        skip('revocation probe', 'sign-in rate limit — re-run after a minute');
      } else {
        record('a disposable session for the revocation probe', false, String(e));
      }
    }

    if (disposable) {
      const before = await http('GET', '/auth/me', { token: disposable.token });
      expectStatus('the disposable session is live before sign-out', before.status, 200, before.json);

      await http('POST', '/auth/logout', { token: disposable.token });

      const afterRead = await http('GET', `/patients/${pidA}`, { token: disposable.token });
      expectStatus('a signed-out token cannot read a patient', afterRead.status, 401, afterRead.json);

      const afterWrite = await http('POST', '/clinical/vitals', {
        token: disposable.token,
        body: { patient_id: pidA, heart_rate: 80, systolic_bp: 120, diastolic_bp: 80, respiratory_rate: 16 },
      });
      expectStatus('a signed-out token cannot write vitals', afterWrite.status, 401, afterWrite.json);
    }
  }

  // --- a garbage / tampered token ----------------------------------------
  const tampered = `${doctorA.token.slice(0, -6)}AAAAAA`;
  const tamperedRead = await http('GET', `/patients/${pidA}`, { token: tampered });
  expectStatus('a token with a tampered signature is refused', tamperedRead.status, 401, tamperedRead.json);

  const none = await http('GET', `/patients/${pidA}`);
  expectStatus('no credential reaches no patient', none.status, 401, none.json);

  // --- self-approval, direct ---------------------------------------------
  //
  // Proved through the UI for lab review; proved here without one, because a
  // disabled button is not an authorization control.
  const submit = await http('POST', '/lab/submit', {
    token: doctorA.token,
    body: {
      patient_id: pidA,
      test_name: 'Boundary Probe Panel',
      test_category: 'Chemistry',
      results: [{ parameter: 'Sodium', value: '140', unit: 'mmol/L', reference_range: '135-145', flag: null }],
      notes: 'direct-api self-approval probe',
    },
  });
  if (expectStatus('a doctor submits a result', submit.status, [200, 201], submit.json)) {
    const id = String(submit.json.submission_id ?? submit.json.id ?? '');
    const self = await http('POST', '/lab/review', {
      token: doctorA.token,
      body: { submission_id: id, action: 'approve' },
    });
    record(
      'the submitter cannot approve their own result via the API, with no UI involved',
      self.status === 403 && String(self.json?.error?.code) === 'SELF_REVIEW_FORBIDDEN',
      `status ${self.status} code ${self.json?.error?.code}`
    );
  }

  // --- deployment/tenancy boundary ---------------------------------------
  //
  // ADR-0007 makes this a single-organisation deployment, so there is no
  // second organisation to cross. The property that must hold instead is that
  // an organisation identifier supplied by the caller changes nothing.
  const orgSpoof = await fetch(`${API}/patients/${pidA}`, {
    headers: {
      Authorization: `Bearer ${doctorA.token}`,
      'X-Organization-Id': 'ORG-SOMEBODY-ELSE',
      'X-Hospital-Id': 'HOSP-SOMEBODY-ELSE',
    },
  });
  const plain = await http('GET', `/patients/${pidA}`, { token: doctorA.token });
  record(
    'a caller-supplied organisation header changes nothing',
    orgSpoof.status === plain.status,
    `spoofed ${orgSpoof.status} vs plain ${plain.status}`
  );
}

/**
 * Patient persona mutation, and the boundary that makes it safe.
 *
 * A patient's writes are narrow by design: they may raise a symptom and they
 * may message a clinician. Both cross a trust boundary in the direction the
 * others do not — patient to staff — so the delivery half is proved by having
 * the recipient read it back, not by trusting the 201.
 *
 * Deliberately API-level, not browser: the session here is built the way a
 * portal builds it (`POST /api/auth/login`), and what this does not cover is
 * what a patient sees on screen.
 */
async function qualifyPatientMutation(
  m: Manifest,
  sessions: Record<string, Session>,
  patients: Record<string, Session>
): Promise<void> {
  section = 'M. Patient persona mutation — symptom and message';
  console.log(`\n${section}`);

  const patientA = patients.patientA;
  const patientB = patients.patientB;
  const doctorA = sessions.doctorA;
  if (!patientA || !doctorA) {
    // A section cannot run without its sessions. When those were refused by
    // a rate limit rather than by a defect, this is a SKIP.
    if (sessionsRateLimited) {
      skip('patient mutation', 'sessions unavailable — sign-in rate limit, re-run after a minute');
    } else {
      record('patient mutation prerequisites', false, 'needs a patient session and a doctor session');
    }
    return;
  }

  // --- a patient raises a symptom ----------------------------------------
  const marker = `qualification-${Date.now()}`;
  const symptom = await http('POST', '/symptoms/log', {
    token: patientA.token,
    body: {
      patient_id: m.patient.linked_patient_id,
      symptom: 'headache',
      severity: 4,
      notes: marker,
    },
  });
  // The route may not exist under this name; a 404 is a finding, not a pass.
  record(
    'a patient can log a symptom',
    [200, 201].includes(symptom.status),
    `status ${symptom.status} ${JSON.stringify(symptom.json).slice(0, 160)}`
  );

  // --- a patient messages a clinician ------------------------------------
  const send = await http('POST', '/messages/send', {
    token: patientA.token,
    body: {
      recipient_id: doctorA.userId,
      subject: 'Qualification message',
      content: `patient-to-clinician ${marker}`,
      priority: 'normal',
    },
  });
  if (expectStatus('a patient can message a clinician', send.status, [200, 201], send.json)) {
    // The delivery half: the clinician must actually see it.
    const inbox = await http('GET', '/messages', { token: doctorA.token });
    record(
      'the clinician receives the message',
      JSON.stringify(inbox.json).includes(marker),
      `doctor inbox did not contain ${marker}`
    );

    // And the patient has their own record of it. `folder` defaults to
    // "inbox", which correctly does NOT hold what you sent: `send_message`
    // writes an `:in` copy for the recipient and an `:out` copy for the
    // sender, and `sent` is the folder that reads the latter. An earlier
    // version of this check queried the default and reported the correct
    // absence as a defect.
    const own = await http('GET', '/messages?folder=sent', { token: patientA.token });
    record(
      'the patient has their own copy in the sent folder',
      JSON.stringify(own.json).includes(marker),
      "patient's sent folder did not contain the message they sent"
    );

    // The inbox must NOT contain it — the two folders are the point.
    const inboxOfSender = await http('GET', '/messages?folder=inbox', { token: patientA.token });
    record(
      "the sender's inbox does not contain their own outgoing message",
      !JSON.stringify(inboxOfSender.json).includes(marker),
      'a sent message appeared in the sender inbox'
    );
  }

  // --- the boundary -------------------------------------------------------
  if (patientB) {
    const toPatient = await http('POST', '/messages/send', {
      token: patientA.token,
      body: {
        recipient_id: patientB.userId,
        subject: 'Should not arrive',
        content: 'patient-to-patient probe',
        priority: 'normal',
      },
    });
    record(
      'a patient cannot message another patient',
      toPatient.status === 403 && String(toPatient.json?.error?.code) === 'INVALID_RECIPIENT',
      `status ${toPatient.status} code ${toPatient.json?.error?.code}`
    );

    // Nothing must have been delivered by the refused attempt.
    const bInbox = await http('GET', '/messages', { token: patientB.token });
    record(
      'the refused message was not delivered anyway',
      !JSON.stringify(bInbox.json).includes('patient-to-patient probe'),
      "patient B's inbox contains a message the API refused to send"
    );
  }

  // A patient must not be able to message a recipient that does not exist,
  // which is the same guard reached from the other side.
  // Generated, for the same reason: the recipient originally used here was a
  // real nurse, so the "unknown recipient" probe was actually testing a
  // permitted patient-to-nurse message and reporting the correct 201 as a
  // failure.
  const nobody = globalThis.crypto.randomUUID();
  const ghost = await http('POST', '/messages/send', {
    token: patientA.token,
    body: {
      recipient_id: nobody,
      subject: 'Ghost',
      content: 'nobody',
      priority: 'normal',
    },
  });
  // 400 as well: since 2026-09-22 every recipient is resolved before anything
  // is stored, and an account that does not exist is a bad request body
  // (INVALID_RECIPIENT). The property under test is the refusal, not its code.
  expectStatus('a patient cannot message an unknown recipient', ghost.status, [400, 403, 404], ghost.json);
}

/**
 * Telehealth, as a state machine rather than "can a call start".
 *
 * A telehealth room is a private clinical space, so the interesting questions
 * are all about who may enter it and for how long — not whether a URL comes
 * back. The API encodes a join window
 * (`JOIN_OPENS_BEFORE_SECS` = 15 min, `JOIN_CLOSES_AFTER_SECS` = 4 h), so a
 * session scheduled outside it must be unjoinable, and a link shared once must
 * stop working.
 *
 * What this does NOT do is start a real video call. The provider is Jitsi and
 * the deployment here has no private instance configured, so the lane that
 * needs a live conference — media, reconnect, recording capture — is recorded
 * as blocked rather than simulated. Everything below is the part MediChain
 * itself decides.
 */
async function qualifyTelehealth(
  m: Manifest,
  sessions: Record<string, Session>,
  patients: Record<string, Session>
): Promise<void> {
  section = 'N. Telehealth — session state machine';
  console.log(`\n${section}`);

  const doctorA = sessions.doctorA;
  const doctorB = sessions.doctorB;
  const pharmacist = sessions.pharmacist;
  const patientA = patients.patientA;
  const patientB = patients.patientB;

  if (!doctorA || !patientA) {
    if (sessionsRateLimited) {
      skip('telehealth', 'sessions unavailable — sign-in rate limit, re-run after a minute');
    } else {
      record('telehealth prerequisites', false, 'needs a doctor and a patient session');
    }
    return;
  }

  const now = Math.floor(Date.now() / 1000);

  // --- scheduling ---------------------------------------------------------
  const create = await http('POST', '/telehealth/sessions', {
    token: doctorA.token,
    body: {
      patient_id: m.patient.linked_patient_id,
      // `consultation` is not a session type this API has. It used to be
      // accepted because the handler ended in `_ => VideoVisit`, so this
      // suite proved the state machine worked on a session whose type had
      // been silently replaced.
      session_type: 'VideoVisit',
      scheduled_start: now,
      recording_enabled: false,
    },
  });
  if (!expectStatus('a clinician schedules a session', create.status, [200, 201], create.json)) return;

  const session = (create.json.session ?? create.json) as Json;
  const sessionId = String(session.session_id ?? session.id ?? create.json.session_id ?? '');
  if (!sessionId) {
    record('the session has an id', false, JSON.stringify(create.json).slice(0, 200));
    return;
  }

  // The room identifier must not carry PHI — it is shared with a third-party
  // video provider and appears in URLs, logs and invitations.
  const roomText = JSON.stringify(create.json);
  record(
    'the meeting identifier carries no patient identifier',
    !roomText.includes(m.patient.linked_patient_id),
    'the session payload embeds the patient id in a provider-visible field'
  );

  // --- who may join -------------------------------------------------------
  const clinicianJoin = await http('POST', `/telehealth/sessions/${sessionId}/join`, {
    token: doctorA.token,
  });
  expectStatus('the scheduling clinician can join', clinicianJoin.status, 200, clinicianJoin.json);

  const patientJoin = await http('POST', `/telehealth/sessions/${sessionId}/join`, {
    token: patientA.token,
  });
  expectStatus("the session's patient can join", patientJoin.status, 200, patientJoin.json);

  if (patientB) {
    const wrongPatient = await http('POST', `/telehealth/sessions/${sessionId}/join`, {
      token: patientB.token,
    });
    expectStatus(
      "another patient cannot join someone else's consultation",
      wrongPatient.status,
      [403, 404],
      wrongPatient.json
    );
  }

  // Refused — but by the idempotency middleware (409 IDEMPOTENCY_AUTH_REQUIRED)
  // rather than by the auth layer, because a keyed mutation needs a subject
  // before authorization is even consulted. The boundary holds; which layer
  // holds it is a diagnosability nit, not a hole, so the assertion names both.
  const anon = await http('POST', `/telehealth/sessions/${sessionId}/join`);
  expectStatus(
    'an unauthenticated caller cannot join',
    anon.status,
    [401, 403, 409],
    anon.json
  );

  // --- a session that does not exist --------------------------------------
  const ghost = await http('POST', '/telehealth/sessions/SESSION-DOES-NOT-EXIST/join', {
    token: doctorA.token,
  });
  expectStatus('a fabricated session id is refused', ghost.status, [400, 403, 404], ghost.json);

  // --- outside the join window --------------------------------------------
  //
  // Scheduled a day ago, so it is past `JOIN_CLOSES_AFTER_SECS`. A link that
  // still worked here is a room that never closes.
  const stale = await http('POST', '/telehealth/sessions', {
    token: doctorA.token,
    body: {
      patient_id: m.patient.linked_patient_id,
      // `consultation` is not a session type this API has. It used to be
      // accepted because the handler ended in `_ => VideoVisit`, so this
      // suite proved the state machine worked on a session whose type had
      // been silently replaced.
      session_type: 'VideoVisit',
      scheduled_start: now - 24 * 60 * 60,
      recording_enabled: false,
    },
  });
  if ([200, 201].includes(stale.status)) {
    const staleSession = (stale.json.session ?? stale.json) as Json;
    const staleId = String(staleSession.session_id ?? staleSession.id ?? stale.json.session_id ?? '');
    if (staleId) {
      const staleJoin = await http('POST', `/telehealth/sessions/${staleId}/join`, {
        token: doctorA.token,
      });
      expectStatus(
        'a session whose window has closed cannot be joined',
        staleJoin.status,
        [400, 403, 409, 410],
        staleJoin.json
      );
    }
  }

  // Scheduled well in the future, so it is before `JOIN_OPENS_BEFORE_SECS`.
  const early = await http('POST', '/telehealth/sessions', {
    token: doctorA.token,
    body: {
      patient_id: m.patient.linked_patient_id,
      // `consultation` is not a session type this API has. It used to be
      // accepted because the handler ended in `_ => VideoVisit`, so this
      // suite proved the state machine worked on a session whose type had
      // been silently replaced.
      session_type: 'VideoVisit',
      scheduled_start: now + 24 * 60 * 60,
      recording_enabled: false,
    },
  });
  if ([200, 201].includes(early.status)) {
    const earlySession = (early.json.session ?? early.json) as Json;
    const earlyId = String(earlySession.session_id ?? earlySession.id ?? early.json.session_id ?? '');
    if (earlyId) {
      const earlyJoin = await http('POST', `/telehealth/sessions/${earlyId}/join`, {
        token: doctorA.token,
      });
      expectStatus(
        'a session whose window has not opened cannot be joined',
        earlyJoin.status,
        [400, 403, 409, 425],
        earlyJoin.json
      );
    }
  }

  // --- recording authority -------------------------------------------------
  //
  // `may_control_recording` excludes Pharmacist and Patient. Recording a
  // consultation is a clinical and legal act, so the check is that the role
  // decides it, not the room.
  if (pharmacist) {
    const pharmRecord = await http('POST', `/telehealth/sessions/${sessionId}/recording`, {
      token: pharmacist.token,
      body: { action: 'start' },
    });
    expectStatus(
      'a pharmacist cannot control recording',
      pharmRecord.status,
      [401, 403],
      pharmRecord.json
    );
  }
  const patientRecord = await http('POST', `/telehealth/sessions/${sessionId}/recording`, {
    token: patientA.token,
    body: { action: 'start' },
  });
  expectStatus('a patient cannot control recording', patientRecord.status, [401, 403], patientRecord.json);

  // --- ending the session --------------------------------------------------
  if (doctorB) {
    // An unrelated clinician ending somebody else's consultation.
    const foreignEnd = await http('POST', `/telehealth/sessions/${sessionId}/end`, {
      token: doctorB.token,
      body: {},
    });
    record(
      'ending a session is decided by the API, not by possession of its id',
      [200, 401, 403, 404].includes(foreignEnd.status),
      `status ${foreignEnd.status}`
    );
  }

  // `body: {}` matters. Omitting it sends no JSON at all and the endpoint
  // answers 400 — and an earlier version of this section accepted 400 as a
  // pass, so the session was never ended and the "cannot rejoin" check below
  // then failed against a session that was still open. An accepted-status list
  // wide enough to swallow a client mistake will hide the next failure too.
  const end = await http('POST', `/telehealth/sessions/${sessionId}/end`, {
    token: doctorA.token,
    body: {},
  });
  expectStatus('the clinician ends the session', end.status, [200, 204], end.json);

  const ended = await http('GET', `/telehealth/sessions/${sessionId}`, { token: doctorA.token });
  const endedSession = (ended.json.session ?? ended.json) as Json;
  record(
    'the session records itself as completed',
    String(endedSession.status) === 'Completed',
    `status field is ${endedSession.status}`
  );

  // After ending, the room must not accept a new joiner — this is the
  // "link shared once" case.
  const rejoin = await http('POST', `/telehealth/sessions/${sessionId}/join`, {
    token: patientA.token,
  });
  record(
    'an ended session cannot be rejoined',
    rejoin.status === 409 && String(rejoin.json?.error?.code) === 'SESSION_ENDED',
    `status ${rejoin.status} code ${rejoin.json?.error?.code} — an ended consultation accepted a joiner`
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(API)) {
    console.error(`\n  Refusing to run against ${API}. This is a local-only harness.\n`);
    process.exit(1);
  }

  let m: Manifest;
  try {
    m = loadManifest();
  } catch (e) {
    console.error(
      `\n  No usable fixtures (${String(e)}).\n` +
        `  Run scripts/seed-browser-test-fixtures.ts first.\n`
    );
    process.exit(1);
  }

  console.log(`\nCross-role qualification against ${API}`);
  console.log(`Fixtures: ${m.staff.length} staff, patients ${m.patient.linked_patient_id} / ${m.patient_b.linked_patient_id}`);

  const sessions = await qualifySessions(m);
  await qualifyRoleMatrix(sessions);
  await qualifyRoleSurfaces(sessions);
  const patients = await qualifyPatientBoundary(m);
  await qualifyLabWorkflow(m, sessions, patients);
  await qualifySelfReview(m, sessions);
  await qualifyObjectAuthorization(m, sessions);
  await qualifyPrescriptionWorkflow(m, sessions);
  await qualifyConsentLifecycle(m, sessions, patients);
  await qualifyPatientMutation(m, sessions, patients);
  await qualifyTelehealth(m, sessions, patients);
  await qualifyAuthorizationBoundaries(m, sessions, patients);
  await qualifySessionLifecycle(sessions);
  // Last: this section registers accounts, spends grants and locks one of them.
  await qualifyCredentialRejectionPaths(m, sessions);

  const failed = checks.filter((c) => !c.passed && !c.skipped);
  const skipped = checks.filter((c) => c.skipped);
  const passed = checks.filter((c) => c.passed);

  console.log(`\n${'='.repeat(70)}`);
  console.log(
    `${passed.length}/${passed.length + failed.length} checks passed` +
      (skipped.length ? `, ${skipped.length} skipped` : '')
  );
  if (skipped.length) {
    console.log(`\n${skipped.length} SKIPPED (a control refused us, not a defect):`);
    for (const sk of skipped) console.log(`  [${sk.section}] ${sk.name}\n      ${sk.detail}`);
  }
  if (failed.length) {
    console.log(`\n${failed.length} FAILED:`);
    for (const f of failed) console.log(`  [${f.section}] ${f.name}\n      ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
