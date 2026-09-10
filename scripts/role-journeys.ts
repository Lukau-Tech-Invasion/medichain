/**
 * One complete journey per role, against a live server.
 *
 * # Why
 *
 * `cross-role-qualification.ts` proves the walls: 114 checks, every one of them
 * a denial, a maker-checker refusal, or a token that must not work twice. It
 * says nothing about whether the right person can finish their shift.
 *
 * Measured on 2026-09-10 against the running stack, the number of screens whose
 * Save had ever been driven against a live server was **0 of 14** for an
 * administrator, **1 of 9** for a lab technician, **3 of 37** for a doctor,
 * **5 of 18** for a nurse and **2 of 7** for a pharmacist. Each of those pages
 * has a unit test — and a unit test renders the page against a mocked `fetch`,
 * which cannot tell you that the handler behind it reads `actual_time` while
 * the form sends `administered_time`.
 *
 * This harness asks the other question. Six journeys, one per role, each a
 * single coherent story told in the order the work is actually done, and each
 * ending where it has to end: with the next person in the workflow seeing what
 * the last one recorded.
 *
 * # Running it
 *
 *   docker compose up -d                     # or scripts/run-browser-e2e-api.sh
 *   npx tsx scripts/seed-browser-test-fixtures.ts --i-understand-this-writes-accounts
 *   cd client && MEDICHAIN_API_URL=http://127.0.0.1/api \
 *     ./node_modules/.bin/vite-node ../scripts/role-journeys.ts
 *
 * `--only=nurse,doctor` runs a subset.
 *
 * # Safety
 *
 * Synthetic fixtures only. `loadManifest()` refuses any non-local endpoint.
 */

import { Journal, loadManifest, signIn, signInPatient, ChallengeRateLimited, type Session } from './lib/journey';
import { nurseJourney } from './journeys/nurse';
import { doctorJourney } from './journeys/doctor';
import { labTechJourney } from './journeys/labtech';
import { pharmacistJourney } from './journeys/pharmacist';
import { adminJourney } from './journeys/admin';
import { patientJourney } from './journeys/patient';
import { reachabilityJourney } from './journeys/reachability';

const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').replace('--only=', '');
const wanted = only ? new Set(only.split(',').map((s) => s.trim())) : null;
const runs = (name: string) => !wanted || wanted.has(name);

