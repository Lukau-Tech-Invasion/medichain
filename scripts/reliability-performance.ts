/**
 * Reliability and performance qualification.
 *
 * # What this measures, and what it deliberately does not
 *
 * The workload is real clinical operations — patient reads, dashboards, the
 * lab queue, message sends, lab submissions — not `/health`. Benchmarking a
 * route that touches no database and no authorization tells you the HTTP stack
 * is fast, which nobody doubted.
 *
 * Numbers from this host are **capacity observations, not a production SLO**.
 * It is a developer laptop running PostgreSQL in Docker beside the API, the
 * browser, and whatever else. What the numbers are good for is comparing
 * operations against each other, spotting an operation whose tail is wildly
 * worse than its median, and proving correctness holds while the system is
 * under pressure — which is the part that actually matters clinically.
 *
 * # Reliability scenarios
 *
 * Included: duplicate submission under real concurrency, connection-pool
 * pressure, correctness during load, and recovery afterwards. The API-restart
 * scenario is driven by `scripts/reliability-restart.sh`, which owns the
 * process; this script proves the state that must survive it.
 *
 * Excluded and recorded rather than faked: a PostgreSQL restart needs
 * `docker exec`, which is unresponsive on this host (DATA-002), and worker
 * crash / outbox backlog need process control this script does not have.
 *
 * Usage:
 *   cd client
 *   MEDICHAIN_API_URL=http://127.0.0.1:8090/api \
 *   ./node_modules/.bin/vite-node ../scripts/reliability-performance.ts
 *
 *   --seed-only   establish state for a restart test, then exit
 *   --verify-only verify state survived a restart, then exit
 */
import {
  deriveCredential,
  openKeystore,
  signerFromSecret,
} from '../client/shared/src/auth/credentials';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.MEDICHAIN_API_URL ?? 'http://127.0.0.1:8090/api';
const PASSWORD = 'BrowserTest!2026';
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE_FILE = join(REPO_ROOT, '.browser-test', 'reliability-state.json');

type Json = Record<string, any>;

