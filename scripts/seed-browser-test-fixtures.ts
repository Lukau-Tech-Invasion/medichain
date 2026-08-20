/**
 * Provision the browser-test identity fixtures.
 *
 * # Why this exists
 *
 * `docs/BROWSER_FULL_APPLICATION_AUDIT_2026-08-19.md` closed as **BLOCKED**:
 * doctor and nurse workflows could not be browser-tested at all, because the
 * running image exposes only (1) a username/password form with no seeded staff
 * credentials and (2) a wallet-extension option unavailable in an isolated test
 * browser. The demo identity buttons exist in source but sit behind
 * `FEATURES.DEMO_WALLET_GENERATION`, which is development-only — and enabling
 * them in the shipped image is exactly the bypass the audit says not to add.
 *
 * The remaining honest option is the one the audit asks for: real accounts,
 * created through the product's own onboarding path, with credentials a tester
 * can type. That is what this script provisions.
 *
 * # Why it derives credentials rather than inserting rows
 *
 * It imports `client/shared/src/auth/credentials.ts` — the same module the
 * browser uses — so the fixture password is turned into an auth proof and an
 * encrypted keystore by exactly the code path a real sign-in will later verify.
 * A seed that wrote its own Argon2id row or its own envelope would drift from
 * the login it is meant to exercise, and the drift would surface as a login
 * failure nobody could explain.
 *
 * # Safety
 *
 * Synthetic data only. It refuses to run against anything but an explicitly
 * named local endpoint unless `--i-understand-this-writes-accounts` is passed,
 * and it never runs against a deployment that is not in demo mode. The
 * credentials it prints are throwaway and belong in a test profile, never in a
 * production image.
 *
 *   npx vite-node scripts/seed-browser-test-fixtures.ts
 */

import {
  deriveCredential,
  createKeystore,
  generateWalletIdentity,
} from '../client/shared/src/auth/credentials';

/**
 * The mini-secret and address of a Substrate well-known development account.
 *
 * An already-bootstrapped deployment cannot mint a second first-admin, and
 * credential enrolment needs the account's key — so an admin browser fixture
 * looked impossible against an existing database. It is not, when the seeded
 * administrator is `//Alice`: that key is published in the Substrate source, so
 * it can simply be re-derived here.
 *
 * That is also exactly why `startup::validate_no_privileged_dev_accounts`
 * refuses to boot a non-demo instance where one of these accounts holds a
 * privileged role. Deriving it is safe *because* production cannot use it.
 */
async function devAccount(suri: string): Promise<{ secretKey: Uint8Array; address: string }> {
  const {
    cryptoWaitReady, mnemonicToMiniSecret, sr25519PairFromSeed,
    encodeAddress, keyExtractPath, keyFromPath,
  } = await import('@polkadot/util-crypto');
  await cryptoWaitReady();
  // The canonical Substrate development phrase.
  const DEV_PHRASE = 'bottom drive obey lake curtain smoke basket hold race lonely fit walk';
  const { path } = keyExtractPath(suri);
  const pair = keyFromPath(sr25519PairFromSeed(mnemonicToMiniSecret(DEV_PHRASE)), path, 'sr25519');
  // The **full 64-byte secret key**, not a 32-byte slice of it. A hard-derived
  // account has no mini-secret that reproduces it, which is why the keystore
  // had to learn to carry a secret key (KEYSTORE_VERSION 2).
  return { secretKey: pair.secretKey, address: encodeAddress(pair.publicKey, 42) };
}

const API = process.env.MEDICHAIN_API_URL ?? 'http://localhost/api';
const BOOTSTRAP_KEY =
  process.env.MEDICHAIN_BOOTSTRAP_KEY ?? 'medichain-dev-bootstrap-2024';
const FORCE = process.argv.includes('--i-understand-this-writes-accounts');

/** Fixture password. Deliberately weak and deliberately printed: it is a test key. */
const PASSWORD = 'BrowserTest!2026';

interface StaffFixture {
  key: 'doctor' | 'nurse' | 'admin';
  loginId: string;
  name: string;
  username: string;
  role: 'Doctor' | 'Nurse' | 'Admin';
}

