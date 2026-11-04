/**
 * Provision the browser-test identity fixtures.
 *
 * # Why this exists
 *
 * Doctor and nurse workflows cannot be browser-tested without real accounts
 * whose credentials a tester can type. The demo identity buttons are a
 * development convenience; enabling them in a shipped image is exactly the
 * bypass the 2026-08-19 audit says not to add. The honest option is the one the
 * audit asks for: real accounts, created through the product's own onboarding
 * path. That is what this script provisions.
 *
 * # How accounts come to exist
 *
 * Every account is created the way a deployment creates it, and signs in the
 * way a person does:
 *
 *   * The administrator is bootstrapped (`POST /api/auth/bootstrap`) on a fresh
 *     database, or an existing one is named with `MEDICHAIN_ADMIN_LOGIN_ID` and
 *     `MEDICHAIN_ADMIN_PASSWORD`.
 *   * Staff are registered by the administrator (`POST /api/auth/register`),
 *     activated, and then redeem the one-time credential code the registration
 *     returned, choosing the fixture password
 *     (`POST /api/auth/credentials/redeem`).
 *   * Patients are registered by a doctor (`POST /api/register`), which returns
 *     an activation code. The patient redeems it, choosing a username and the
 *     fixture password.
 *
 * # Why it derives the proof with the client's code
 *
 * The auth proof is produced by the same module the browser uses, so the
 * fixture password becomes a verifier by exactly the derivation a real sign-in
 * later checks. A seed that computed its own proof would drift from the login
 * it is meant to exercise, and the drift would surface as a login failure
 * nobody could explain.
 *
 * # Safety
 *
 * Synthetic data only. It refuses to run against anything but an explicitly
 * named local endpoint unless `--i-understand-this-writes-accounts` is passed.
 * The credentials it writes to `.browser-test/fixtures.json` are throwaway and
 * belong in a test profile, never in a production image. They stay in that
 * file: nothing else in the repository should carry a fixture password.
 *
 * # Running it
 *
 * It must be started from `client/`. The script lives outside that workspace
 * but imports from it, and its dependencies resolve only when the vite root is
 * the workspace that installed them:
 *
 *   cd client
 *   MEDICHAIN_API_URL=http://127.0.0.1:8090/api  *   MEDICHAIN_FIXTURE_SUFFIX=.1  *   ./node_modules/.bin/vite-node ../scripts/seed-browser-test-fixtures.ts
 *
 * The manifest is written to `.browser-test/fixtures.json` at the repository
 * root regardless of where it is started from.
 */

import { deriveAuthProof, type LoginBody } from './lib/auth';
import { confirmTransaction, isTransactionDemand, type Confirmer } from './lib/transaction-authorization';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const API = process.env.MEDICHAIN_API_URL ?? 'http://localhost/api';
const BOOTSTRAP_KEY = process.env.MEDICHAIN_BOOTSTRAP_KEY;
/** An existing administrator to use instead of bootstrapping one. */
const ADMIN_LOGIN_ID = process.env.MEDICHAIN_ADMIN_LOGIN_ID;
const ADMIN_PASSWORD = process.env.MEDICHAIN_ADMIN_PASSWORD;
const FORCE = process.argv.includes('--i-understand-this-writes-accounts');
/** Keep isolated QA credentials separate from the existing database's fixture cohort. */
const FIXTURE_MANIFEST = process.env.MEDICHAIN_FIXTURE_MANIFEST;

/** Fixture password supplied for a remotely accessible synthetic demo. */
const PASSWORD = process.env.MEDICHAIN_FIXTURE_PASSWORD ?? 'BrowserTest!2026';

export interface StaffFixture {
  key:
    | 'doctor'
    | 'doctor2'
    | 'nurse'
    | 'nurse2'
    | 'admin'
    | 'pharmacist'
    | 'pharmacist2'
    | 'labtech'
    | 'labtech2'
    | 'paramedic';
  loginId: string;
  name: string;
  role: 'Doctor' | 'Nurse' | 'Admin' | 'Pharmacist' | 'LabTechnician' | 'Paramedic';
}

/**
 * Distinguishes repeat runs. Login ids are unique, so a second seed of a
 * database that already carries fixtures under another password needs its own
 * set rather than silently colliding with the first.
 */
const SUFFIX = process.env.MEDICHAIN_FIXTURE_SUFFIX ?? '';
const sfx = (base: string) => (SUFFIX ? `${base}${SUFFIX}` : base);

/**
 * `Admin` is deliberately absent from this list. `POST /api/auth/register`
 * refuses `CANNOT_REGISTER_ADMIN` and `assign_role` refuses to grant `Admin` —
 * both correct: administrators exist only via bootstrap. `main` handles the
 * admin fixture separately, either by bootstrapping one on a fresh database or
 * by re-deriving a well-known development key when that is what the existing
 * administrator turns out to be.
 */
