import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fixtureManifestPath } from './fixture-manifest';
import type { APIRequestContext, PlaywrightWorkerArgs, TestInfo } from '@playwright/test';
import { deriveAuthProof } from '../../shared/src/auth/proof';

/**
 * Identity helpers for the browser suites, shared by both portals' specs.
 *
 * # What this file is for
 *
 * Sign-in is `POST /api/auth/login` with a proof derived from the password;
 * activation and reset are one-time codes redeemed at `/api/auth/credentials/
 * redeem`; step-up is a TOTP code. A spec that needs a *throwaway* person (one it
 * may lock out, re-password, revoke or enrol in two-factor without breaking the
 * shared fixtures every other suite signs in as) creates one here, through the
 * same endpoints a deployment uses. Nothing here bypasses authentication: an
 * administrator provisions, the new person redeems.
 *
 * # Request budget
 *
 * The API rate-limits at 60 requests a minute per IP and the browser suites run
 * on one worker, so every helper is a small fixed number of calls and none of
 * them polls. A spec that provisions one person spends roughly six requests.
 *
 * # Two-factor and the shared administrator
 *
 * Creating staff and resetting credentials are Class B operations: outside demo
 * mode the API refuses an administrator who is not enrolled in TOTP and freshly
 * stepped up (`MFA_ENROLLMENT_REQUIRED`, `MFA_REQUIRED`). `AdminApi` meets each
 * refusal only when it happens, so a demo-mode API (which exempts the gate) costs
 * no enrolment at all, and a production-shaped one is enrolled just long enough
 * for the spec, then released. `release()` MUST run (`afterAll`/`finally`): an
 * administrator left enrolled makes every other suite's admin sign-in ask for a
 * code it does not have.
 */

/** The fixture password the seeder gives every account it creates. */
export const FIXTURE_PASSWORD = 'BrowserTest!2026';

/** A password that clears the clients' minimum length, for accounts a spec creates. */
export const NEW_PASSWORD = 'Correct-Horse-Battery-9';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface FixtureAccount {
  user_id: string;
  login_id: string;
  password?: string;
  role?: string;
  linked_patient_id?: string;
  nfc_tag_id?: string;
}

export interface Fixtures {
  staff: Array<FixtureAccount & { role: string }>;
  patient: FixtureAccount & { linked_patient_id: string; nfc_tag_id?: string };
  patient_b: FixtureAccount & { linked_patient_id: string };
}

/** Read the explicitly selected cohort, or the repository's default fixture manifest. */
export function readFixtures(): Fixtures {
  return JSON.parse(readFileSync(fixtureManifestPath(), 'utf8')) as Fixtures;
}

/** A seeded staff account by role, with its password resolved. */
export function fixtureStaff(role: string, index = 0): FixtureAccount & { password: string } {
  const matches = readFixtures().staff.filter((member) => member.role === role);
  const found = matches[index];
  if (!found) throw new Error(`No ${role} #${index} in .browser-test/fixtures.json; re-run the seed.`);
  const password =
    found.password ?? (role === 'Admin' ? process.env.MEDICHAIN_ADMIN_PASSWORD : undefined);
  if (!password) {
    throw new Error(`The ${role} fixture has no password; set MEDICHAIN_ADMIN_PASSWORD or re-run the seed.`);
  }
  return { ...found, password };
}

/** A short unique suffix for names and login ids created by a spec. */
export function stamp(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, HMAC-SHA1, six digits, thirty seconds)
// ---------------------------------------------------------------------------

const TOTP_STEP_SECONDS = 30;

function base32Decode(secretBase32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()) {
    const index = alphabet.indexOf(ch);
    if (index >= 0) bits += index.toString(2).padStart(5, '0');
  }
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