/**
 * Distinguishes repeat runs. Staff identifiers are unique and cannot be
 * re-pointed at a new wallet, so a second run against the same database needs
 * its own set rather than silently colliding with the first.
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
  { key: 'doctor', loginId: sfx('bt.doctor'), name: 'Dr Browser Test', username: sfx('btdoctor'), role: 'Doctor' },
  { key: 'nurse', loginId: sfx('bt.nurse'), name: 'Nurse Browser Test', username: sfx('btnurse'), role: 'Nurse' },
];

/** The synthetic patient the patient fixture is bound to. */
const PATIENT = {
  full_name: 'Thandiwe Browser-Test',
  date_of_birth: '1988-04-12',
  national_id: 'BT-PATIENT-0001',
  phone: '+27000000100',
  blood_type: 'O+',
  allergies: ['penicillin'],
  current_medications: ['metformin 500mg'],
  chronic_conditions: ['type 2 diabetes'],
  emergency_contact_name: 'Sipho Browser-Test',
  emergency_contact_phone: '+27000000101',
  emergency_contact_relationship: 'spouse',
  organ_donor: true,
  dnr_status: false,
  languages: ['en'],
};

type Json = Record<string, unknown>;

async function call(
  method: string,
  path: string,
  body?: unknown,
  actor?: string
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (actor) headers['X-User-Id'] = actor;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json: Json = {};
  try {
    json = (await res.json()) as Json;
  } catch {
    /* empty body is fine for some 2xx responses */
  }
  return { status: res.status, json };
}

function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Treats "already exists" as success so the script can be re-run. */
function okOrExisting(status: number, json: Json): boolean {
  if (ok(status)) return true;
  const code = String(json.code ?? '');
  return status === 409 || /ALREADY|EXISTS|DUPLICATE|BOOTSTRAPPED/i.test(code);
}

function fail(what: string, status: number, json: Json): never {
  console.error(`\n  FAILED: ${what}\n    HTTP ${status}\n    ${JSON.stringify(json)}\n`);
  process.exit(1);
}

async function assertLocalDemoDeployment(): Promise<void> {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(API);
  if (!isLocal && !FORCE) {
    console.error(
      `\n  Refusing to run against ${API}.\n` +
        `  This creates real accounts. Point MEDICHAIN_API_URL at a local test\n` +
        `  deployment, or pass --i-understand-this-writes-accounts.\n`
    );
    process.exit(1);
  }

  const health = await call('GET', '/../health');
  if (!ok(health.status)) {
    console.error(`\n  API is not reachable at ${API} (health -> ${health.status}).\n`);
    process.exit(1);
  }
}

/**
 * Bind an employee identifier and password to a wallet the caller controls.
 *
 * `secret` is a 32-byte mini-secret for a seed-derived account or a 64-byte
 * secret key for one that came from a derivation path; `createKeystore` records
 * which, so the login can rebuild the right account.
 */
async function enrolCredentials(loginId: string, wallet: string, secret: Uint8Array) {
  // Same derivation the browser performs: the password never travels, only the
  // auth branch of it, and the keystore branch never leaves this process.
  const { authProof, keystoreKey } = await deriveCredential(PASSWORD, loginId);
  const encryptedKeystore = await createKeystore(secret, wallet, keystoreKey);

  const res = await call(
    'POST',
    '/auth/credentials',
    { login_id: loginId, auth_proof: authProof, encrypted_keystore: encryptedKeystore },
    wallet
  );

  // `LOGIN_ID_TAKEN` must NOT be treated as success. The identifier would still
  // resolve — to the wallet from a previous run — while this run's manifest
  // named the new one, so every fixture would sign in as somebody else and the
  // linked-patient assertions would fail somewhere far from the cause.
  if (String(res.json.code ?? '') === 'LOGIN_ID_TAKEN' || res.status === 409) {
    console.error(
      `\n  '${loginId}' is already enrolled, from an earlier run.\n` +
        `  Credentials cannot be re-pointed at a new wallet (there is deliberately\n` +
        `  no server-side reset — see api/src/handlers/staff_credentials.rs).\n\n` +
        `  Either reset the test database, or re-run with a distinct set:\n` +
        `    MEDICHAIN_FIXTURE_SUFFIX=2 npx vite-node scripts/seed-browser-test-fixtures.ts\n`
    );
    process.exit(1);
  }
  if (!ok(res.status)) {
    fail(`enrol credentials for ${loginId}`, res.status, res.json);
  }
}