const STAFF: StaffFixture[] = [
  { key: 'doctor', loginId: sfx('bt.doctor'), name: 'Dr Lindiwe Mokoena', role: 'Doctor' },
  // A SECOND doctor, and not a convenience. Every maker-checker workflow in
  // MediChain refuses self-approval, so a single clinician cannot exercise one:
  // with one Doctor fixture, `/api/lab/review` correctly answers
  // SELF_REVIEW_FORBIDDEN and the approval path stays untested. Proving the
  // rule and proving the workflow need two people.
  { key: 'doctor2', loginId: sfx('bt.doctor2'), name: 'Dr Yusuf Patel', role: 'Doctor' },
  { key: 'nurse', loginId: sfx('bt.nurse'), name: 'Nurse Nomsa Dlamini', role: 'Nurse' },
  // A SECOND nurse, for the same reason there is a second doctor. A shift
  // handoff is a transfer of responsibility between two people: with one nurse
  // fixture the outgoing and incoming nurse are the same account, and "the
  // ward was handed over" degrades into "the record I wrote is still there".
  // The interesting failure — a handoff that persists but never reaches the
  // person taking over — is invisible without a second identity.
  { key: 'nurse2', loginId: sfx('bt.nurse2'), name: 'Nurse Kabelo Molefe', role: 'Nurse' },
  // Pharmacist and LabTechnician exist in `Role` and gate real endpoints, but
  // had no fixture, so neither role had ever been exercised — the 2026-08-26
  // campaign recorded both as untestable for exactly this reason.
  { key: 'pharmacist', loginId: sfx('bt.pharm'), name: 'Pharmacist Ayesha Khan', role: 'Pharmacist' },
  { key: 'pharmacist2', loginId: sfx('bt.pharm2'), name: 'Pharmacist Pieter van der Merwe', role: 'Pharmacist' },
  { key: 'labtech', loginId: sfx('bt.lab'), name: 'Lab Scientist Sipho Nkosi', role: 'LabTechnician' },
  // And a second lab technician, so specimen collection and the QC/rejection
  // review that follows it can be performed by different people. Several lab
  // controls are maker-checker in the same way the clinical ones are.
  { key: 'labtech2', loginId: sfx('bt.lab2'), name: 'Lab Scientist Lerato Morake', role: 'LabTechnician' },
  { key: 'paramedic', loginId: sfx('bt.paramedic'), name: 'Paramedic Themba Sithole', role: 'Paramedic' },
];

// There is deliberately no 'EmergencyResponder' fixture.
//
// `Role` has six variants and that is not one of them: break-glass is a
// *capability*, reached through `POST /api/emergency/access`, which requires
// an `nfc_tag_id` and so binds itself to physical possession of the patient's
// card rather than to a role anybody can hold. Seeding an emergency-responder
// account would have invented a role the system does not model.

/** The synthetic patient the patient fixture is bound to. */
const PATIENT = {
  full_name: 'Thandiwe Ndlovu',
  date_of_birth: '1988-04-12',
  national_id: sfx('BT-PATIENT-0001'),
  phone: '+27000000100',
  blood_type: 'O+',
  allergies: ['penicillin'],
  current_medications: ['metformin 500mg'],
  chronic_conditions: ['type 2 diabetes'],
  emergency_contact_name: 'Sipho Ndlovu',
  emergency_contact_phone: '+27000000101',
  emergency_contact_relationship: 'spouse',
  organ_donor: true,
  dnr_status: false,
  languages: ['en'],
};

/**
 * A second, unrelated patient.
 *
 * Every "wrong patient" test needs one. Without it, an authorization probe can
 * only ask whether a clinician reaches *a* record, which passes whether or not
 * the boundary exists — the interesting question is whether Patient A's session
 * reaches Patient B's record, and that needs a B.
 */
const PATIENT_B = {
  full_name: 'Naledi Maseko',
  date_of_birth: '1975-11-30',
  national_id: sfx('BT-PATIENT-0002'),
  phone: '+27000000200',
  blood_type: 'A-',
  allergies: ['sulfa'],
  current_medications: ['amlodipine 5mg'],
  chronic_conditions: ['hypertension'],
  emergency_contact_name: 'Lerato Maseko',
  emergency_contact_phone: '+27000000201',
  emergency_contact_relationship: 'sibling',
  organ_donor: false,
  dnr_status: false,
  languages: ['en'],
};

export type Json = Record<string, unknown>;

