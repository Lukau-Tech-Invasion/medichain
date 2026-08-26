/**
 * Admin persona mutation: suspend an account, and prove the consequence.
 *
 * # Why this is a separate probe
 *
 * Suspending a user is the highest-privilege mutation in the product and the
 * only one whose *point* is to remove somebody else's authority. Asserting
 * that a row changed would miss the thing that matters: whether the suspended
 * account can still authenticate.
 *
 * It is not part of `cross-role-qualification.ts` because it deliberately
 * disables a fixture that harness depends on. Run separately, and it restores
 * what it changed.
 *
 * # The full cycle, in one run
 *
 *   sign in as admin -> target authenticates (baseline)
 *   -> suspend -> target CANNOT authenticate
 *   -> reactivate -> target authenticates again
 *
 * Doing all four in one run is what makes it deterministic. An earlier version
 * checked "suspended cannot sign in" against an account a previous run had
 * already restored, and got a green 200 that meant nothing.
 *
 * Usage:
 *   cd client
 *   MEDICHAIN_API_URL=http://127.0.0.1:8090/api \
 *   ./node_modules/.bin/vite-node ../scripts/admin-suspension-probe.ts
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

const results: Array<{ name: string; passed: boolean; skipped?: boolean; detail: string }> = [];
function check(name: string, passed: boolean, detail = ''): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${passed ? '' : `  -- ${detail}`}`);
}

/**
 * A control refused us, so the check could not run.
 *
 * This probe makes four authentication attempts, and the challenge limiter is
 * five per wallet per minute — so running it twice inside a minute legitimately
 * runs out. That is the limiter working. Reporting it as a failed suspension
 * check would be a lie about the product.
 */
function skip(name: string, reason: string): void {
  results.push({ name, passed: false, skipped: true, detail: reason });
  console.log(`  SKIP  ${name}  -- ${reason}`);
}

/** 429 means "ask again later", never "the account is suspended". */
const RATE_LIMITED = 429;