/** The code an authenticator app shows for a counter value. */
export function totpForStep(secretBase32: string, step: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  message.writeUInt32BE(step >>> 0, 4);
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString();
  return code.padStart(digits, '0');
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * A paired authenticator.
 *
 * The server refuses a code from a step it has already accepted (a replay
 * guard), so two uses inside one thirty-second step cannot both work. `code()`
 * therefore never returns the same step twice: when the current step has been
 * used it waits for the next boundary. A spec that uses three codes spends up to
 * a minute waiting, which is the honest cost of the guard existing.
 */
export class TotpDevice {
  private lastStep = -1;

  constructor(readonly secret: string) {}

  /** The current step's code, or (after a wait) the next step's if this one was used. */
  async code(): Promise<string> {
    let step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
    if (step <= this.lastStep) {
      await sleep((this.lastStep + 1) * TOTP_STEP_SECONDS * 1000 - Date.now() + 750);
      step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
    }
    this.lastStep = step;
    return totpForStep(this.secret, step);
  }
}

// ---------------------------------------------------------------------------
// Plain API calls
// ---------------------------------------------------------------------------

/**
 * An API context on the project's own origin, for `beforeAll` hooks.
 *
 * The `request` fixture is per test, so a hook that provisions accounts for a
 * whole `describe` block cannot use it. This one goes through the same origin
 * the pages use (`baseURL`, whose dev server proxies `/api`), which keeps one
 * rate-limit bucket and one cookie jar's worth of behaviour. Dispose it in
 * `afterAll`.
 */
export async function apiContext(
  playwright: PlaywrightWorkerArgs['playwright'],
  testInfo: TestInfo
): Promise<APIRequestContext> {
  const baseURL = testInfo.project.use.baseURL;
  if (!baseURL) throw new Error('The Playwright project has no baseURL; the API is reached through it.');
  return playwright.request.newContext({ baseURL });
}

export interface ApiResult {
  status: number;
  // The bodies are the API's JSON, read loosely on purpose: a spec asserts the
  // fields it cares about and a helper that typed them would only go stale.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/** One API call. Mutations carry an Idempotency-Key, as the middleware requires. */
export async function api(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  options: {
    token?: string;
    data?: unknown;
    headers?: Record<string, string>;
    /**
     * Who confirms a Class C demand (ADR-0008) on this call, as the portals do
     * through their dialog: the account's login id and password, or a current
     * authenticator code for an account with one enrolled.
     */
    confirm?: { loginId: string; password?: string; totp?: () => Promise<string> };
  } = {}
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (method !== 'GET' && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = `e2e-${stamp()}-${Math.random().toString(16).slice(2)}`;
  }
  // Sent as this exact text, so a Class C confirmation can bind to its digest.
  const bodyText = options.data === undefined ? undefined : JSON.stringify(options.data);
  if (bodyText !== undefined) headers['Content-Type'] = 'application/json';
  const response = await request.fetch(path, {
    method,
    headers,
    ...(bodyText === undefined ? {} : { data: bodyText }),
    failOnStatusCode: false,
  });
  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  const result: ApiResult = { status: response.status(), body };
  if (
    result.status === 428 &&
    errorCodeOf(result.body) === 'TRANSACTION_AUTHORIZATION_REQUIRED' &&
    options.confirm &&
    options.token &&
    !headers['X-Transaction-Authorization']
  ) {
    const authorization = await confirmTransaction(
      request,
      options.token,
      options.confirm,
      (result.body as { error?: { details?: Record<string, unknown> } }).error?.details ?? {},
      bodyText ?? '',
      headers['Idempotency-Key']
    );
    return api(request, method, path, {
      ...options,
      headers: { ...headers, 'X-Transaction-Authorization': authorization },
    });
  }
  return result;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A verified Class C authorization for exactly this request (see `api`'s `confirm`). */
async function confirmTransaction(
  request: APIRequestContext,
  token: string,
  confirm: { loginId: string; password?: string; totp?: () => Promise<string> },
  details: Record<string, unknown>,
  bodyText: string,
  idempotencyKey: string
): Promise<string> {
  const challenge = await api(request, 'POST', '/api/auth/transaction/challenge', {
    token,
    data: {
      action: details.action,
      method: details.method,
      path: details.path,
      body_digest: await sha256Hex(bodyText),
      resource_id: details.resource_id,
      expected_state: details.expected_state,
      idempotency_key: idempotencyKey,
    },
  });
  const issued = challenge.body?.challenge ?? challenge.body;
  if (challenge.status !== 200 || !issued?.challenge_id) {
    throw new Error(`Class C challenge refused: ${challenge.status} ${JSON.stringify(challenge.body)}`);
  }
  let answer: Record<string, string>;
  if (issued.required_factor === 'totp') {
    if (!confirm.totp) throw new Error('This account confirms with an authenticator code; none was supplied.');
    answer = { code: await confirm.totp() };
  } else {
    if (!confirm.password) throw new Error('This account confirms with its password; none was supplied.');
    answer = { auth_proof: await deriveAuthProof(confirm.password, confirm.loginId) };
  }
  const verified = await api(request, 'POST', '/api/auth/transaction/verify', {
    token,
    data: { challenge_id: issued.challenge_id, ...answer },
  });
  if (verified.status !== 200 || !verified.body?.authorization_id) {
    throw new Error(`Class C confirmation refused: ${verified.status} ${JSON.stringify(verified.body)}`);
  }
  return verified.body.authorization_id;
}

/** The machine-readable code of an error body, in either envelope the API uses. */
export function errorCodeOf(body: ApiResult['body']): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  if (typeof body.code === 'string') return body.code;
  if (body.error && typeof body.error === 'object' && typeof body.error.code === 'string') {
    return body.error.code;
  }
  return undefined;
}

/** Sign in the way the portals do: the proof of the password, never the password. */
export async function apiLogin(
  request: APIRequestContext,
  loginId: string,
  password: string,
  totpCode?: string
): Promise<ApiResult> {
  const authProof = await deriveAuthProof(password, loginId);
  return api(request, 'POST', '/api/auth/login', {
    data: {
      identifier: loginId,
      auth_proof: authProof,
      ...(totpCode ? { totp_code: totpCode } : {}),
    },
  });
}

/** The access token of a successful sign-in, or a failure that says what came back. */
export function tokenOf(result: ApiResult, what: string): string {
  const token = result.body?.access_token;
  if (result.status !== 200 || typeof token !== 'string' || !token) {
    throw new Error(`${what}: no session (HTTP ${result.status}) ${JSON.stringify(result.body)}`);
  }
  return token;
}

/** Sign a fixture in over the API and return its bearer token. */
export async function fixtureToken(
  request: APIRequestContext,
  account: { login_id: string; password: string }
): Promise<string> {
  return tokenOf(await apiLogin(request, account.login_id, account.password), `sign in ${account.login_id}`);
}

/** Redeem a one-time code, choosing the password (and, for a patient, the username). */
export async function apiRedeem(
  request: APIRequestContext,
  input: { identifier: string; code: string; password: string; username?: string }
): Promise<ApiResult> {
  // Setting a password sends it once, for the server's strength check.
  return api(request, 'POST', '/api/auth/credentials/redeem', {
    data: {
      identifier: input.identifier,
      code: input.code,
      password: input.password,
      ...(input.username ? { username: input.username } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Two-factor over the API
// ---------------------------------------------------------------------------

/** Pair an authenticator for the signed-in account. */
export async function enrolTotp(request: APIRequestContext, token: string): Promise<TotpDevice> {
  const enrolled = await api(request, 'POST', '/api/auth/mfa/enroll', { token, data: {} });
  const secret = enrolled.body?.secret;
  if (enrolled.status !== 200 || typeof secret !== 'string') {
    throw new Error(`mfa/enroll -> HTTP ${enrolled.status} ${JSON.stringify(enrolled.body)}`);
  }
  const device = new TotpDevice(secret);
  const verified = await api(request, 'POST', '/api/auth/mfa/verify', {
    token,
    data: { code: await device.code() },
  });
  if (verified.status !== 200) {
    throw new Error(`mfa/verify -> HTTP ${verified.status} ${JSON.stringify(verified.body)}`);
  }
  return device;
}

/** Exchange a fresh code for a token that carries the elevated (Class B) claim. */
export async function stepUp(
  request: APIRequestContext,
  token: string,
  device: TotpDevice
): Promise<string> {
  const result = await api(request, 'POST', '/api/auth/mfa/challenge', {
    token,
    data: { code: await device.code() },
  });
  return tokenOf(result, 'mfa/challenge');
}

/** Turn the authenticator off (needs a current code). */
export async function disableTotp(
  request: APIRequestContext,
  token: string,
  device: TotpDevice
): Promise<ApiResult> {
  return api(request, 'POST', '/api/auth/mfa/disable', {
    token,
    data: { code: await device.code() },
  });
}

// ---------------------------------------------------------------------------
// The administrator, meeting step-up only when it is demanded
// ---------------------------------------------------------------------------

/**
 * The fixture administrator's API session, for privileged calls.
 *
 * `call()` runs a request; if the API answers `MFA_ENROLLMENT_REQUIRED` it pairs
 * an authenticator and retries, and if it answers `MFA_REQUIRED` it steps up and
 * retries. In a demo-mode API neither refusal happens and nothing is enrolled.
 * `enrolled()` says whether this run had to enrol, so a spec can tell which
 * path it exercised.
 */
export class AdminApi {
  private device: TotpDevice | undefined;

  private constructor(
    private readonly request: APIRequestContext,
    private token: string,
    readonly loginId: string,
    readonly password: string
  ) {}

  /** Sign the fixture administrator in. Fails clearly if it already needs a code. */
  static async signIn(request: APIRequestContext): Promise<AdminApi> {
    const admin = fixtureStaff('Admin');
    const result = await apiLogin(request, admin.login_id, admin.password);
    if (result.body?.mfa_required && !result.body?.access_token) {
      throw new Error(
        `The fixture administrator (${admin.login_id}) already has two-factor enrolled, ` +
          'probably left by an earlier run that did not release it. Turn it off in Settings, ' +
          'then re-run.'
      );
    }
    return new AdminApi(request, tokenOf(result, 'sign in the administrator'), admin.login_id, admin.password);
  }

  get bearer(): string {
    return this.token;
  }

  enrolled(): boolean {
    return this.device !== undefined;
  }

  /** The current code for the UI, when this run has enrolled the administrator. */
  async uiCode(): Promise<string | undefined> {
    return this.device ? this.device.code() : undefined;
  }

  /** Pair an authenticator now, without waiting to be asked. Idempotent within a run. */
  async ensureEnrolled(): Promise<TotpDevice> {
    if (!this.device) this.device = await enrolTotp(this.request, this.token);
    return this.device;
  }

  /** Run a privileged call, enrolling and stepping up if the API demands either. */
  async call(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown
  ): Promise<ApiResult> {
    // A Class C demand (ADR-0008) -- activating, suspending or changing a
    // person's role -- is confirmed as the administrator: by authenticator code
    // once one is enrolled, otherwise by password. The server chooses which.
    const send = () => api(this.request, method, path, { token: this.token, data, confirm: this.confirmer() });
    let result = await send();
    if (result.status === 403 && errorCodeOf(result.body) === 'MFA_ENROLLMENT_REQUIRED') {
      await this.ensureEnrolled();
      result = await send();
    }
    if (result.status === 403 && errorCodeOf(result.body) === 'MFA_REQUIRED' && this.device) {
      this.token = await stepUp(this.request, this.token, this.device);
      result = await send();
    }
    return result;
  }

  /** How this administrator confirms a Class C demand. */
  private confirmer(): { loginId: string; password: string; totp?: () => Promise<string> } {
    const device = this.device;
    return { loginId: this.loginId, password: this.password, totp: device ? () => device.code() : undefined };
  }

  /** Turn the authenticator off again. Always call this if `enrolled()`. */
  async release(): Promise<void> {
    if (!this.device) return;
    const result = await disableTotp(this.request, this.token, this.device);
    if (result.status !== 200) {
      // A stale elevated token can be refused; sign in again with a code.
      const relogin = await apiLogin(this.request, this.loginId, this.password, await this.device.code());
      const token = tokenOf(relogin, 'sign the administrator in to release two-factor');
      const second = await disableTotp(this.request, token, this.device);
      if (second.status !== 200) {
        throw new Error(
          `Could not release the administrator's two-factor: HTTP ${second.status} ` +
            `${JSON.stringify(second.body)}. Turn it off in Settings before other suites run.`
        );
      }
    }
    this.device = undefined;
  }
}

// ---------------------------------------------------------------------------
// Throwaway people
// ---------------------------------------------------------------------------

export interface Throwaway {
  userId: string;
  loginId: string;
  name: string;
  password: string;
  /** A session from redeeming the credential code (still valid until revoked). */
  token: string;
}

/**
 * Create a staff account the way a deployment does and give it a password:
 * administrator registers, administrator activates, the person redeems their
 * one-time code choosing `password`.
 */
export async function provisionStaff(
  request: APIRequestContext,
  admin: AdminApi,
  role: 'Doctor' | 'Nurse' | 'Pharmacist' | 'LabTechnician',
  password = NEW_PASSWORD
): Promise<Throwaway> {
  const tag = stamp();
  const loginId = `e2e.${role.toLowerCase()}.${tag}`;
  const name = `E2E ${role} ${tag}`;
  const created = await admin.call('POST', '/api/auth/register', { name, role, login_id: loginId });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`register ${loginId} -> HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
  const userId = String(created.body.user_id ?? '');
  const code = String(created.body.credential_code ?? '');
  if (!userId || !code) throw new Error(`register ${loginId} returned no user_id or credential_code`);

  const activated = await admin.call('PUT', `/api/users/${userId}`, { status: 'active' });
  if (activated.status < 200 || activated.status >= 300) {
    throw new Error(`activate ${loginId} -> HTTP ${activated.status} ${JSON.stringify(activated.body)}`);
  }
  const redeemed = await apiRedeem(request, { identifier: loginId, code, password });
  return { userId, loginId, name, password, token: tokenOf(redeemed, `redeem the code for ${loginId}`) };
}

// ---------------------------------------------------------------------------
// Patients
// ---------------------------------------------------------------------------

export interface RegisteredPatient {
  patientId: string;
  nfcTagId: string;
  activationCode: string;
  activationExpiresAt: string;
}

/** The registration body every spec uses; national ids are unique per run. */
export function patientRegistration(label: string): Record<string, unknown> {
  const tag = stamp();
  return {
    full_name: `${label} ${tag}`,
    date_of_birth: '1991-03-14',
    national_id: `E2E-${tag}`.toUpperCase(),
    blood_type: 'O+',
    allergies: [],
    current_medications: [],
    chronic_conditions: [],
    emergency_contact_name: 'Kin E2E',
    emergency_contact_phone: '+27000000300',
    emergency_contact_relationship: 'sibling',
    organ_donor: false,
    dnr_status: false,
  };
}

/** Register a patient as a clinician and read back the one-time activation code. */
export async function registerPatientViaApi(
  request: APIRequestContext,
  clinicianToken: string,
  label = 'E2E Patient'
): Promise<RegisteredPatient> {
  const created = await api(request, 'POST', '/api/register', {
    token: clinicianToken,
    data: patientRegistration(label),
  });
  const activation = created.body?.activation as { code?: string; expires_at?: string } | undefined;
  const code = String(activation?.code ?? created.body?.activation_code ?? '');
  if (created.status < 200 || created.status >= 300 || !created.body?.patient_id || !code) {
    throw new Error(`register patient -> HTTP ${created.status} ${JSON.stringify(created.body)}`);
  }
  return {
    patientId: String(created.body.patient_id),
    nfcTagId: String(created.body.nfc_tag_id ?? ''),
    activationCode: code,
    activationExpiresAt: String(activation?.expires_at ?? created.body.activation_expires_at ?? ''),
  };
}