export async function call(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  /** Who confirms a Class C demand on this call (ADR-0008). */
  confirmer?: Confirmer,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Every authenticated mutation needs one: `api/src/middleware/idempotency.rs`
  // refuses a keyed-subject mutation without it (409 IDEMPOTENCY_KEY_REQUIRED).
  //
  // A fresh key per call is right here: these are one-shot provisioning
  // requests, not retries, so replaying one would mean something has gone
  // wrong and should surface rather than be absorbed.
  if (method !== 'GET' && token) {
    headers['Idempotency-Key'] = extraHeaders['Idempotency-Key'] ?? globalThis.crypto.randomUUID();
  }
  Object.assign(headers, extraHeaders);
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(`${API}${path}`, { method, headers, body: bodyText });
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* empty body is fine for some 2xx responses */
  }
  if (token && confirmer && !extraHeaders['X-Transaction-Authorization'] && isTransactionDemand(res.status, json)) {
    const authorization = await confirmTransaction(
      (p, t, b) => call('POST', p, b, t),
      token,
      confirmer,
      json,
      bodyText ?? '',
      headers['Idempotency-Key']
    );
    if (authorization) {
      return call(method, path, body, token, confirmer, {
        'Idempotency-Key': headers['Idempotency-Key'],
        'X-Transaction-Authorization': authorization,
      });
    }
  }
  return { status: res.status, json };
}

export function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Thrown by `fail` once its diagnostic is already on the console. */
export class SeedFailure extends Error {}

export function fail(what: string, status: number, json: Json): never {
  console.error(`\n  FAILED: ${what}\n    HTTP ${status}\n    ${JSON.stringify(json)}\n`);
  // Deliberately a throw, not `process.exit(1)`. Exiting from inside an async
  // call with sockets still open aborted Node mid-teardown on Windows:
  //
  //   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c
  //
  // printed directly beneath the diagnostic above, so the last thing on the
  // console was a libuv crash rather than the reason the seed failed. Throwing
  // lets the runtime unwind; the exit status is set at the top level.
  throw new SeedFailure(what);
}

/** An account this run holds a session for. */
export interface Account {
  loginId: string;
  userId: string;
  token: string;
  role: string;
  linkedPatientId: string;
}

/**
 * Have a patient approve a clinician who must open their chart, for `days`
 * (the server allows at most 30). A grant that ends within `renewWithinDays`
 * is renewed rather than left to lapse.
 */
export async function ensurePatientAccess(
  patientId: string,
  patient: Account,
  provider: Account,
  patientPassword: string = PASSWORD,
  reason = 'Synthetic browser verification of clinical care',
  days = 7,
  renewWithinDays = 0
): Promise<void> {
  const existing = await call('GET', `/access/patient/${patientId}/grants`, undefined, patient.token);
  if (!ok(existing.status)) fail('read patient grants', existing.status, existing.json);
  const grants = Array.isArray(existing.json.grants) ? existing.json.grants as Json[] : [];
  const active = grants.some((grant) =>
    grant.provider_id === provider.userId && !grant.revoked_at &&
    Date.parse(String(grant.expires_at ?? '')) > Date.now() + renewWithinDays * 86400000
  );
  if (active) return;

  const request = await call('POST', `/access/patient/${patientId}/requests`,
    { reason }, provider.token);
  let requestId = String((request.json.request as Json | undefined)?.id ?? '');
  // A run stopped between asking and approving leaves the request pending;
  // approve that one rather than fail on asking twice.
  if (request.status === 409 && JSON.stringify(request.json).includes('ACCESS_REQUEST_ALREADY_PENDING')) {
    const pending = await call('GET', `/access/patient/${patientId}/requests`, undefined, patient.token);
    const waiting = ((pending.json.requests ?? []) as Json[]).find(
      (item) => (item.providerId ?? item.provider_id) === provider.userId && item.status === 'pending'
    );
    requestId = String(waiting?.id ?? '');
  } else if (request.status !== 201) {
    fail('request patient access', request.status, request.json);
  }
  if (!requestId) fail('find the pending access request', request.status, request.json);
  const approval = await call('POST', `/access/requests/${requestId}/approve`,
    { expires_at: new Date(Date.now() + days * 86400000).toISOString() }, patient.token,
    // The patient confirms their own decision, as in the portal.
    { loginId: patient.loginId, password: patientPassword });
  if (!ok(approval.status)) fail('patient approves access', approval.status, approval.json);
}

/** The fields of a sign-in or redeem answer this script reads. */
function accountFrom(loginId: string, body: Json): Account {
  const login = body as LoginBody;
  return {
    loginId,
    userId: String(login.user?.user_id ?? ''),
    token: String(login.access_token ?? ''),
    role: String(login.user?.role ?? ''),
    linkedPatientId: String(login.user?.linked_patient_id ?? ''),
  };
}

/**
 * Sign in exactly as a portal does. Returns `undefined` for a refusal so a
 * caller can tell "no such account yet" from a transport problem.
 */
