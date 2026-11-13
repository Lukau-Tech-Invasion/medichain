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
import { http, loadManifest, signIn, signInPatient, SignInRateLimited, type PatientFixture } from './lib/journey';

const API = process.env.MEDICHAIN_API_URL ?? 'http://127.0.0.1:8090/api';

const results: Array<{ name: string; passed: boolean; skipped?: boolean; detail: string }> = [];
function check(name: string, passed: boolean, detail = ''): void {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${passed ? '' : `  -- ${detail}`}`);
}

/**
 * A control refused us, so the check could not run.
 *
 * Running this probe repeatedly inside a minute can legitimately hit the
 * request rate limit. That is the limiter working. Reporting it as a failed
 * suspension check would be a lie about the product.
 */
function skip(name: string, reason: string): void {
  results.push({ name, passed: false, skipped: true, detail: reason });
  console.log(`  SKIP  ${name}  -- ${reason}`);
}

/** 429 means "ask again later", never "the account is suspended". */
const RATE_LIMITED = 429;

/**
 * Can this patient obtain a session right now?
 *
 * Returns 200 when a session was issued, otherwise the HTTP status the sign-in
 * was refused with. A suspended account may be refused with several statuses
 * and all are legitimate answers; 200 is the only wrong one.
 */
async function canAuthenticate(fixture: PatientFixture): Promise<number> {
  try {
    await signInPatient(fixture, 'suspension-probe');
    return 200;
  } catch (e) {
    if (e instanceof SignInRateLimited) return RATE_LIMITED;
    const status = /: (\d{3}) /.exec(String(e));
    return status ? Number(status[1]) : 0;
  }
}

async function main(): Promise<void> {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(API)) {
    console.error(`\n  Refusing to run against ${API}. Local only.\n`);
    process.exit(1);
  }

  const m = loadManifest();
  const target = m.patient_b;

  console.log(`\nAdmin suspension probe against ${API}`);
  console.log(`Target: ${target.login_id} / ${target.user_id} (${target.linked_patient_id})\n`);

  const adminFixture = m.staff.find((s) => s.role === 'Admin');
  if (!adminFixture) {
    check('an admin fixture exists', false, 'no Admin in the manifest');
    process.exit(1);
  }
  const admin = (await signIn(adminFixture.login_id, 'admin')).token;
  check('admin signs in through the real credential flow', Boolean(admin), '');

  // --- baseline -----------------------------------------------------------
  const before = await canAuthenticate(target);
  if (before === RATE_LIMITED) {
    skip('admin suspension cycle', 'the request rate limit is already satisfied — re-run after a minute');
    finish();
    return;
  }
  check('the target can authenticate before suspension', before === 200, `status ${before}`);

  // --- suspend ------------------------------------------------------------
  const susp = await http('PUT', `/users/${target.user_id}`, {
    token: admin,
    body: { status: 'suspended' },
  });
  check('admin suspends the account', susp.status === 200, `status ${susp.status}`);

  // The point of the whole mutation.
  const during = await canAuthenticate(target);
  check(
    'a suspended account cannot authenticate',
    during !== 200 && during !== RATE_LIMITED,
    during === RATE_LIMITED
      ? 'rate limited — cannot distinguish suspension from throttling'
      : `status ${during} — a suspended user obtained a session`
  );

  // A non-admin must not be able to undo it.
  const doctorFixture = m.staff.find((s) => s.role === 'Doctor');
  if (doctorFixture) {
    const doctor = (await signIn(doctorFixture.login_id, 'doctor')).token;
    const escalate = await http('PUT', `/users/${target.user_id}`, {
      token: doctor,
      body: { status: 'active' },
    });
    check(
      'a doctor cannot reactivate a suspended account',
      [401, 403].includes(escalate.status),
      `status ${escalate.status}`
    );

    // And the suspension must still hold after that attempt.
    const stillOut = await canAuthenticate(target);
    check(
      'the account is still suspended after the failed escalation',
      stillOut !== 200 && stillOut !== RATE_LIMITED,
      `status ${stillOut}`
    );
  }

  // --- restore ------------------------------------------------------------
  const back = await http('PUT', `/users/${target.user_id}`, {
    token: admin,
    body: { status: 'active' },
  });
  check('admin reactivates the account', back.status === 200, `status ${back.status}`);

  const after = await canAuthenticate(target);
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

  finish();
}

function finish(): void {
  const failed = results.filter((r) => !r.passed && !r.skipped);
  console.log(`\n${'='.repeat(64)}`);
  console.log(`${results.filter((r) => r.passed).length}/${results.length} checks passed`);
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
