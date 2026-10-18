/**
 * Shared machinery for the role-journey harness.
 *
 * # Why this is separate from `cross-role-qualification.ts`
 *
 * That harness asks "can the wrong person do this?" and answers it 114 times.
 * It is a *boundary* suite: every check is a denial, a maker-checker refusal,
 * or a token that must not work twice. It proves the walls.
 *
 * It does not prove the building. Measured against the running stack, the
 * number of screens whose Save button had ever been driven against a live
 * server was 0 of 14 for an administrator, 1 of 9 for a lab technician, 3 of 37
 * for a doctor. Every one of those pages has a unit test; a unit test renders
 * the page against a mocked `fetch` and therefore cannot tell you that the
 * handler behind it reads `actual_time` while the form sends
 * `administered_time`.
 *
 * So this harness asks the other question: **can the right person finish their
 * shift?** One journey per role, each a single coherent story — sign in, do the
 * work in the order the work is actually done, and then require that the next
 * person in the workflow can see it.
 *
 * # The assertion that matters
 *
 * `writeAndReadBack` is the whole point. This repository's dominant defect is a
 * successful write that no reader can see: a `201`, a green toast, and a record
 * that either never persisted or persisted with the clinical content stripped
 * out. Asserting the status code reproduces that bug rather than finding it.
 * Every write here is therefore followed by a read through the endpoint a
 * clinician would actually use, and the fields the form collected are compared
 * against the fields that came back.
 *
 * # Safety
 *
 * Synthetic fixtures only, from `.browser-test/fixtures.json`. Refuses any
 * non-local endpoint.
 */

import { deriveAuthProof } from './auth';
import { confirmTransaction } from './transaction-authorization';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = process.env.MEDICHAIN_API_URL ?? 'http://127.0.0.1/api';
export const PASSWORD = 'BrowserTest!2026';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export type Json = Record<string, any>;

/**
 * One fixture account, exactly as `seed-browser-test-fixtures.ts` writes it.
 *
 * `password` is absent for an administrator supplied through the environment;
 * `passwordFor` then answers `MEDICHAIN_ADMIN_PASSWORD`.
 */
export interface FixtureAccount {
  role: string;
  user_id: string;
  login_id: string;
  password?: string;
}

/** A patient fixture: an account bound to a record and a health-ID card. */
export interface PatientFixture extends FixtureAccount {
  linked_patient_id: string;
  nfc_tag_id: string;
}

export interface Manifest {
  administrator_user_id: string;
  staff: FixtureAccount[];
  patient: PatientFixture;
  patient_b: PatientFixture;
}

const passwords = new Map<string, string>();

/** The password a fixture signs in with: the manifest's, else the fixture default. */
export function passwordFor(loginId: string): string {
  return passwords.get(loginId) ?? process.env.MEDICHAIN_ADMIN_PASSWORD ?? PASSWORD;
}