export async function tryLogin(
  loginId: string,
  password: string,
  totpCode?: () => Promise<string>
): Promise<Account | undefined> {
  const authProof = await deriveAuthProof(password, loginId);
  const body = { identifier: loginId, auth_proof: authProof };
  let res = await call('POST', '/auth/login', body);
  // The server asks for the code either way: `mfa_required` in a 200, or a 401
  // whose error code is MFA_REQUIRED (the portals accept both, as here).
  const errorCode = String((res.json.error as Json | undefined)?.code ?? res.json.code ?? '');
  const codeNeeded =
    (res.json.mfa_required === true && !res.json.access_token) ||
    ['MFA_REQUIRED', 'TOTP_REQUIRED', 'MFA_CODE_REQUIRED'].includes(errorCode);
  if (totpCode && codeNeeded) {
    res = await call('POST', '/auth/login', { ...body, totp_code: await totpCode() });
  }
  if (res.status === 200 && res.json.access_token) return accountFrom(loginId, res.json);
  return undefined;
}

/**
 * Ask the person running this for a current authenticator code. Only an
 * administrator named through the environment is asked: a deployment's real
 * administrator has two-factor enrolled, and its codes are never stored.
 */
async function askAuthenticatorCode(): Promise<string> {
  if (!process.stdin.isTTY) {
    fail('this administrator needs an authenticator code, and there is no terminal to ask for one', 0, {});
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`  Authenticator code for ${ADMIN_LOGIN_ID} (wait for a fresh code each time): `)).trim();
  } finally {
    rl.close();
  }
}

/** Create real server state used by the lab and pharmacy browser journeys. */
async function seedClinicalWorkflows(
  patientId: string,
  doctor: Account,
  lab: Account,
  pharmacist: Account
): Promise<Json> {
  const collect = async (label: string): Promise<string> => {
    const result = await call('POST', '/clinical/specimen', {
      patient_id: patientId, specimen_type: 'whole blood', tests_ordered: 'HbA1c',
      collection_site: 'browser test clinic', notes: label,
      checklist: ['identity confirmed', 'label applied'],
    }, lab.token);
    if (!ok(result.status)) fail(`collect ${label}`, result.status, result.json);
    return String(result.json.collection_id ?? '');
  };
  const originalSpecimenId = await collect('Original specimen for recollection journey');
  const replacementSpecimenId = await collect('Replacement specimen for recollection journey');
  const rejected = await call('POST', '/clinical/specimen-rejection', {
    specimen_id: originalSpecimenId, patient_id: patientId,
    rejection_reason: 'Haemolysed synthetic sample', rejection_category: 'collection_error',
    detailed_notes: 'Browser fixture: recollection must remain visible after completion',
    rejected_by: lab.userId, recollection_required: true,
  }, lab.token);
  if (!ok(rejected.status)) fail('reject original specimen', rejected.status, rejected.json);

  const prescription = await call('POST', '/e-prescriptions', {
    patient_id: patientId, medication_name: 'Synthetic Dual Check', strength: '1mg',
    form: 'tablet', quantity: 20, days_supply: 10, directions: 'Synthetic test only',
    refills_allowed: 0, is_controlled: false,
    policy_category: 'organization-approved-category', force_secondary_verification: true,
    pharmacy_ncpdp: 'BROWSER-001', pharmacy_name: 'Browser Test Pharmacy',
    diagnosis_codes: ['Z00.0'], patient_instructions: 'Synthetic test only',
  }, doctor.token);
  if (!ok(prescription.status)) fail('create dual-check prescription', prescription.status, prescription.json);
  const prescriptionId = String(prescription.json.prescription_id ?? '');
  for (const [path, body, actor, label] of [
    [`/e-prescriptions/${prescriptionId}/sign`, { signature_method: 'password', attestation: 'Browser workflow fixture' }, doctor, 'sign'],
    [`/e-prescriptions/${prescriptionId}/transmit`, {}, doctor, 'transmit'],
    [`/e-prescriptions/${prescriptionId}/receive`, {}, pharmacist, 'receive'],
    [`/e-prescriptions/${prescriptionId}/start`, {}, pharmacist, 'start'],
  ] as const) {
    const result = await call('POST', path, body, actor.token);
    if (!ok(result.status)) fail(`${label} dual-check prescription`, result.status, result.json);
  }
  return {
    lab: { rejection_id: String(rejected.json.rejection_id ?? ''), original_specimen_id: originalSpecimenId, replacement_specimen_id: replacementSpecimenId },
    pharmacy: { prescription_id: prescriptionId, prescribed_quantity: 20 },
  };
}

