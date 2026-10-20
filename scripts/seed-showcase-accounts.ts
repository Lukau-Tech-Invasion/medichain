#!/usr/bin/env node
/**
 * Showcase accounts for reviewers (FNB App of the Year judges): one person per
 * clinical role and four patients, all with South African names, realistic but
 * clearly fabricated records, and a strong generated passphrase each.
 *
 *   MEDICHAIN_API_URL=https://<domain>/api \
 *   MEDICHAIN_ADMIN_LOGIN_ID=<your admin> MEDICHAIN_ADMIN_PASSWORD=<its password> \
 *   SHOWCASE_CREDENTIALS_FILE=<absolute path outside the repository> \
 *   npx tsx scripts/seed-showcase-accounts.ts --i-understand-this-writes-accounts
 *
 * Run it as the deployment's administrator (the only account that can create
 * staff). Every account is signed in once before the file is written, so what
 * reaches a reviewer is known to work. The credentials file holds passwords:
 * keep it outside the repository and send usernames and passwords separately.
 *
 * Re-running is safe: an account that already signs in with the passphrase in
 * the existing credentials file is adopted, never re-registered.
 *
 * There is no Admin account here: the API cannot create a second administrator
 * (`/api/auth/register` and `/api/roles/assign` both refuse the role), by design.
 */
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  type Account,
  type Json,
  type StaffFixture,
  SeedFailure,
  adminConfirmer,
  call,
  ensurePatientAccess,
  fail,
  issuedMedicalId,
  obtainAdmin,
  provisionPatient,
  provisionStaff,
  tryLogin,
} from './seed-browser-test-fixtures';

const API = process.env.MEDICHAIN_API_URL ?? 'http://localhost/api';
const OUT = process.env.SHOWCASE_CREDENTIALS_FILE;
const FORCE = process.argv.includes('--i-understand-this-writes-accounts');

const STAFF: StaffFixture[] = [
  { key: 'doctor', loginId: 'naledi.mahlaba', name: 'Dr Naledi Mahlaba', role: 'Doctor' },
  { key: 'doctor2', loginId: 'riaan.botha', name: 'Dr Riaan Botha', role: 'Doctor' },
  { key: 'nurse', loginId: 'busisiwe.zulu', name: 'Sister Busisiwe Zulu', role: 'Nurse' },
  { key: 'pharmacist', loginId: 'fatima.ebrahim', name: 'Fatima Ebrahim', role: 'Pharmacist' },
  { key: 'labtech', loginId: 'kagiso.mokoena', name: 'Kagiso Mokoena', role: 'LabTechnician' },
  { key: 'paramedic', loginId: 'bongani.mthembu', name: 'Bongani Mthembu', role: 'Paramedic' },
];

/**
 * What each reviewer's profile says about them. Screens show department and
 * specialty (the provider list, message recipients, the staff roster); left
 * unset they read blank for every account.
 */
const STAFF_PROFILE: Record<string, { department: string; specialty: string }> = {
  'naledi.mahlaba': { department: 'Emergency Department', specialty: 'Emergency Medicine' },
  'riaan.botha': { department: 'Internal Medicine', specialty: 'Internal Medicine' },
  'busisiwe.zulu': { department: 'Emergency Department', specialty: 'Emergency Nursing' },
  'fatima.ebrahim': { department: 'Pharmacy', specialty: 'Clinical Pharmacy' },
  'kagiso.mokoena': { department: 'Laboratory', specialty: 'Clinical Pathology' },
  'bongani.mthembu': { department: 'Emergency Medical Services', specialty: 'Advanced Life Support' },
};

/**
 * Four patients whose records exercise different screens: chronic disease,
 * pregnancy, anticoagulation with a drug allergy, and epilepsy. Identifiers are
 * marked DEMO and phone numbers use an unallocated +27 00 prefix, so nothing
 * here can be mistaken for, or collide with, a real person.
 */
