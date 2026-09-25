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

import {
  deriveCredential,
  openKeystore,
  signerFromSecret,
  secretFromMnemonic,
} from '../../client/shared/src/auth/credentials';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = process.env.MEDICHAIN_API_URL ?? 'http://127.0.0.1/api';
export const PASSWORD = 'BrowserTest!2026';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export type Json = Record<string, any>;

export interface Manifest {
  administrator_wallet: string;
  staff: Array<{ role: string; login_id: string; wallet: string }>;
  patient: { wallet: string; mnemonic: string; linked_patient_id: string; nfc_tag_id: string };
  patient_b: { wallet: string; mnemonic: string; linked_patient_id: string; nfc_tag_id: string };
}

export function loadManifest(): Manifest {
  const host = new URL(API).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(
      `Refusing to run against ${API}. This harness writes synthetic clinical records ` +
        `and is only ever pointed at a local endpoint.`
    );
  }
  return JSON.parse(
    readFileSync(join(REPO_ROOT, '.browser-test', 'fixtures.json'), 'utf8')
  ) as Manifest;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

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
  if (method !== 'GET') headers['Idempotency-Key'] = globalThis.crypto.randomUUID();

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
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
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
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface Session {
  label: string;
  role: string;
  wallet: string;
  userId: string;
  token: string;
  /**
   * The employee identifier this session was established with.
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
 * Thrown when the per-wallet challenge limiter refuses a sign-in.
 *
 * Distinguished from every other sign-in failure on purpose: the limiter is a
 * control doing its job (five challenges per wallet per minute), and reporting
 * that as a journey failure teaches a reader to ignore a red result caused by
 * security working.
 */
export class ChallengeRateLimited extends Error {
  constructor(loginId: string) {
    super(`challenge rate limited for ${loginId}`);
    this.name = 'ChallengeRateLimited';
  }
}

/** The whole sign-in, exactly as the portal performs it. */
export async function signIn(loginId: string, label: string): Promise<Session> {
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
  if (challenge.status === 429) throw new ChallengeRateLimited(loginId);
  if (challenge.status !== 200) throw new Error(`challenge failed for ${loginId}: ${challenge.status}`);

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
    userId: String(login.json.wallet_address),
    token: String(jwt.json.access_token),
    loginId,
  };
}

/** Sign in as a patient, who holds a wallet rather than an employee credential. */
export async function signInPatient(
  mnemonic: string,
  wallet: string,
  label: string
): Promise<Session> {
  const secret = await secretFromMnemonic(mnemonic);
  const signer = await signerFromSecret(secret, wallet);

  const challenge = await http('POST', '/auth/challenge', { body: { wallet_address: wallet } });
  if (challenge.status === 429) throw new ChallengeRateLimited(wallet);
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

  // A patient signs in with a wallet, not an employee identifier.
  return {
    label,
    role: 'Patient',
    wallet,
    userId: wallet,
    token: String(jwt.json.access_token),
    loginId: wallet,
  };
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