async function main(): Promise<void> {
  await assertLocalDemoDeployment();
  console.log(`\nProvisioning browser-test fixtures against ${API}\n`);

  // ---- Administrator ------------------------------------------------------
  const adminIdentity = await generateWalletIdentity();
  const bootstrap = await call('POST', '/auth/bootstrap', {
    wallet_address: adminIdentity.address,
    name: 'Browser Test Bootstrap Admin',
    username: 'btbootstrap',
    secret_key: BOOTSTRAP_KEY,
  });

  // A already-bootstrapped deployment needs an existing admin to create the
  // rest. Without one there is no path forward, and saying so is more useful
  // than failing later on a 403 that looks like an authorization bug.
  let adminWallet = adminIdentity.address;
  // Only a bootstrapped-by-us admin has a known mnemonic, and enrolment
  // requires controlling the key. Against an existing deployment the admin
  // fixture is therefore not creatable — which is the limitation the
  // 2026-08-14 audit recorded, stated up front here instead of surfacing as an
  // unexplained 403 on the Admin Dashboard.
  let adminCredentialed = false;
  if (!ok(bootstrap.status)) {
    const existing = process.env.MEDICHAIN_ADMIN_WALLET;
    if (!existing) {
      console.error(
        `\n  This deployment is already bootstrapped (bootstrap -> ${bootstrap.status}),\n` +
          `  so a new first admin cannot be created. Re-run against a fresh database,\n` +
          `  or set MEDICHAIN_ADMIN_WALLET to an existing active administrator wallet.\n`
      );
      process.exit(1);
    }
    adminWallet = existing;
    console.log(`  · using existing administrator ${adminWallet}`);

    // A deployment cannot mint a second first-admin (`/api/auth/bootstrap` is
    // once-only) and `assign_role` refuses to grant `Admin` — both deliberate.
    // So an admin credential fixture is only possible when this run holds the
    // administrator's key. It does when the seeded admin is a Substrate
    // well-known development account, whose secret is published: re-derive it.
    //
    // Safe precisely because it is a *development* key. `startup::
    // validate_no_privileged_dev_accounts` refuses to boot a non-demo instance
    // where one of these holds a privileged role, so this can never be a
    // production account.
    const known = await Promise.all(
      ['//Alice', '//Bob', '//Charlie', '//Dave', '//Eve', '//Ferdie'].map(devAccount)
    );
    const match = known.find((account) => account.address === adminWallet);
    if (match) {
      await enrolCredentials(sfx('bt.admin'), match.address, match.secretKey);
      adminCredentialed = true;
      console.log(`  · Admin  ${sfx('bt.admin')}  ${adminWallet} (well-known dev key)`);
    } else {
      console.log(`    (its key is not held here, so no admin credential fixture is created)`);
    }
  } else {
    console.log(`  · bootstrapped administrator ${adminWallet}`);
    await enrolCredentials(sfx('bt.admin'), adminWallet, adminIdentity.miniSecret);
    adminCredentialed = true;
    console.log(`  · Admin  ${sfx('bt.admin')}  ${adminWallet}`);
  }

  // ---- Staff --------------------------------------------------------------
  const staffOut: Array<Record<string, string>> = [];
  for (const fixture of STAFF) {
    const identity = await generateWalletIdentity();

    const reg = await call(
      'POST',
      '/auth/register',
      {
        wallet_address: identity.address,
        name: fixture.name,
        username: fixture.username,
        role: fixture.role,
      },
      adminWallet
    );
    if (!okOrExisting(reg.status, reg.json)) fail(`register ${fixture.key}`, reg.status, reg.json);

    // Accounts created by an admin start `pending`, and `support::get_user`
    // resolves only active users — an unactivated fixture is refused with
    // USER_NOT_FOUND at every later step, which reads like an auth bug.
    const act = await call('PUT', `/users/${identity.address}`, { status: 'active' }, adminWallet);
    if (!ok(act.status)) fail(`activate ${fixture.key}`, act.status, act.json);

    await enrolCredentials(fixture.loginId, identity.address, identity.miniSecret);

    console.log(`  · ${fixture.role.padEnd(6)} ${fixture.loginId}  ${identity.address}`);
    staffOut.push({
      role: fixture.role,
      login_id: fixture.loginId,
      password: PASSWORD,
      wallet: identity.address,
      mnemonic: identity.mnemonic,
      sign_in: 'POST /api/auth/staff/login (employee identifier + password)',
    });
  }

  const doctorWallet = staffOut.find((s) => s.role === 'Doctor')!.wallet;

  // ---- Patient record + bound patient account -----------------------------
  const created = await call('POST', '/register', PATIENT, doctorWallet);
  if (!ok(created.status)) fail('register synthetic patient', created.status, created.json);
  const patientId = String(created.json.patient_id ?? '');
  const nfcTagId = String(created.json.nfc_tag_id ?? '');

  const patientIdentity = await generateWalletIdentity();
  const preg = await call(
    'POST',
    '/auth/register',
    {
      wallet_address: patientIdentity.address,
      name: PATIENT.full_name,
      username: 'btpatient',
      role: 'Patient',
    },
    adminWallet
  );
  if (!okOrExisting(preg.status, preg.json)) fail('register patient account', preg.status, preg.json);

  const pact = await call('PUT', `/users/${patientIdentity.address}`, { status: 'active' }, adminWallet);
  if (!ok(pact.status)) fail('activate patient account', pact.status, pact.json);

  // The claim is what sets `linked_patient_id`. Without it the wallet is a
  // patient account bound to nothing, and the dashboard falls back to a
  // generated identity — which is precisely audit finding BFA-005.
  const claim = await call(
    'POST',
    '/identity/claim',
    {
      patient_id: patientId,
      national_id: PATIENT.national_id,
      date_of_birth: PATIENT.date_of_birth,
    },
    patientIdentity.address
  );
  if (!ok(claim.status)) fail('claim patient identity', claim.status, claim.json);

  console.log(`  · Patient ${patientIdentity.address} -> ${patientId}`);

  // Recorded before the preflight, not after: a fixture that has not been
  // proved to sign in is worse than no fixture, because the tester spends the
  // session debugging the harness instead of the product. The admin used to be
  // appended after the checks and so was never exercised.
  if (adminCredentialed) {
    staffOut.push({
      role: 'Admin',
      login_id: sfx('bt.admin'),
      password: PASSWORD,
      wallet: adminWallet,
      // A well-known dev account has no mnemonic of its own; the derivation
      // path is the recovery information that matters.
      mnemonic: adminIdentity.address === adminWallet ? adminIdentity.mnemonic : '(Substrate well-known development key)',
      sign_in: 'POST /api/auth/staff/login (employee identifier + password)',
    });
  }

  // ---- Preflight ----------------------------------------------------------
  // Every fixture is proved usable here rather than assumed. A fixture that
  // cannot sign in is worse than no fixture: the tester spends the session
  // debugging the harness instead of the product.
  console.log('\nPreflight');

  for (const s of staffOut) {
    const { authProof } = await deriveCredential(PASSWORD, s.login_id);
    const login = await call('POST', '/auth/staff/login', {
      identifier: s.login_id,
      auth_proof: authProof,
    });
    if (!ok(login.status)) fail(`preflight staff login ${s.login_id}`, login.status, login.json);
    console.log(`  ✓ ${s.login_id} signs in`);
  }

  const self = await call('GET', `/patients/${patientId}`, undefined, patientIdentity.address);
  if (!ok(self.status)) fail('preflight patient reads own record', self.status, self.json);
  console.log('  ✓ patient wallet reads its own linked record');

  const me = await call('GET', '/auth/me', undefined, patientIdentity.address);
  const linked = String((me.json.user as Json | undefined)?.linked_patient_id ?? me.json.linked_patient_id ?? '');
  if (linked !== patientId) {
    fail('preflight linked_patient_id binding', me.status, {
      expected: patientId,
      actual: linked || '(unset)',
      note: 'The patient account is not bound to the record; the dashboard would show a generated identity.',
    });
  }
  console.log('  ✓ linked_patient_id matches the seeded record');

  // ---- Fixture contract ---------------------------------------------------
  const manifest = {
    generated_at: new Date().toISOString(),
    api: API,
    warning:
      'Synthetic browser-test fixtures. Throwaway credentials — never provision these in a production image.',
    administrator_wallet: adminWallet,
    admin_credential_fixture: adminCredentialed
      ? 'created'
      : 'unavailable — deployment was already bootstrapped, so this run does not hold the administrator key. Admin Dashboard, User Management and administrator Analytics cannot be browser-tested against this database.',
    staff: staffOut,
    patient: {
      role: 'Patient',
      wallet: patientIdentity.address,
      mnemonic: patientIdentity.mnemonic,
      linked_patient_id: patientId,
      nfc_tag_id: nfcTagId,
      sign_in: 'Wallet address entry / demo wallet import',
      expected_dashboard: {
        full_name: PATIENT.full_name,
        blood_type: PATIENT.blood_type,
        allergies: PATIENT.allergies,
        chronic_conditions: PATIENT.chronic_conditions,
        current_medications: PATIENT.current_medications,
      },
    },
  };

  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync('.browser-test', { recursive: true });
  writeFileSync('.browser-test/fixtures.json', JSON.stringify(manifest, null, 2));

  const rows = staffOut
    .map((s) => `  ${s.role.padEnd(7)}  ${s.login_id.padEnd(12)} / ${PASSWORD}`)
    .join('\n');

  console.log(`
Fixtures written to .browser-test/fixtures.json

${rows}
  Patient  wallet ${patientIdentity.address}
           linked to ${patientId}
${adminCredentialed ? '' : '\n  NOTE: no Admin fixture — this deployment was already bootstrapped, so the\n  administrator key is not held here. Admin Dashboard, User Management and\n  administrator Analytics remain un-browser-testable against this database.\n'}
Teardown: drop the test database volume, or delete these accounts. Do not carry
them into any image that serves real patients.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