const checks: Array<{ name: string; passed: boolean; skipped?: boolean; detail: string }> = [];
function record(name: string, passed: boolean, detail = ''): void {
  checks.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${passed ? '' : `  -- ${detail}`}`);
}
function skip(name: string, reason: string): void {
  checks.push({ name, passed: false, skipped: true, detail: reason });
  console.log(`  SKIP  ${name}  -- ${reason}`);
}

async function http(
  method: string,
  path: string,
  o: { token?: string; body?: unknown; key?: string } = {}
): Promise<{ status: number; json: Json; ms: number }> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (o.token) h.Authorization = `Bearer ${o.token}`;
  if (method !== 'GET') h['Idempotency-Key'] = o.key ?? globalThis.crypto.randomUUID();
  const started = performance.now();
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
  return { status: r.status, json: j, ms: performance.now() - started };
}

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
  if (c.status === 429) throw new Error('RATE_LIMITED');
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

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Nearest-rank percentile.
 *
 * Deliberately not interpolated: with a few hundred samples an interpolated
 * p99 invents a latency no request actually experienced, and the point of a
 * tail measurement is that some real request was that slow.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

interface Sample {
  op: string;
  ms: number;
  ok: boolean;
}

function report(samples: Sample[]): void {
  const byOp = new Map<string, Sample[]>();
  for (const s of samples) {
    if (!byOp.has(s.op)) byOp.set(s.op, []);
    byOp.get(s.op)!.push(s);
  }

  console.log('\n  operation                          n     p50      p95      p99      max   errors');
  console.log('  ' + '-'.repeat(84));
  for (const [op, list] of [...byOp.entries()].sort()) {
    const ms = list.map((x) => x.ms).sort((a, b) => a - b);
    const errors = list.filter((x) => !x.ok).length;
    const f = (v: number) => `${v.toFixed(1)}ms`.padStart(8);
    console.log(
      `  ${op.padEnd(32)} ${String(list.length).padStart(4)} ${f(percentile(ms, 50))} ` +
        `${f(percentile(ms, 95))} ${f(percentile(ms, 99))} ${f(ms[ms.length - 1])} ` +
        `${String(errors).padStart(8)}`
    );
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(API)) {
    console.error(`\n  Refusing to run against ${API}. Local only.\n`);
    process.exit(1);
  }

  const m = JSON.parse(
    readFileSync(join(REPO_ROOT, '.browser-test', 'fixtures.json'), 'utf8')
  ) as Json;
  const pid = m.patient.linked_patient_id;
  const seedOnly = process.argv.includes('--seed-only');
  const verifyOnly = process.argv.includes('--verify-only');

  let doctor: string;
  try {
    doctor = await staffToken(
      m.staff.find((s: Json) => String(s.login_id).startsWith('bt.doctor.')).login_id
    );
  } catch (e) {
    if (String(e).includes('RATE_LIMITED')) {
      skip('reliability and performance', 'challenge limiter — re-run after a minute');
      finish();
      return;
    }
    throw e;
  }

  // -----------------------------------------------------------------------
  // Restart durability: seed before, verify after.
  // -----------------------------------------------------------------------
  if (seedOnly) {
    console.log('\nSeeding state for a restart test');
    const marker = `restart-${Date.now()}`;
    const sub = await http('POST', '/lab/submit', {
      token: doctor,
      body: {
        patient_id: pid,
        test_name: 'Restart Durability Panel',
        test_category: 'Chemistry',
        results: [
          { parameter: 'Sodium', value: '141', unit: 'mmol/L', reference_range: '135-145', flag: null },
        ],
        notes: marker,
      },
    });
    if (![200, 201].includes(sub.status)) {
      record('seed a lab submission before restart', false, `status ${sub.status}`);
      finish();
      return;
    }
    writeFileSync(
      STATE_FILE,
      JSON.stringify({ marker, submission_id: sub.json.submission_id ?? sub.json.id }, null, 2)
    );
    record('seeded a lab submission before restart', true, '');
    finish();
    return;
  }

  if (verifyOnly) {
    console.log('\nVerifying state survived the restart');
    if (!existsSync(STATE_FILE)) {
      record('restart state file exists', false, 'run --seed-only first');
      finish();
      return;
    }
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Json;
    const pending = await http('GET', '/lab/pending', { token: doctor });
    const body = JSON.stringify(pending.json);
    record(
      'the submission written before the restart is still there',
      body.includes(String(state.marker)),
      `marker ${state.marker} absent from the pending queue after restart`
    );
    // And the process really did restart with a working database behind it.
    const patient = await http('GET', `/patients/${pid}`, { token: doctor });
    record(
      'encrypted patient data still decrypts after the restart',
      patient.status === 200 && String(JSON.stringify(patient.json)).includes('Thandiwe'),
      `status ${patient.status} — the encryption keyring did not survive`
    );
    finish();
    return;
  }

  // -----------------------------------------------------------------------
  // 1. Duplicate submission under real concurrency
  // -----------------------------------------------------------------------
  console.log('\n1. Duplicate submission under concurrency');
  {
    const key = globalThis.crypto.randomUUID();
    const body = {
      patient_id: pid,
      test_name: 'Concurrency Duplicate Panel',
      test_category: 'Chemistry',
      results: [
        { parameter: 'Potassium', value: '4.2', unit: 'mmol/L', reference_range: '3.5-5.1', flag: null },
      ],
      notes: `dup-${key}`,
    };
    // Eight simultaneous retries of ONE logical request, as a flaky network
    // and an impatient clinician together would produce.
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => http('POST', '/lab/submit', { token: doctor, body, key }))
    );
    const created = responses.filter((r) => [200, 201].includes(r.status)).length;
    const duplicates = responses.filter((r) => r.status === 409).length;
    record(
      'eight concurrent retries of one request create exactly one',
      created === 1,
      `${created} created, ${duplicates} refused as duplicates`
    );

    // And the store agrees — the count is what matters, not the status codes.
    const all = await http('GET', '/lab/submissions', { token: doctor });
    const occurrences = (JSON.stringify(all.json).match(new RegExp(`dup-${key}`, 'g')) ?? []).length;
    record(
      'exactly one row exists for the retried request',
      occurrences === 1,
      `${occurrences} rows carry the marker`
    );
  }

  // -----------------------------------------------------------------------
  // 2. Connection-pool pressure, and correctness under it
  // -----------------------------------------------------------------------
  console.log('\n2. Connection-pool pressure');
  const samples: Sample[] = [];
  {
    const ops: Array<[string, () => Promise<{ status: number; json: Json; ms: number }>]> = [
      ['GET /patients/{id}', () => http('GET', `/patients/${pid}`, { token: doctor })],
      ['GET /patients', () => http('GET', '/patients', { token: doctor })],
      ['GET /dashboard/doctor', () => http('GET', '/dashboard/doctor', { token: doctor })],
      ['GET /lab/pending', () => http('GET', '/lab/pending', { token: doctor })],
      ['GET /records/{id}', () => http('GET', `/records/${pid}`, { token: doctor })],
      ['GET /access-logs/{id}', () => http('GET', `/access-logs/${pid}?limit=50`, { token: doctor })],
    ];

    // 40 concurrent in flight, several waves. Enough to queue behind the pool
    // without pretending this laptop is a production cluster.
    const WAVES = 6;
    const CONCURRENCY = 40;
    for (let w = 0; w < WAVES; w += 1) {
      const batch = Array.from({ length: CONCURRENCY }, (_, i) => {
        const [name, run] = ops[i % ops.length];
        return run().then((r) => {
          samples.push({ op: name, ms: r.ms, ok: r.status === 200 });
          return r;
        });
      });
      await Promise.all(batch);
    }

    const errors = samples.filter((s) => !s.ok).length;
    record(
      'no request fails under sustained concurrency',
      errors === 0,
      `${errors}/${samples.length} requests did not return 200`
    );
  }

  // -----------------------------------------------------------------------
  // 3. Correctness during load — the part that matters clinically
  // -----------------------------------------------------------------------
  console.log('\n3. Correctness while under load');
  {
    const marker = `underload-${Date.now()}`;
    const noise = Array.from({ length: 30 }, () =>
      http('GET', '/dashboard/doctor', { token: doctor })
    );
    const write = http('POST', '/lab/submit', {
      token: doctor,
      body: {
        patient_id: pid,
        test_name: 'Under Load Panel',
        test_category: 'Hematology',
        results: [
          { parameter: 'Haemoglobin', value: '13.9', unit: 'g/dL', reference_range: '12.0-17.5', flag: null },
        ],
        notes: marker,
      },
    });
    const [writeResult] = await Promise.all([write, ...noise]);
    record(
      'a clinical write succeeds while the API is saturated',
      [200, 201].includes(writeResult.status),
      `status ${writeResult.status}`
    );

    const readBack = await http('GET', '/lab/pending', { token: doctor });
    record(
      'that write is readable immediately afterwards',
      JSON.stringify(readBack.json).includes(marker),
      'the write returned success but is not in the queue'
    );
  }

  // -----------------------------------------------------------------------
  // 4. Recovery
  // -----------------------------------------------------------------------
  console.log('\n4. Recovery after load');
  {
    const after = await http('GET', `/patients/${pid}`, { token: doctor });
    record('the API serves normally after the load', after.status === 200, `status ${after.status}`);
    record(
      'latency returns to a normal range after load',
      after.ms < 2000,
      `${after.ms.toFixed(0)}ms for a single patient read`
    );
  }

  // -----------------------------------------------------------------------
  // 5. Scenarios this environment cannot run
  // -----------------------------------------------------------------------
  console.log('\n5. Not executable here');
  skip(
    'PostgreSQL restart',
    'needs `docker exec` / container control, which is unresponsive on this host (DATA-002)'
  );
  skip(
    'worker crash and outbox backlog',
    'needs process control over the outbox worker, which this harness does not have'
  );
  skip(
    'blockchain outage and recovery',
    'BLOCKCHAIN_ENABLED=false here and no node can be built on this host (BC-003)'
  );

  report(samples);
  finish();
}

function finish(): never {
  const failed = checks.filter((c) => !c.passed && !c.skipped);
  const skipped = checks.filter((c) => c.skipped);
  const passed = checks.filter((c) => c.passed);
  console.log(`\n${'='.repeat(88)}`);
  console.log(
    `${passed.length}/${passed.length + failed.length} checks passed` +
      (skipped.length ? `, ${skipped.length} skipped` : '')
  );
  if (skipped.length) {
    console.log('\nSKIPPED (not executable in this environment, not a result):');
    for (const s of skipped) console.log(`  ${s.name}\n      ${s.detail}`);
  }
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