async function assertLocalDemoDeployment(): Promise<void> {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(API);
  if (!isLocal && !FORCE) {
    console.error(
      `\n  Refusing to run against ${API}.\n` +
        `  This creates real accounts. Point MEDICHAIN_API_URL at a local test\n` +
        `  deployment, or pass --i-understand-this-writes-accounts.\n`
    );
    throw new SeedFailure('stopped');
  }

  const health = await call('GET', '/../health');
  if (!ok(health.status)) {
    console.error(`\n  API is not reachable at ${API} (health -> ${health.status}).\n`);
    throw new SeedFailure('stopped');
  }
}

/**
 * Turn a one-time code into a working credential.
 *
 * `identifier` is what the grant was issued against: an employee id for staff,
 * the patient's health ID for a patient. `loginId` is the login the account will
 * carry from now on and is what the proof is derived under; for staff it is the
 * identifier itself, for a patient it is the username chosen here.
 */
async function redeem(
  what: string,
  identifier: string,
  code: string,
  loginId: string,
  username?: string,
  password: string = PASSWORD
): Promise<Account> {
  // Setting a password sends it once, for the server's strength check.
  const res = await call('POST', '/auth/credentials/redeem', {
    identifier,
    code,
    password,
    ...(username ? { username } : {}),
  });
  if (!ok(res.status) || !res.json.access_token) fail(`redeem the code for ${what}`, res.status, res.json);
  return accountFrom(loginId, res.json);
}

/** Read `credential_code`, tolerating the envelope a registration answers in. */
function credentialCodeOf(json: Json): string {
  return String(json.credential_code ?? (json.credential as Json | undefined)?.code ?? '');
}

/** Read the activation code a patient registration returns. */
function activationCodeOf(json: Json): string {
  const activation = json.activation as Json | undefined;
  return String(activation?.code ?? json.activation_code ?? '');
}

/**
 * The administrator: an existing one named by the environment, one left by an
 * earlier run, or a freshly bootstrapped first admin.
 */
export async function obtainAdmin(): Promise<Account> {
  if (ADMIN_LOGIN_ID) {
    if (!ADMIN_PASSWORD) {
      console.error('\n  MEDICHAIN_ADMIN_LOGIN_ID is set without MEDICHAIN_ADMIN_PASSWORD.\n');
      throw new SeedFailure('stopped');
    }
    const existing = await tryLogin(ADMIN_LOGIN_ID, ADMIN_PASSWORD, askAuthenticatorCode);
    if (!existing) {
      console.error(`\n  Could not sign in as the named administrator '${ADMIN_LOGIN_ID}'.\n`);
      throw new SeedFailure('stopped');
    }
    console.log(`  · using existing administrator ${ADMIN_LOGIN_ID}`);
    return existing;
  }

  const fixtureLogin = sfx('bt.admin');
  const earlier = await tryLogin(fixtureLogin, PASSWORD);
  if (earlier) {
    console.log(`  · using the administrator from an earlier run (${fixtureLogin})`);
    return earlier;
  }

  if (!BOOTSTRAP_KEY) {
    console.error('\n  Set MEDICHAIN_BOOTSTRAP_KEY to the API bootstrap key for a fresh database.\n');
    throw new SeedFailure('stopped');
  }
  const bootstrap = await call('POST', '/auth/bootstrap', {
    login_id: fixtureLogin,
    name: 'Administrator Zanele Khumalo',
    secret_key: BOOTSTRAP_KEY,
  });
  if (!ok(bootstrap.status)) {
    console.error(
      `\n  This deployment is already bootstrapped (bootstrap -> ${bootstrap.status}),\n` +
        `  and '${fixtureLogin}' with the fixture password does not sign in. Re-run\n` +
        `  against a fresh database, or set MEDICHAIN_ADMIN_LOGIN_ID and\n` +
        `  MEDICHAIN_ADMIN_PASSWORD to an existing administrator.\n`
    );
    throw new SeedFailure('stopped');
  }
  const code = credentialCodeOf(bootstrap.json);
  if (!code) fail(`bootstrap ${fixtureLogin} returned no credential code`, bootstrap.status, bootstrap.json);
  const admin = await redeem('bootstrap administrator', fixtureLogin, code, fixtureLogin);
  console.log(`  · bootstrapped administrator ${fixtureLogin}`);
  return admin;
}

/** How the administrator confirms a Class C demand: with their own password. */
export function adminConfirmer(admin: Account): Confirmer {
  return {
    loginId: admin.loginId,
    password: ADMIN_LOGIN_ID ? ADMIN_PASSWORD : PASSWORD,
    ...(ADMIN_LOGIN_ID ? { totp: askAuthenticatorCode } : {}),
  };
}