async function http(method: string, path: string, o: { token?: string; body?: unknown } = {}) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  if (method !== 'GET') h['Idempotency-Key'] = globalThis.crypto.randomUUID();
  const r = await fetch(`${API}${path}`, {
    method,
    headers: h,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  let j: Json = {};
  try {
    j = (await r.json()) as Json;
  } catch {
    /* empty body */
  }
  return { status: r.status, json: j };
}

/** Full staff sign-in: credential -> keystore -> signer -> challenge -> JWT. */
async function staffToken(loginId: string): Promise<string> {
  const { authProof, keystoreKey } = await deriveCredential(PASSWORD, loginId);
  const l = await http('POST', '/auth/staff/login', {
    body: { identifier: loginId, auth_proof: authProof },
  });
  if (l.status !== 200) throw new Error(`staff login ${loginId}: ${l.status}`);
  const opened = await openKeystore(l.json.encrypted_keystore, keystoreKey);
  const signer = await signerFromSecret(opened.miniSecret, opened.address);
  const c = await http('POST', '/auth/challenge', {
    body: { wallet_address: l.json.wallet_address },
  });
  const sig = await signer.sign(c.json.challenge.message);
  const j = await http('POST', '/auth/jwt', {
    body: {
      wallet_address: l.json.wallet_address,
      challenge_id: c.json.challenge.challenge_id,
      nonce: c.json.challenge.nonce,
      signature: sig,
    },
  });
  return String(j.json.access_token);
}

/**
 * Can this wallet obtain a session right now?
 *
 * Returns the HTTP status of the JWT exchange, or the challenge status when
 * the challenge itself is refused — a suspended account may be stopped at
 * either step, and both are legitimate answers.
 */
async function canAuthenticate(wallet: string, mnemonic: string): Promise<number> {
  const signer = await signerFromSecret(await secretFromMnemonic(mnemonic), wallet);
  const c = await http('POST', '/auth/challenge', { body: { wallet_address: wallet } });
  if (c.status !== 200) return c.status;
  const sig = await signer.sign(c.json.challenge.message);
  const j = await http('POST', '/auth/jwt', {
    body: {
      wallet_address: wallet,
      challenge_id: c.json.challenge.challenge_id,
      nonce: c.json.challenge.nonce,
      signature: sig,
    },
  });
  return j.status;
}

async function main(): Promise<void> {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(API)) {
    console.error(`\n  Refusing to run against ${API}. Local only.\n`);
    process.exit(1);
  }

  const m = JSON.parse(
    readFileSync(join(REPO_ROOT, '.browser-test', 'fixtures.json'), 'utf8')
  ) as Json;
  const target = m.patient_b;

  console.log(`\nAdmin suspension probe against ${API}`);
  console.log(`Target: ${target.wallet} (${target.linked_patient_id})\n`);

  const adminFixture = m.staff.find((s: Json) => String(s.login_id).startsWith('bt.admin.'));
  if (!adminFixture) {
    check('an admin fixture exists', false, 'no bt.admin.* in the manifest');
    process.exit(1);
  }
  const admin = await staffToken(adminFixture.login_id);
  check('admin signs in through the real credential flow', Boolean(admin), '');

  // --- baseline -----------------------------------------------------------
  const before = await canAuthenticate(target.wallet, target.mnemonic);
  if (before === RATE_LIMITED) {
    skip(
      'admin suspension cycle',
      'the challenge limiter is already satisfied for this wallet — re-run after a minute'
    );
    report();
    return;
  }
  check('the target can authenticate before suspension', before === 200, `status ${before}`);

  // --- suspend ------------------------------------------------------------
  const susp = await http('PUT', `/users/${target.wallet}`, {
    token: admin,
    body: { status: 'suspended' },
  });
  check('admin suspends the account', susp.status === 200, `status ${susp.status}`);

  // The point of the whole mutation.
  const during = await canAuthenticate(target.wallet, target.mnemonic);
  check(
    'a suspended account cannot authenticate',
    during !== 200 && during !== RATE_LIMITED,
    during === RATE_LIMITED
      ? 'rate limited — cannot distinguish suspension from throttling'
      : `status ${during} — a suspended user obtained a session`
  );

  // A non-admin must not be able to undo it.
  const doctorFixture = m.staff.find((s: Json) => String(s.login_id).startsWith('bt.doctor.'));
  if (doctorFixture) {
    const doctor = await staffToken(doctorFixture.login_id);
    const escalate = await http('PUT', `/users/${target.wallet}`, {
      token: doctor,
      body: { status: 'active' },
    });
    check(
      'a doctor cannot reactivate a suspended account',
      [401, 403].includes(escalate.status),
      `status ${escalate.status}`
    );

    // And the suspension must still hold after that attempt.
    const stillOut = await canAuthenticate(target.wallet, target.mnemonic);
    check(
      'the account is still suspended after the failed escalation',
      stillOut !== 200 && stillOut !== RATE_LIMITED,
      `status ${stillOut}`
    );
  }

  // --- restore ------------------------------------------------------------
  const back = await http('PUT', `/users/${target.wallet}`, {
    token: admin,
    body: { status: 'active' },
  });
  check('admin reactivates the account', back.status === 200, `status ${back.status}`);

  const after = await canAuthenticate(target.wallet, target.mnemonic);
  if (after === RATE_LIMITED) {
    skip('the reactivated account can authenticate again', 'rate limited — reactivation itself returned 200');
  } else {
    check('the reactivated account can authenticate again', after === 200, `status ${after}`);
  }

  // --- audit --------------------------------------------------------------
  const logs = await http('GET', `/access-logs/${target.linked_patient_id}?limit=100`, {
    token: admin,
  });
  check(
    'the patient access log is readable by the admin',
    logs.status === 200,
    `status ${logs.status}`
  );

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${'='.repeat(64)}`);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  ${f.name}\n      ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