export function loadManifest(): Manifest {
  const host = new URL(API).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(
      `Refusing to run against ${API}. This harness writes synthetic clinical records ` +
        `and is only ever pointed at a local endpoint.`
    );
  }
  // The same selector the browser suites use, so a run against an isolated QA
  // stack reads that stack's accounts rather than the working stack's.
  const configured = process.env.MEDICHAIN_FIXTURE_MANIFEST;
  if (configured && !isAbsolute(configured)) {
    throw new Error('MEDICHAIN_FIXTURE_MANIFEST must be an absolute path.');
  }
  const manifest = JSON.parse(
    readFileSync(configured ?? join(REPO_ROOT, '.browser-test', 'fixtures.json'), 'utf8')
  ) as Manifest;
  for (const account of [...manifest.staff, manifest.patient, manifest.patient_b]) {
    if (account.password) passwords.set(account.login_id, account.password);
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ADR-0008 Class C confirmation
// ---------------------------------------------------------------------------

/** Who signed in with each token, so a gated step can be confirmed as that person. */
const credentialsByToken = new Map<string, { loginId: string; password: string }>();
/** A current authenticator code for accounts that have one enrolled. */
const totpByLogin = new Map<string, () => Promise<string>>();

/** Remember the credentials behind a token obtained outside `loginWithPassword`. */
export function rememberCredentials(token: string, loginId: string, password: string): void {
  credentialsByToken.set(token, { loginId, password });
}

/** Register how to produce a current TOTP code for an account with an authenticator. */
export function rememberTotp(loginId: string, code: () => Promise<string>): void {
  totpByLogin.set(loginId, code);
}

export async function http(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  // `api/src/middleware/idempotency.rs` refuses any keyed-subject mutation that
  // arrives without one. A fresh key per call is right: each step of a journey
  // is a distinct intent, and reusing one across two requests is answered
  // IDEMPOTENCY_KEY_REUSED because the key is bound to a request digest.
  if (method !== 'GET' && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = globalThis.crypto.randomUUID();
  }
  // Sent as this exact text so a Class C confirmation can bind to its digest.
  const bodyText = opts.body === undefined ? undefined : JSON.stringify(opts.body);

  // A transport failure is not a result. `fetch` rejects when the connection
  // never completes, and recording that as a clinical outcome would put a red
  // FAIL against a workflow that was never exercised. HTTP statuses, 4xx and
  // 5xx included, are answers and are returned unretried.
  let res: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      res = await fetch(`${API}${path}`, {
        method,
        headers,
        body: bodyText,
      });
      break;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  if (!res) {
    throw new Error(`transport failure after 3 attempts for ${method} ${path}: ${String(lastError)}`);
  }

  // Read as text first, then parse.
  //
  // `res.json()` throwing is not the same as an empty body, and treating them
  // alike cost an hour: actix's `Json<T>` extractor rejects a body it cannot
  // deserialize with a 400 whose payload is *plain text* naming the offending
  // field ("Json deserialize error: missing field `assessment_id`"). Swallowing
  // that left `{}` on the console and eleven journey steps reading "got 400"
  // with nothing to act on. The text is the most useful diagnostic the API
  // produces, so it is kept under `_raw` when it is not JSON.
  const text = await res.text();
  let json: Json = {};
  if (text) {
    try {
      json = JSON.parse(text) as Json;
    } catch {
      json = { _raw: text.slice(0, 600) };
    }
  }
  // A Class C demand on a gated step: confirm once as the signed-in person and
  // resend under the same key -- what the portals do through their dialog.
  if (
    res.status === 428 &&
    json?.error?.code === 'TRANSACTION_AUTHORIZATION_REQUIRED' &&
    opts.token &&
    !headers['X-Transaction-Authorization']
  ) {
    const credentials = credentialsByToken.get(opts.token);
    const authorization = credentials
      ? await confirmTransaction(
          (path, token, body) => http('POST', path, { token, body }),
          opts.token,
          { ...credentials, totp: totpByLogin.get(credentials.loginId) },
          json,
          bodyText ?? '',
          headers['Idempotency-Key']
        )
      : undefined;
    if (authorization) {
      return http(method, path, {
        ...opts,
        headers: {
          ...(opts.headers ?? {}),
          'Idempotency-Key': headers['Idempotency-Key'],
          'X-Transaction-Authorization': authorization,
        },
      });
    }
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface Session {
  label: string;
  role: string;
  /** `users.id`, the JWT `sub`, and the value every actor column holds. */
  userId: string;
  token: string;
  /**
   * The login id (staff employee id, patient username) this session was
   * established with.
   *
   * Carried so a journey can sign the SAME account in again — a role change is
   * only visible on a new JWT, and the administrator journey previously
   * hardcoded `bt.lab2` while the manifest had handed it a suffixed fixture
   * (`bt.lab2.k`). It promoted one account and then checked a different one,
   * and reported the product as broken.
   */
  loginId: string;
}

/**
 * Thrown when a per-IP rate limit refuses a sign-in.
 *
 * Distinguished from every other sign-in failure on purpose: the limiter is a
 * control doing its job, and reporting that as a journey failure teaches a
 * reader to ignore a red result caused by security working. A locked account
 * (`429 ACCOUNT_LOCKED`) is deliberately NOT this: a fixture that is locked out
 * is a real failure of the run that locked it.
 */
export class SignInRateLimited extends Error {
  constructor(loginId: string) {
    super(`sign-in rate limited for ${loginId}`);
    this.name = 'SignInRateLimited';
  }
}

/** Where a sign-in body's fields live; both `login` and `redeem` answer the same shape. */
function sessionFromLogin(
  login: { status: number; json: Json },
  label: string,
  loginId: string,
  role?: string
): Session {
  const user = (login.json.user ?? {}) as Json;
  return {
    label,
    role: String(role ?? user.role),
    userId: String(user.user_id),
    token: String(login.json.access_token),
    loginId,
  };
}

/**
 * The whole sign-in, exactly as the portals perform it:
 * `POST /api/auth/login { identifier, auth_proof }`.
 *
 * Staff sign in with their employee id and patients with their chosen username;
 * both are the `identifier`, and both derive the proof under it.
 */
export async function loginWithPassword(
  loginId: string,
  password: string,
  label: string,
  role?: string
): Promise<Session> {
  const authProof = await deriveAuthProof(password, loginId);
  const login = await http('POST', '/auth/login', {
    body: { identifier: loginId, auth_proof: authProof },
  });
  if (login.status === 429 && login.json?.error?.code !== 'ACCOUNT_LOCKED' && login.json?.code !== 'ACCOUNT_LOCKED') {
    throw new SignInRateLimited(loginId);
  }
  if (login.status !== 200 || !login.json.access_token) {
    throw new Error(`login failed for ${loginId}: ${login.status} ${JSON.stringify(login.json)}`);
  }
  credentialsByToken.set(login.json.access_token, { loginId, password });
  return sessionFromLogin(login, label, loginId, role);
}

/** Sign in as a staff fixture (see `loginWithPassword`). */
export async function signIn(loginId: string, label: string): Promise<Session> {
  return loginWithPassword(loginId, passwordFor(loginId), label);
}

/**
 * Sign in as a patient fixture, with the username and password the seeder chose
 * when it redeemed the activation code.
 */
export async function signInPatient(fixture: PatientFixture, label: string): Promise<Session> {
  return loginWithPassword(fixture.login_id, passwordFor(fixture.login_id), label, 'Patient');
}

// ---------------------------------------------------------------------------
// Result accounting
// ---------------------------------------------------------------------------

export interface Step {
  journey: string;
  name: string;
  passed: boolean;
  skipped?: boolean;
  detail: string;
}

export class Journal {
  readonly steps: Step[] = [];
  private current = 'unknown';

  journey(name: string): void {
    this.current = name;
    console.log(`\n\x1b[1m${name}\x1b[0m`);
  }

  record(name: string, passed: boolean, detail = ''): boolean {
    this.steps.push({ journey: this.current, name, passed, detail });
    console.log(`  ${passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${passed ? '' : `\n         ${detail}`}`);
    return passed;
  }

  /**
   * A step that could not run because something upstream of it did not.
   *
   * Deliberately not a pass. A journey whose third step never executed must not
   * read as a journey that completed.
   */
  skip(name: string, reason: string): void {
    this.steps.push({ journey: this.current, name, passed: false, skipped: true, detail: reason });
    console.log(`  \x1b[33mSKIP\x1b[0m  ${name}  -- ${reason}`);
  }

  status(name: string, got: number, want: number | number[], body?: Json): boolean {
    const wanted = Array.isArray(want) ? want : [want];
    return this.record(
      name,
      wanted.includes(got),
      `expected ${wanted.join(' or ')}, got ${got} ${JSON.stringify(body ?? {}).slice(0, 400)}`
    );
  }

  summarise(): number {
    const failed = this.steps.filter((s) => !s.passed && !s.skipped);
    const skipped = this.steps.filter((s) => s.skipped);
    const passed = this.steps.filter((s) => s.passed);

    console.log(`\n${'='.repeat(72)}`);
    const byJourney = new Map<string, { p: number; f: number; s: number }>();
    for (const s of this.steps) {
      const e = byJourney.get(s.journey) ?? { p: 0, f: 0, s: 0 };
      if (s.skipped) e.s += 1;
      else if (s.passed) e.p += 1;
      else e.f += 1;
      byJourney.set(s.journey, e);
    }
    for (const [j, e] of byJourney) {
      const mark = e.f === 0 ? '\x1b[32mOK  \x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      console.log(`  ${mark} ${j.padEnd(52)} ${e.p} passed  ${e.f} failed  ${e.s} skipped`);
    }

    if (failed.length) {
      console.log(`\n\x1b[31mBroken steps\x1b[0m`);
      for (const f of failed) console.log(`  · [${f.journey}] ${f.name}\n      ${f.detail}`);
    }
    console.log(
      `\n${passed.length}/${passed.length + failed.length} steps passed` +
        (skipped.length ? `, ${skipped.length} skipped` : '')
    );
    return failed.length;
  }
}

// ---------------------------------------------------------------------------
// The assertion this harness exists for
// ---------------------------------------------------------------------------

/**
 * Write, then read the record back through the endpoint a clinician would use,
 * and require that what the form collected is what a reader sees.
 *
 * `expect` is a set of field paths and the values they must carry. A missing
 * field and a field carrying a different value are both failures, and the
 * message names the path rather than dumping the record, because "the response
 * did not match" is a bug report nobody can act on.
 *
 * Dotted paths index nested objects; `[]` scans an array for a member matching
 * the remaining path, which is what a list endpoint returns.
 */
export function fieldAt(record: unknown, path: string): unknown {
  let cur: any = record;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (seg === '[]') {
      if (!Array.isArray(cur)) return undefined;
      return cur;
    }
    cur = cur[seg];
  }
  return cur;
}

/**
 * The rows out of a list response, whatever envelope it arrived in.
 *
 * `response.values ?? response.items ?? response` looks obviously right and is
 * a trap: when the endpoint answers a bare ARRAY, `array.values` resolves to
 * `Array.prototype.values` — a function, not `undefined` — so `??` never falls
 * through and the "rows" become a function. `JSON.stringify(function)` is
 * `undefined`, and the next `.includes()` throws
 * `Cannot read properties of undefined`, ten steps away from the cause.
 *
 * `keys`, `entries`, `length`, `find` and `filter` are the same trap. So: an
 * array is the rows; otherwise the first named key that actually holds one.
 */
export function rowsOf(body: Json | unknown[], ...keys: string[]): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const record = body as Json;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  // A single embedded array, when the caller did not name the key.
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value as unknown[];
  }
  return [];
}