async function main(): Promise<void> {
  const m = loadManifest();
  const j = new Journal();

  // Sign-ins first, and separately.
  //
  // If a session cannot be built, every later refusal is indistinguishable from
  // a correct denial — so the journeys do not start until their actors exist.
  j.journey('Sessions — every actor these journeys need');
  const sessions: Record<string, Session> = {};

  // Resolved from the manifest, not written out here.
  //
  // `MEDICHAIN_FIXTURE_SUFFIX` exists because staff identifiers are unique and
  // cannot be re-pointed, so a second seed against the same database produces
  // `bt.doctor.2` rather than colliding with `bt.doctor`. Hardcoding the
  // unsuffixed names meant this harness could only ever run against the very
  // first seed a database received — and the failure was nine sign-in errors
  // that read like an authentication defect.
  //
  // The manifest lists staff in seeding order, so the second of each role is
  // the `*2` fixture: a second doctor for maker-checker review, a second nurse
  // for a shift handoff that is a real transfer between two people, a second
  // pharmacist because dispensing refuses self-verification, a second lab
  // technician for the administrator's role-change journey.
  const byRole = (role: string) => m.staff.filter((s) => s.role === role).map((s) => s.login_id);
  const [doctor1, doctor2] = byRole('Doctor');
  const [nurse1, nurse2] = byRole('Nurse');
  const [pharm1, pharm2] = byRole('Pharmacist');
  const [lab1, lab2] = byRole('LabTechnician');
  const [admin1] = byRole('Admin');
  const needed: Array<[string, string]> = (
    [
      ['doctor', doctor1],
      ['doctor2', doctor2],
      ['nurse', nurse1],
      ['nurse2', nurse2],
      ['pharmacist', pharm1],
      ['pharmacist2', pharm2],
      ['labtech', lab1],
      ['labtech2', lab2],
      ['admin', admin1],
    ] as Array<[string, string | undefined]>
  ).filter((pair): pair is [string, string] => {
    if (pair[1]) return true;
    // Absent from the manifest is a seeding gap, not a sign-in failure, and
    // saying which is the difference between a one-line fix and an afternoon.
    j.skip(`${pair[0]} signs in`, 'no such fixture in .browser-test/fixtures.json — re-seed');
    return false;
  });
  for (const [key, loginId] of needed) {
    try {
      sessions[key] = await signIn(loginId, key);
      j.record(`${key} (${loginId}) signs in`, true);
    } catch (e) {
      if (e instanceof ChallengeRateLimited) {
        j.skip(`${key} (${loginId}) signs in`, 'challenge limiter — rerun in a minute');
      } else {
        j.record(
          `${key} (${loginId}) signs in`,
          false,
          `${String(e)}\n         If this account does not exist, run:\n` +
            `           npx tsx scripts/seed-browser-test-fixtures.ts --i-understand-this-writes-accounts`
        );
      }
    }
  }
  try {
    sessions.patient = await signInPatient(m.patient.mnemonic, m.patient.wallet, 'patient');
    j.record('patient signs in with their wallet', true);
  } catch (e) {
    if (e instanceof ChallengeRateLimited) {
      // The limiter is five challenges per wallet per minute, and re-running
      // this harness inside a minute legitimately exhausts it. A control doing
      // its job is a SKIP, not a failure — recording it red teaches a reader to
      // ignore a red result caused by security working. The staff sign-ins
      // above already did this; the patient's did not.
      j.skip('patient signs in with their wallet', 'challenge limiter — rerun in a minute');
    } else {
      j.record('patient signs in with their wallet', false, String(e));
    }
  }

  const have = (...keys: string[]) => keys.every((k) => sessions[k] !== undefined);

  // Order matters. The doctor's journey registers a patient and writes the
  // orders and prescriptions the other roles act on, so it runs first; the
  // administrator's runs last because it changes roles, and a role change
  // in the middle would be indistinguishable from an authorization defect in
  // whatever ran next.
  const journeys: Array<[string, string[], () => Promise<void>]> = [
    ['doctor', ['doctor', 'doctor2'], () => doctorJourney(j, sessions.doctor, sessions.doctor2, m)],
    ['nurse', ['nurse', 'nurse2'], () => nurseJourney(j, sessions.nurse, sessions.nurse2, m)],
    ['labtech', ['labtech', 'doctor'], () => labTechJourney(j, sessions.labtech, sessions.doctor, m)],
    [
      'pharmacist',
      ['pharmacist', 'pharmacist2', 'doctor'],
      () => pharmacistJourney(j, sessions.pharmacist, sessions.pharmacist2, sessions.doctor, m),
    ],
    ['patient', ['patient', 'doctor'], () => patientJourney(j, sessions.patient, sessions.doctor, m)],
    [
      'admin',
      ['admin', 'labtech2', 'doctor'],
      // A clinician is needed too: declaring a mass-casualty incident writes
      // clinical content, so `create_mci` is gated on
      // `can_edit_medical_records`, which deliberately excludes `Admin`. The
      // administrator's half of that screen is the oversight read.
      () => adminJourney(j, sessions.admin, sessions.labtech2, sessions.doctor, m),
    ],
  ];

  journeys.push([
    'reachability',
    ['doctor', 'nurse', 'labtech', 'pharmacist'],
    () => reachabilityJourney(j, sessions, m),
  ]);

  for (const [name, needs, run] of journeys) {
    if (!runs(name)) continue;
    if (!have(...needs)) {
      j.journey(`${name} journey`);
      j.skip('the whole journey', `missing session(s): ${needs.filter((k) => !sessions[k]).join(', ')}`);
      continue;
    }
    try {
      await run();
    } catch (e) {
      // A journey that throws must not take the other five with it. The
      // failure is recorded where it happened and the run continues, because
      // the point of this harness is a complete picture rather than the first
      // thing that broke.
      // The stack, not just the message. A journey that throws is a defect in
      // this harness or an unhandled shape from the API, and neither is
      // diagnosable from "Cannot read properties of undefined".
      const stack = e instanceof Error ? (e.stack ?? e.message) : String(e);
      j.record(`${name} journey completed without throwing`, false, stack.slice(0, 900));
    }
  }

  const failed = j.summarise();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