const PATIENTS: Array<{ username: string; record: Json }> = [
  {
    username: 'thabo.mahlangu',
    record: {
      full_name: 'Thabo Mahlangu', date_of_birth: '1971-03-08', national_id: 'DEMO-ZA-0001',
      phone: '+27000300101', blood_type: 'B+', allergies: ['aspirin'],
      current_medications: ['metformin 850mg twice daily', 'amlodipine 10mg daily'],
      chronic_conditions: ['type 2 diabetes', 'hypertension'],
      emergency_contact_name: 'Lindiwe Mahlangu', emergency_contact_phone: '+27000300102',
      emergency_contact_relationship: 'spouse', organ_donor: true, dnr_status: false, languages: ['en', 'zu'],
    },
  },
  {
    username: 'zanele.khumalo',
    record: {
      full_name: 'Zanele Khumalo', date_of_birth: '1994-09-21', national_id: 'DEMO-ZA-0002',
      phone: '+27000300201', blood_type: 'O-', allergies: [],
      current_medications: ['folic acid 5mg daily', 'salbutamol inhaler as needed'],
      chronic_conditions: ['asthma'],
      emergency_contact_name: 'Sibusiso Khumalo', emergency_contact_phone: '+27000300202',
      emergency_contact_relationship: 'partner', organ_donor: false, dnr_status: false, languages: ['en', 'xh'],
    },
  },
  {
    username: 'johan.pretorius',
    record: {
      full_name: 'Johan Pretorius', date_of_birth: '1958-12-02', national_id: 'DEMO-ZA-0003',
      phone: '+27000300301', blood_type: 'A+', allergies: ['penicillin'],
      current_medications: ['warfarin 5mg daily', 'bisoprolol 2.5mg daily'],
      chronic_conditions: ['atrial fibrillation'],
      emergency_contact_name: 'Annelie Pretorius', emergency_contact_phone: '+27000300302',
      emergency_contact_relationship: 'daughter', organ_donor: true, dnr_status: false, languages: ['af', 'en'],
    },
  },
  {
    username: 'ayanda.ngcobo',
    record: {
      full_name: 'Ayanda Ngcobo', date_of_birth: '2001-06-14', national_id: 'DEMO-ZA-0004',
      phone: '+27000300401', blood_type: 'AB+', allergies: ['latex'],
      current_medications: ['levetiracetam 500mg twice daily'],
      chronic_conditions: ['epilepsy'],
      emergency_contact_name: 'Nomvula Ngcobo', emergency_contact_phone: '+27000300402',
      emergency_contact_relationship: 'mother', organ_donor: false, dnr_status: false, languages: ['en', 'zu'],
    },
  },
];

/**
 * A short, neutral word list. Five words and a two-digit number is about 41
 * bits from 300 words, and the server's rules (15+ characters, not common, not
 * breached) are met by construction. Easy to read aloud and to type on a phone.
 */
const WORDS = (
  'acacia amber anchor apricot arrow aurora autumn badger bamboo banjo baobab basil beacon birch ' +
  'blossom boulder breeze bridge bronze buffalo cactus canyon carbon cedar chalk cheetah cinnamon ' +
  'citrus clover cobalt comet compass copper coral cosmos cotton crane crater cricket crystal ' +
  'cypress dahlia delta desert dolphin dune eagle ebony echo elephant ember emerald falcon fennel ' +
  'fern fig firefly fjord flint forest fossil fountain fox galaxy garnet gazelle geyser ginger ' +
  'glacier granite grove gull harbour harvest hazel heron hibiscus horizon impala indigo iris ' +
  'island ivory jacaranda jade jasmine kelp kestrel kiwi kudu lagoon lantern lark lava lemon ' +
  'leopard lichen lily lotus lynx magnet mahogany malachite mango maple marble marula meadow ' +
  'meerkat mesa mint monsoon moss nectar nebula nutmeg oasis ocean olive onyx opal orbit orchid ' +
  'osprey otter oyster palm papaya pebble pelican pepper pine plateau plum pollen poplar prairie ' +
  'protea quartz quill quince raven reef ridge river robin rooibos saffron sage salt sandstone ' +
  'savanna seal sequoia shale shell sierra silver sparrow spruce starling stone summit sunbird ' +
  'swallow tamarind teak thistle thunder tide timber topaz tortoise tulip tundra turtle umber ' +
  'valley velvet violet volcano walnut waterfall wattle willow wren yarrow yellowwood zebra zinnia'
).split(' ');

function passphrase(): string {
  const words = Array.from({ length: 5 }, () => WORDS[randomInt(WORDS.length)]);
  return `${words.join('-')}-${randomInt(10, 100)}`;
}

/** The one approved device every reviewer's clinical account uses. */
const SHOWCASE_DEVICE = 'Showcase emergency device';

/**
 * Emergency access (NFC card or QR scan) runs only from an approved device in
 * the clinician's facility. An approved device is a record, not a handset, so
 * one serves every reviewer on any phone, and the emergency screen selects it
 * by itself when it is the only one.
 *
 * Its credential must be renewed every 30 days (7 days' grace after that), so
 * every run renews it: run this script again within 30 days of judging.
 */