/** Find the member of `items` whose `key` equals `value`. */
export function findBy(items: unknown, key: string, value: unknown): Json | undefined {
  if (!Array.isArray(items)) return undefined;
  return items.find((i) => fieldAt(i, key) === value) as Json | undefined;
}

/**
 * Compare the fields a form collected against the fields a reader gets back.
 *
 * Returns the list of discrepancies, empty when the record survived intact.
 * Numbers are compared numerically so `7` and `7.0` agree; everything else is
 * compared as written, because a form that sent `"given"` and a reader that
 * sees `"held"` is precisely the defect being hunted.
 */
export function discrepancies(record: Json | undefined, expect: Record<string, unknown>): string[] {
  if (record === undefined) return ['the record could not be found at all'];
  const out: string[] = [];
  for (const [path, want] of Object.entries(expect)) {
    const got = fieldAt(record, path);
    // Numbers are compared with a tolerance, everything else exactly.
    //
    // The tolerance is not laziness about precision: several clinical columns
    // are `f32`, so a temperature of 37.8 comes back as 37.79999923706055 and
    // an exact comparison reports a defect where the only thing that happened
    // is IEEE-754. 1e-4 is far tighter than any clinical value's meaningful
    // resolution and far looser than f32 round-tripping error. Strings stay
    // exact, because a form that sent "given" and a reader that sees "held" is
    // precisely the defect being hunted.
    const same =
      typeof want === 'number' && got !== null && got !== undefined && !Number.isNaN(Number(got))
        ? Math.abs(Number(got) - want) < 1e-4
        : JSON.stringify(got) === JSON.stringify(want);
    if (!same) {
      out.push(`${path}: sent ${JSON.stringify(want)}, read back ${JSON.stringify(got)}`);
    }
  }
  return out;
}