/** Register a staff fixture, activate it, and redeem its credential code. */
export async function provisionStaff(
  admin: Account,
  fixture: StaffFixture,
  password: string = PASSWORD
): Promise<Account> {
  const reg = await call(
    'POST',
    '/auth/register',
    { name: fixture.name, role: fixture.role, login_id: fixture.loginId },
    admin.token
  );
  if (!ok(reg.status)) fail(`register ${fixture.key}`, reg.status, reg.json);
  const userId = String(reg.json.user_id ?? '');
  const code = credentialCodeOf(reg.json);
  if (!userId || !code) fail(`register ${fixture.key} returned no user_id / credential_code`, reg.status, reg.json);

  // Accounts created by an admin start `pending`, and only an active account
  // may sign in: an unactivated fixture is refused at every later step, which
  // reads like an authentication bug.
  // Activation is an account-status change, confirmed as the administrator (ADR-0008 Class C).
  const act = await call('PUT', `/users/${userId}`, { status: 'active' }, admin.token, adminConfirmer(admin));
  if (!ok(act.status)) fail(`activate ${fixture.key}`, act.status, act.json);

  return redeem(fixture.key, fixture.loginId, code, fixture.loginId, undefined, password);
}

/**
 * Register a patient through a doctor and redeem the activation code the way
 * the patient does: choosing a username and a password.
 */
/** Where the manifest is written; read back to recover what an earlier run recorded. */
function manifestPath(): string {
  const here = dirname(dirname(fileURLToPath(import.meta.url)));
  return FIXTURE_MANIFEST ?? join(here, '.browser-test', 'fixtures.json');
}

/** The NFC tag an earlier run recorded for this patient, if the manifest names one. */
function previousNfcTag(patientId: string): string | undefined {
  if (!existsSync(manifestPath())) return undefined;
  try {
    const previous = JSON.parse(readFileSync(manifestPath(), 'utf8')) as Record<string, Json | undefined>;
    for (const key of ['patient', 'patient_b']) {
      const entry = previous[key];
      if (entry?.linked_patient_id === patientId && entry.nfc_tag_id) return String(entry.nfc_tag_id);
    }
  } catch {
    // An unreadable manifest is regenerated below; fall back to the dashboard.
  }
  return undefined;
}

export async function provisionPatient(
  admin: Account,
  doctor: Account,
  record: Json,
  username: string,
  password: string = PASSWORD
): Promise<{ account: Account; patientId: string; nfcTagId: string }> {
  const existing = await tryLogin(username, password);
  if (existing) {
    const patientId = existing.linkedPatientId;
    if (!patientId) fail(`existing patient ${username} has no linked record`, 0, {});
    // The tag this seeder recorded last time. The admin dashboard only scans the
    // first 100 patients, so on a long-lived stack it stops listing this one.
    const recorded = previousNfcTag(patientId);
    if (recorded) return { account: existing, patientId, nfcTagId: recorded };
    const dashboard = await call('GET', '/dashboard/admin', undefined, admin.token);
    if (!ok(dashboard.status)) fail(`read NFC tags for ${username}`, dashboard.status, dashboard.json);
    const tags = ((dashboard.json.nfc_cards as Json | undefined)?.cards ?? []) as Json[];
    const tag = tags.find((item) => item.patient_id === patientId && item.is_active === true);
    const nfcTagId = String(tag?.id ?? '');
    if (!nfcTagId) fail(`existing patient ${username} has no active NFC tag`, dashboard.status, {});
    return { account: existing, patientId, nfcTagId };
  }
  const created = await call('POST', '/register', record, doctor.token);
  if (!ok(created.status)) fail(`register synthetic patient ${username}`, created.status, created.json);
  const patientId = String(created.json.patient_id ?? '');
  const nfcTagId = String(created.json.nfc_tag_id ?? '');
  const code = activationCodeOf(created.json);
  if (!patientId || !code) fail(`register ${username} returned no patient_id / activation code`, created.status, created.json);

  // The username is the login id, and the proof is derived under it.
  const account = await redeem(`patient ${username}`, patientId, code, username, username, password);
  return { account, patientId, nfcTagId };
}

/** The issuance-registry shape every patient's medical ID has. */
const MEDICAL_ID_SHAPE = /^MCHI-[0-9A-Z]{10,}$/;

/**
 * The medical ID the registry issued for `patientId`, read the way the patient
 * reads their own card. A patient fixture without one is refused: a patient is
 * identified by an issued medical ID, never by an account key.
 */
export async function issuedMedicalId(patientId: string, token: string): Promise<string> {
  const card = await call('GET', `/medical-id/${patientId}`, undefined, token);
  if (!ok(card.status)) fail(`read the medical ID for ${patientId}`, card.status, card.json);
  const medicalId = String(card.json.national_health_id ?? '');
  if (!MEDICAL_ID_SHAPE.test(medicalId)) {
    fail(`patient ${patientId} has no issued medical ID`, card.status, { national_health_id: medicalId || '(unset)' });
  }
  return medicalId;
}

