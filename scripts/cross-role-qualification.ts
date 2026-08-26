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

import { deriveCredential, openKeystore, signerFromSecret } from '../client/shared/src/auth/credentials';
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
  patient: { wallet: string; linked_patient_id: string; nfc_tag_id: string };
  patient_b: { wallet: string; linked_patient_id: string; nfc_tag_id: string };
}

// ---------------------------------------------------------------------------
// Result accounting
// ---------------------------------------------------------------------------

interface Check {
  section: string;
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];
let section = 'unknown';

function record(name: string, passed: boolean, detail: string): void {
  checks.push({ section, name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${passed ? '' : `  -- ${detail}`}`);
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

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
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
  await qualifySessionLifecycle(sessions);

  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
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
