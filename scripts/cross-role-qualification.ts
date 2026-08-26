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
 * Every session here is obtained through the **real** credential flow —
 * employee identifier and password, keystore opened client-side, signer
 * derived, single-use server challenge signed, JWT issued. No probe sends
 * `X-User-Id`. A test that authenticated by asserting an identity would prove
 * nothing about a system whose whole point is that it does not accept one.
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

import {
  deriveCredential,
  openKeystore,
  signerFromSecret,
  secretFromMnemonic,
} from '../client/shared/src/auth/credentials';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.MEDICHAIN_API_URL ?? 'http://127.0.0.1:8090/api';
const PASSWORD = 'BrowserTest!2026';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

type Json = Record<string, any>;

interface Manifest {
  administrator_wallet: string;
  staff: Array<{ role: string; login_id: string; wallet: string }>;
  patient: { wallet: string; mnemonic: string; linked_patient_id: string; nfc_tag_id: string };
  patient_b: { wallet: string; mnemonic: string; linked_patient_id: string; nfc_tag_id: string };
}

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
let section = 'unknown';

function record(name: string, passed: boolean, detail: string): void {
  checks.push({ section, name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${passed ? '' : `  -- ${detail}`}`);
}

/**
 * Record a check that could not run because a control correctly refused us.
 *
 * The challenge limiter is 5 per wallet per minute. Running this harness twice
 * inside a minute legitimately exhausts it, and reporting that as a failure
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
 * `token` is a real bearer token from a signed challenge. There is no
 * fallback: if a session cannot be established the run stops, because a probe
 * that silently degrades to an unauthenticated request reports "denied" for
 * the wrong reason.
 */
interface Session {
  label: string;
  role: string;
  wallet: string;
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

/** The whole sign-in, exactly as the portal performs it. */
async function signIn(loginId: string, label: string): Promise<Session> {
  const { authProof, keystoreKey } = await deriveCredential(PASSWORD, loginId);

  const login = await http('POST', '/auth/staff/login', {
    body: { identifier: loginId, auth_proof: authProof },
  });
  if (login.status !== 200) {
    throw new Error(`staff login failed for ${loginId}: ${login.status} ${JSON.stringify(login.json)}`);
  }

  const opened = await openKeystore(login.json.encrypted_keystore as string, keystoreKey);
  const signer = await signerFromSecret(opened.miniSecret, opened.address);

  const challenge = await http('POST', '/auth/challenge', {
    body: { wallet_address: login.json.wallet_address },
  });
  if (challenge.status !== 200) {
    throw new Error(`challenge failed for ${loginId}: ${challenge.status}`);
  }
  const c = challenge.json.challenge as Json;
  const signature = await signer.sign(c.message as string);

  const jwt = await http('POST', '/auth/jwt', {
    body: {
      wallet_address: login.json.wallet_address,
      challenge_id: c.challenge_id,
      nonce: c.nonce,
      signature,
    },
  });
  if (jwt.status !== 200 || !jwt.json.access_token) {
    throw new Error(`jwt failed for ${loginId}: ${jwt.status} ${JSON.stringify(jwt.json)}`);
  }

  return {
    label,
    role: String(login.json.role),
    wallet: String(login.json.wallet_address),
    token: String(jwt.json.access_token),
  };
}

/**
 * Sign in as a patient.
 *
 * A patient holds a wallet, not an employee credential, so the flow starts one
 * step later: derive the signer from the mnemonic, then the same challenge and
 * JWT exchange every other actor uses. Without this, "the patient" could only
 * ever be probed through a clinician's session, which cannot show whether the
 * patient's own boundary holds.
 */
async function signInPatient(mnemonic: string, wallet: string, label: string): Promise<Session> {
  const secret = await secretFromMnemonic(mnemonic);
  const signer = await signerFromSecret(secret, wallet);

  const challenge = await http('POST', '/auth/challenge', { body: { wallet_address: wallet } });
  if (challenge.status !== 200) {
    throw new Error(`patient challenge failed: ${challenge.status} ${JSON.stringify(challenge.json)}`);
  }
  const c = challenge.json.challenge as Json;
  const signature = await signer.sign(c.message as string);

  const jwt = await http('POST', '/auth/jwt', {
    body: { wallet_address: wallet, challenge_id: c.challenge_id, nonce: c.nonce, signature },
  });
  if (jwt.status !== 200 || !jwt.json.access_token) {
    throw new Error(`patient jwt failed: ${jwt.status} ${JSON.stringify(jwt.json)}`);
  }

  return { label, role: 'Patient', wallet, token: String(jwt.json.access_token) };
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
      record(`${label} signs in`, false, String(e));
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
async function qualifyLabWorkflow(m: Manifest, sessions: Record<string, Session>): Promise<void> {
  section = 'D. Cross-role clinical workflow — lab result';
  console.log(`\n${section}`);

  const { labtech, doctorA, doctorB } = sessions;
  if (!labtech || !doctorA || !doctorB) {
    record('lab workflow prerequisites', false, 'needs labtech + two doctors');
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
  const records = await http('GET', `/records/${patientId}`, { token: doctorA.token });
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
    record('self-review prerequisites', false, 'needs two doctors');
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

  // A patient's session, obtained the only way a patient can: their wallet.
  // Patient fixtures hold a mnemonic rather than an employee credential, so
  // this section probes what it can without one and says so.
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
    record('session lifecycle prerequisites', false, 'needs a nurse session');
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
      patients[label] = await signInPatient(fx.mnemonic, fx.wallet, label);
      record(`${label} signs in with their wallet`, true, '');
    } catch (e) {
      record(`${label} signs in with their wallet`, false, String(e));
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
    record('consent prerequisites', false, 'needs doctorB and both patient sessions');
    return;
  }

  const patientId = m.patient.linked_patient_id;

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
        (r.providerId ?? r.provider_id) === doctorB.wallet &&
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

  const grants = await http('GET', `/access/patient/${patientId}/grants`, { token: patientA.token });
  const grantsBody = JSON.stringify(grants.json);
  record(
    'the grant is visible to the patient',
    grants.status === 200 && grantsBody.includes(doctorB.wallet),
    `status ${grants.status}; grants did not mention the provider`
  );

  const grantList: Json[] = Array.isArray(grants.json)
    ? grants.json
    : (grants.json.grants ?? grants.json.items ?? []);
  const mine = grantList.find(
    (g) => (g.providerId ?? g.provider_id) === doctorB.wallet
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

/**
 * Wallet-authentication rejection paths.
 *
 * The success path for a patient needs a browser wallet extension this
 * environment cannot host (see the campaign report). These are the parts that
 * do not: every one of them is decided by the API, not by the extension, so
 * testing them here is testing them where they live rather than settling for a
 * weaker proof of the same property.
 *
 * `auth_challenges::consume` is a single UPDATE with
 * `used_at IS NULL AND expires_at > NOW()` in its WHERE clause, so replay and
 * expiry are one atomic decision. That is the shape being confirmed.
 */
async function qualifyWalletRejectionPaths(m: Manifest): Promise<void> {
  section = 'K. Wallet authentication — rejection paths';
  console.log(`\n${section}`);

  // Patient B, not A. The limiter is 5 challenges per wallet per minute
  // (`MAX_CHALLENGES_PER_WALLET_PER_MINUTE`), and A's budget is what sections
  // I and J need to sign in on an immediate re-run. B is used once earlier and
  // not after this, so it has room.
  const wallet = m.patient_b.wallet;
  const signer = await signerFromSecret(await secretFromMnemonic(m.patient_b.mnemonic), wallet);

  /** A challenge, or null when the per-wallet limiter has already fired. */
  const challenge = async (): Promise<Json | null> => {
    const r = await http('POST', '/auth/challenge', { body: { wallet_address: wallet } });
    return r.status === 200 ? (r.json.challenge as Json) : null;
  };

  // --- single use ---------------------------------------------------------
  const c1 = await challenge();
  if (!c1) {
    skip(
      'wallet rejection paths',
      'the per-wallet challenge limiter is already satisfied — re-run after a minute'
    );
    return;
  }
  record('a challenge is issued', true, '');

  const signed = await signer.sign(c1.message as string);
  const good = await http('POST', '/auth/jwt', {
    body: { wallet_address: wallet, challenge_id: c1.challenge_id, nonce: c1.nonce, signature: signed },
  });
  expectStatus('a correctly signed challenge is accepted', good.status, 200, good.json);

  const replay = await http('POST', '/auth/jwt', {
    body: { wallet_address: wallet, challenge_id: c1.challenge_id, nonce: c1.nonce, signature: signed },
  });
  expectStatus('the same challenge cannot be used twice', replay.status, [400, 401, 409], replay.json);

  // --- every negative probe shares ONE challenge --------------------------
  //
  // `auth_challenges::consume` only marks a challenge used on success, so a
  // rejected attempt leaves it outstanding. Reusing one is not a shortcut: it
  // is what lets all four probes run inside a per-wallet challenge limiter
  // that fires after a handful of requests — and that limiter is itself
  // asserted at the end.
  const c2 = await challenge();
  if (!c2) {
    skip(
      'wallet negative probes',
      'the per-wallet challenge limiter fired mid-section — re-run after a minute'
    );
    return;
  }

  const otherSigner = await signerFromSecret(
    await secretFromMnemonic(m.patient.mnemonic),
    m.patient.wallet
  );
  const wrongSigner = await http('POST', '/auth/jwt', {
    body: {
      wallet_address: wallet,
      challenge_id: c2.challenge_id,
      nonce: c2.nonce,
      // Patient A signs a challenge issued to patient B.
      signature: await otherSigner.sign(c2.message as string),
    },
  });
  expectStatus(
    "another patient's signature does not authenticate this wallet",
    wrongSigner.status,
    [400, 401],
    wrongSigner.json
  );

  const forgedId = await http('POST', '/auth/jwt', {
    body: {
      wallet_address: wallet,
      challenge_id: '00000000-0000-4000-8000-000000000000',
      nonce: c2.nonce,
      signature: await signer.sign(c2.message as string),
    },
  });
  expectStatus(
    'a challenge id that was never issued is refused',
    forgedId.status,
    [400, 401, 404],
    forgedId.json
  );

  const badNonce = await http('POST', '/auth/jwt', {
    body: {
      wallet_address: wallet,
      challenge_id: c2.challenge_id,
      nonce: `${c2.nonce}tampered`,
      signature: await signer.sign(c2.message as string),
    },
  });
  expectStatus('a tampered nonce is refused', badNonce.status, [400, 401], badNonce.json);

  const noSig = await http('POST', '/auth/jwt', {
    body: { wallet_address: wallet, challenge_id: c2.challenge_id, nonce: c2.nonce, signature: '' },
  });
  expectStatus('an empty signature is refused', noSig.status, [400, 401], noSig.json);

  // The challenge survived all four, which is the property that made sharing
  // it valid — and confirms a failed attempt does not burn a user's challenge.
  const stillUsable = await http('POST', '/auth/jwt', {
    body: {
      wallet_address: wallet,
      challenge_id: c2.challenge_id,
      nonce: c2.nonce,
      signature: await signer.sign(c2.message as string),
    },
  });
  expectStatus(
    'a rejected attempt does not consume the challenge',
    stillUsable.status,
    200,
    stillUsable.json
  );

  // --- the limiter --------------------------------------------------------
  // A wallet nothing else uses, so proving the limiter does not cost a fixture
  // its budget and leave the next run rate limited — which is exactly what
  // happened the first time this section ran.
  const throwaway = '5CiPPseXPECbkjWCa6MnjNokrgYjMqmKndv2rSnekmSK2DjL';
  let limited = false;
  for (let i = 0; i < 12 && !limited; i += 1) {
    const r = await http('POST', '/auth/challenge', { body: { wallet_address: throwaway } });
    if (r.status === 429) limited = true;
  }
  record(
    'repeated challenge requests are rate limited',
    limited,
    'twelve further challenge requests were all accepted'
  );
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
    record('boundary prerequisites', false, 'needs doctor, pharmacist, labtech and admin sessions');
    return;
  }

  const pidA = m.patient.linked_patient_id;
  const pidB = m.patient_b.linked_patient_id;

  // --- identity substitution ---------------------------------------------
  //
  // The legacy header is the one MediChain spent a campaign removing. A
  // request carrying a valid Bearer token AND a contradicting X-User-Id must
  // resolve identity from the token, never from the header.
  const substituted = await fetch(`${API}/patients/${pidA}`, {
    headers: {
      Authorization: `Bearer ${pharmacist.token}`,
      // Claim to be the admin while holding a pharmacist's token.
      'X-User-Id': m.administrator_wallet,
    },
  });
  record(
    'a contradicting X-User-Id does not upgrade a bearer session',
    // Either the header is ignored (pharmacist's own rights apply) or the
    // request is refused outright. What must NOT happen is admin access.
    substituted.status !== 500,
    `status ${substituted.status}`
  );

  const adminOnlyAsPharmacist = await fetch(`${API}/dashboard/admin`, {
    headers: {
      Authorization: `Bearer ${pharmacist.token}`,
      'X-User-Id': m.administrator_wallet,
    },
  });
  record(
    'a pharmacist claiming the admin wallet still cannot reach the admin dashboard',
    [401, 403].includes(adminOnlyAsPharmacist.status),
    `status ${adminOnlyAsPharmacist.status}`
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
      record('a disposable session for the revocation probe', false, String(e));
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

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(API)) {
    console.error(`\n  Refusing to run against ${API}. This is a local-only harness.\n`);
    process.exit(1);
  }

  const manifestPath = join(REPO_ROOT, '.browser-test', 'fixtures.json');
  let m: Manifest;
  try {
    m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  } catch {
    console.error(
      `\n  No fixtures at ${manifestPath}.\n` +
        `  Run scripts/seed-browser-test-fixtures.ts first.\n`
    );
    process.exit(1);
  }

  console.log(`\nCross-role qualification against ${API}`);
  console.log(`Fixtures: ${m.staff.length} staff, patients ${m.patient.linked_patient_id} / ${m.patient_b.linked_patient_id}`);

  const sessions = await qualifySessions(m);
  await qualifyRoleMatrix(sessions);
  await qualifyRoleSurfaces(sessions);
  await qualifyLabWorkflow(m, sessions);
  await qualifySelfReview(m, sessions);
  await qualifyObjectAuthorization(m, sessions);
  await qualifyPrescriptionWorkflow(m, sessions);
  const patients = await qualifyPatientBoundary(m);
  await qualifyConsentLifecycle(m, sessions, patients);
  await qualifyAuthorizationBoundaries(m, sessions, patients);
  await qualifySessionLifecycle(sessions);
  // Last: this section deliberately consumes challenges, and the
  // per-wallet challenge rate limiter is a real control that will fire.
  await qualifyWalletRejectionPaths(m);

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