async function main(): Promise<void> {
  if (FIXTURE_MANIFEST && !isAbsolute(FIXTURE_MANIFEST)) {
    console.error('MEDICHAIN_FIXTURE_MANIFEST must be an absolute path.');
    throw new SeedFailure('stopped');
  }
  await assertLocalDemoDeployment();
  console.log(`\nProvisioning browser-test fixtures against ${API}\n`);

  // ---- Administrator ------------------------------------------------------
  const admin = await obtainAdmin();

  // ---- Staff --------------------------------------------------------------
  //
  // Resumable, because a half-seeded database was previously a dead end. A
  // fixture that already signs in with the fixture password is adopted as it
  // is and never re-registered; one that does not is provisioned. A login id
  // that exists under a password this script does not hold makes the
  // registration refuse (`409`), which is the right stop: adopting it would
  // hand every later step somebody else's account.
  const staff: Array<Account & { pre_existing?: boolean }> = [];
  const adopted: string[] = [];
  for (const fixture of STAFF) {
    const already = await tryLogin(fixture.loginId, PASSWORD);
    if (already) {
      adopted.push(fixture.loginId);
      console.log(`  · ${fixture.role.padEnd(6)} ${fixture.loginId}  ${already.userId}  (from an earlier run)`);
      staff.push({ ...already, role: fixture.role, pre_existing: true });
      continue;
    }
    const account = await provisionStaff(admin, fixture);
    console.log(`  · ${fixture.role.padEnd(6)} ${fixture.loginId}  ${account.userId}`);
    staff.push({ ...account, role: fixture.role });
  }

  if (adopted.length) {
    console.log(`\n  ${adopted.length} fixture(s) already existed and were adopted: ${adopted.join(', ')}.\n`);
  }

  const staffBy = (loginId: string): Account => {
    const found = staff.find((s) => s.loginId === loginId);
    if (!found) fail(`fixture ${loginId} is missing`, 0, {});
    return found;
  };
  const doctor = staffBy(sfx('bt.doctor'));
  const lab = staffBy(sfx('bt.lab'));
  const pharmacist = staffBy(sfx('bt.pharm'));

  // ---- Patient record + bound patient account -----------------------------
  const a = await provisionPatient(admin, doctor, PATIENT, sfx('btpatient'));
  const patientId = a.patientId;
  console.log(`  · Patient ${a.account.loginId} (${a.account.userId}) -> ${patientId}`);

  // ---- Preflight ----------------------------------------------------------
  // Every fixture is proved usable here rather than assumed. A fixture that
  // cannot sign in is worse than no fixture: the tester spends the session
  // debugging the harness instead of the product.
  console.log('\nPreflight');

  for (const s of [admin, ...staff]) {
    const password = s.loginId === admin.loginId ? (ADMIN_PASSWORD ?? PASSWORD) : PASSWORD;
    const again = await tryLogin(s.loginId, password);
    if (!again) fail(`preflight login ${s.loginId}`, 0, { note: 'the fixture credential does not sign in' });
    console.log(`  ✓ ${s.loginId} signs in`);
  }

  const patientSession = await tryLogin(a.account.loginId, PASSWORD);
  if (!patientSession) fail(`preflight login ${a.account.loginId}`, 0, {});
  const self = await call('GET', `/patients/${patientId}`, undefined, patientSession.token);
  if (!ok(self.status)) fail('preflight patient reads own record', self.status, self.json);
  console.log('  ✓ patient reads its own linked record');

  const me = await call('GET', '/auth/me', undefined, patientSession.token);
  const linked = String((me.json.user as Json | undefined)?.linked_patient_id ?? me.json.linked_patient_id ?? '');
  if (linked !== patientId) {
    fail('preflight linked_patient_id binding', me.status, {
      expected: patientId,
      actual: linked || '(unset)',
      note: 'The patient account is not bound to the record; the dashboard would show a generated identity.',
    });
  }
  console.log('  ✓ linked_patient_id matches the seeded record');
  const medicalId = await issuedMedicalId(patientId, patientSession.token);
  console.log(`  ✓ patient carries issued medical ID ${medicalId}`);

  // ---- Second patient, for wrong-patient authorization tests --------------
  const b = await provisionPatient(admin, doctor, PATIENT_B, sfx('btpatientb'));
  console.log(`  · Patient B ${b.account.loginId} (${b.account.userId}) -> ${b.patientId}`);
  const patientBSession = await tryLogin(b.account.loginId, PASSWORD);
  if (!patientBSession) fail(`preflight login ${b.account.loginId}`, 0, {});
  const medicalIdB = await issuedMedicalId(b.patientId, patientBSession.token);
  console.log(`  ✓ patient B carries issued medical ID ${medicalIdB}`);

  // These are patient-approved, time-bounded grants. The unrelated second
  // patient has no grant, so wrong-patient denial checks remain meaningful.
  for (const provider of [
    doctor,
    staffBy(sfx('bt.doctor2')),
    staffBy(sfx('bt.nurse')),
    staffBy(sfx('bt.nurse2')),
    lab,
    staffBy(sfx('bt.lab2')),
    pharmacist,
    staffBy(sfx('bt.pharm2')),
    admin,
  ]) {
    await ensurePatientAccess(patientId, patientSession, provider);
  }
  console.log('  ✓ primary patient approved browser clinicians for seven days');

  const workflows = await seedClinicalWorkflows(patientId, doctor, lab, pharmacist);
  console.log('  ✓ seeded lab recollection and dual-pharmacist browser workflows');

  // ---- Fixture contract ---------------------------------------------------
  //
  // {user_id, login_id, password, linked_patient_id, medical_id, nfc_tag_id}:
  // no key material. Every consumer signs in with `login_id` + `password`, and
  // every patient is identified by its issued `medical_id`.
  const signIn = 'POST /api/auth/login (login id + auth proof derived from the password)';
  const adminEntry = {
    role: 'Admin',
    user_id: admin.userId,
    login_id: admin.loginId,
    // An administrator supplied through the environment keeps its password
    // out of this file: consumers fall back to MEDICHAIN_ADMIN_PASSWORD.
    ...(ADMIN_LOGIN_ID ? {} : { password: PASSWORD }),
    sign_in: signIn,
  };
  const manifest = {
    generated_at: new Date().toISOString(),
    api: API,
    warning:
      'Synthetic browser-test fixtures. Throwaway credentials — never provision these in a production image.',
    administrator_user_id: admin.userId,
    staff: [
      ...staff.map((s) => ({
        role: s.role,
        user_id: s.userId,
        login_id: s.loginId,
        password: PASSWORD,
        ...(s.pre_existing ? { pre_existing: 'true' } : {}),
        sign_in: signIn,
      })),
      adminEntry,
    ],
    workflows,
    patient_b: {
      role: 'Patient',
      user_id: b.account.userId,
      login_id: b.account.loginId,
      password: PASSWORD,
      linked_patient_id: b.patientId,
      medical_id: medicalIdB,
      nfc_tag_id: b.nfcTagId,
      purpose: 'the unrelated patient every wrong-patient authorization probe needs',
      expected_dashboard: {
        full_name: PATIENT_B.full_name,
        blood_type: PATIENT_B.blood_type,
      },
    },
    patient: {
      role: 'Patient',
      user_id: a.account.userId,
      login_id: a.account.loginId,
      password: PASSWORD,
      linked_patient_id: patientId,
      medical_id: medicalId,
      nfc_tag_id: a.nfcTagId,
      sign_in: signIn,
      expected_dashboard: {
        full_name: PATIENT.full_name,
        blood_type: PATIENT.blood_type,
        allergies: PATIENT.allergies,
        chronic_conditions: PATIENT.chronic_conditions,
        current_medications: PATIENT.current_medications,
      },
    },
  };

  // Anchored to this file's location, not to the process's working directory.
  // The runner has to start in `client/` (see the header), so a relative path
  // silently wrote the manifest to `client/.browser-test/` while every reader
  // looked for it at the repository root.
  mkdirSync(dirname(manifestPath()), { recursive: true });
  writeFileSync(manifestPath(), JSON.stringify(manifest, null, 2));

  const rows = manifest.staff
    .map((s) => `  ${s.role.padEnd(13)}  ${s.login_id.padEnd(14)} / ${'password' in s ? s.password : '(MEDICHAIN_ADMIN_PASSWORD)'}`)
    .join('\n');

  console.log(`
Fixtures written to ${manifestPath()}

${rows}
  Patient        ${a.account.loginId.padEnd(14)} / ${PASSWORD}
                 linked to ${patientId}, medical ID ${medicalId}

Teardown: drop the test database volume, or delete these accounts. Do not carry
them into any image that serves real patients.
`);
}

// Run unless a script imported this for its helpers (`lib/seed-as-library.ts`).
// Not an argv check: under vite-node, the documented way to run this, the
// script's own path is not in `process.argv` at all, so that check never
// matched and the seeder exited 0 having written nothing.
const invokedDirectly = !(globalThis as { __medichainSeedAsLibrary?: boolean }).__medichainSeedAsLibrary;
if (invokedDirectly) main().catch((err) => {
  // A `SeedFailure` has already printed the only useful thing about itself, and
  // a stack trace through the fetch helpers adds nothing. Anything else is
  // unexpected and gets printed in full.
  if (!(err instanceof SeedFailure)) console.error(err);
  // `process.exitCode`, not `process.exit()` — see the comment on `fail`.
  process.exitCode = 1;
});