async function ensureShowcaseDevice(admin: Account, clinician: Account): Promise<string> {
  const work = await call('POST', '/identity/context/work', {}, clinician.token);
  const context = (work.json.context ?? {}) as Json;
  const organization = String(context.organization_id ?? '');
  const facility = context.facility_id ? String(context.facility_id) : null;
  if (!organization) fail('read the clinicians\' work location', work.status, work.json);

  const listed = await call('GET', '/devices', undefined, admin.token);
  if (listed.status !== 200) fail('list approved devices', listed.status, listed.json);
  const devices = ((listed.json.devices ?? []) as Json[]).filter(
    (device) =>
      device.device_name === SHOWCASE_DEVICE &&
      device.organization_id === organization &&
      (device.facility_id ?? null) === facility &&
      String(device.status ?? '').toLowerCase() !== 'revoked'
  );
  let deviceId = String(devices[0]?.id ?? '');
  const confirmer = adminConfirmer(admin);
  if (!deviceId) {
    const enrolled = await call(
      'POST',
      '/devices/enroll',
      {
        organization_id: organization,
        facility_id: facility,
        device_name: SHOWCASE_DEVICE,
        device_type: 'handheld',
        hardware_fingerprint: `showcase-${randomInt(1e9, 1e10)}`,
        platform: 'Any phone (reviewer accounts)',
      },
      admin.token,
      confirmer
    );
    if (enrolled.status !== 201) fail('enrol the showcase device', enrolled.status, enrolled.json);
    deviceId = String(enrolled.json.id);
  }
  const keyId = `showcase-${new Date().toISOString().slice(0, 10)}-${randomInt(1e5, 1e6)}`;
  const rotated = await call('POST', `/devices/${deviceId}/rotate`, { key_id: keyId }, admin.token, confirmer);
  if (rotated.status !== 200) fail('renew the showcase device credential', rotated.status, rotated.json);
  return String(rotated.json.next_rotation_at ?? '');
}

interface Issued {
  role: string;
  name: string;
  login_id: string;
  password: string;
  user_id: string;
  linked_patient_id?: string;
  medical_id?: string;
}

/** Passphrases from an earlier run, so a re-run adopts instead of failing. */
function earlierPasswords(): Map<string, string> {
  const known = new Map<string, string>();
  if (!OUT || !existsSync(OUT)) return known;
  const previous = JSON.parse(readFileSync(OUT, 'utf8')) as { accounts?: Issued[] };
  for (const account of previous.accounts ?? []) known.set(account.login_id, account.password);
  return known;
}

async function main(): Promise<void> {
  if (!OUT || !isAbsolute(OUT)) {
    console.error('Set SHOWCASE_CREDENTIALS_FILE to an absolute path outside the repository.');
    throw new SeedFailure('stopped');
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(API) && !FORCE) {
    console.error(`Refusing to write accounts to ${API} without --i-understand-this-writes-accounts.`);
    throw new SeedFailure('stopped');
  }
  if (!process.env.MEDICHAIN_ADMIN_LOGIN_ID) {
    console.error('Set MEDICHAIN_ADMIN_LOGIN_ID and MEDICHAIN_ADMIN_PASSWORD to the deployment administrator.');
    throw new SeedFailure('stopped');
  }
  console.log(`\nShowcase accounts against ${API}\n`);
  const admin = await obtainAdmin();
  const known = earlierPasswords();
  const issued: Issued[] = [];

  const staff: Account[] = [];
  for (const fixture of STAFF) {
    const password = known.get(fixture.loginId) ?? passphrase();
    const account = (await tryLogin(fixture.loginId, password)) ?? (await provisionStaff(admin, fixture, password));
    staff.push(account);
    const profile = STAFF_PROFILE[fixture.loginId];
    if (profile) {
      const saved = await call('PUT', `/users/${account.userId}`, profile, admin.token, adminConfirmer(admin));
      if (saved.status !== 200) fail(`set ${fixture.loginId}'s department and specialty`, saved.status, saved.json);
    }
    issued.push({ role: fixture.role, name: fixture.name, login_id: fixture.loginId, password, user_id: account.userId });
    console.log(`  · ${fixture.role.padEnd(13)} ${fixture.name}`);
  }
  const doctor = staff[0];

  for (const { username, record } of PATIENTS) {
    const password = known.get(username) ?? passphrase();
    const { account, patientId } = await provisionPatient(admin, doctor, record, username, password);
    const medicalId = await issuedMedicalId(patientId, account.token);
    // Each patient lets the care team open their chart, as a patient would in
    // the app, so reviewers can work every clinical screen without setup.
    for (const provider of staff.filter((s) => s.role !== 'Paramedic')) {
      await ensurePatientAccess(patientId, account, provider, password, 'Clinical care at the showcase clinic');
    }
    issued.push({
      role: 'Patient', name: String(record.full_name), login_id: username, password,
      user_id: account.userId, linked_patient_id: patientId, medical_id: medicalId,
    });
    console.log(`  · Patient       ${record.full_name}  (${medicalId})`);
  }

  const renewBy = await ensureShowcaseDevice(admin, doctor);
  console.log(`\n  · Approved device "${SHOWCASE_DEVICE}" ready; renew by running this again before ${renewBy || 'its rotation date'}`);

  // Proof before anything is handed out: every account signs in from scratch.
  console.log('\nSign-in check');
  for (const account of issued) {
    if (!(await tryLogin(account.login_id, account.password))) {
      fail(`${account.login_id} does not sign in with its issued passphrase`, 0, {});
    }
    console.log(`  ✓ ${account.login_id}`);
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        api: API,
        warning: 'Reviewer credentials. Fabricated people and records. Send usernames and passwords separately.',
        accounts: issued,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
  console.log(`\n${issued.length} accounts verified. Credentials written to ${OUT}\n`);
}

main().catch((err) => {
  if (!(err instanceof SeedFailure)) console.error(err);
  process.exitCode = 1;
});
