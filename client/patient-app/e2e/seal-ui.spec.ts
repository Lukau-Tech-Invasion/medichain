import { test, expect } from '@playwright/test';
import {
  api,
  apiContext,
  fixtureStaff,
  fixtureToken,
  readFixtures,
  retiredTermsIn,
} from '../../doctor-portal/e2e/identity';
import { readablePageText, settle, signInAsFixturePatient } from './support';

/**
 * What a patient can see and check about the audit trail of their own record.
 *
 * "Who viewed my records" lists every time someone else opened the patient's
 * information: who, where, when, why. Each entry carries where it stands in the
 * sealed audit stream -- "Sealing pending", "Sealed", "Sealed and exported" -- and
 * the page explains sealing in words that do not mention a chain, a block or a
 * transaction. The patient can also ask the server to verify their emergency card
 * against its sealed commitment and to check the signature on the batches that
 * cover their history (`GET /api/patients/{id}/verify`).
 *
 * # What is and is not on a screen
 *
 * The verification answer (match, mismatch, unsealed, none, and the signature
 * line: valid, unsigned, invalid) is rendered by `CapsuleVerify`, which no page
 * mounts yet. The UI test below therefore looks for the "Verify" control and, if
 * it is absent, records that as a gap rather than passing silently; the API
 * assertions that follow it always run, and they are the contract the control
 * will render.
 *
 * Desktop project only: the checks are about content, not layout.
 */

test.skip(({ isMobile }) => isMobile, 'content checks; the viewport does not change them');

const SEAL_STATES = ['pending', 'sealed', 'exported'];
const CAPSULE_STATES = ['match', 'mismatch', 'unsealed', 'none'];
const SIGNATURES = ['valid', 'unsigned', 'invalid'];
/** The words the seal UI must never use: chain, block, transaction, anchor, finalised. */
const NOT_SEAL_WORDS = /\banchor(ed|ing|s)?\b|finali[sz]ed|transaction hash|block number|on-chain|blockchain/i;

test('the access history shows who opened the record, with a seal badge and no chain words', async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(240_000);
  const fixtures = readFixtures();
  const patientId = fixtures.patient.linked_patient_id;

  // Someone other than the patient opens the record, so there is something to show.
  // The doctor declares a reason, as the doctor portal's chart gate makes them.
  const request = await apiContext(playwright, testInfo);
  try {
    const doctorToken = await fixtureToken(request, fixtureStaff('Doctor'));
    const context = await api(request, 'POST', `/api/patients/${patientId}/access-context`, {
      token: doctorToken,
      data: { reason: 'treatment' },
    });
    if (context.status === 200 || context.status === 201) {
      await api(request, 'GET', `/api/patients/${patientId}`, {
        token: doctorToken,
        headers: {
          'X-Access-Reason': 'treatment',
          'X-Access-Context': String(context.body?.access_context_id ?? ''),
        },
      });
    }
  } finally {
    await request.dispose();
  }

  await signInAsFixturePatient(page);
  await settle(page, '/access-history');
  await expect(page.getByRole('heading', { name: /who viewed my records/i })).toBeVisible();

  const list = page.getByTestId('access-history-list');
  const hasEntries = await list.isVisible({ timeout: 20000 }).catch(() => false);
  test.skip(
    !hasEntries,
    'no one but the patient has opened the fixture record, so there is no entry to carry a badge'
  );

  const sessions = page.getByTestId('access-session');
  await expect(sessions.first()).toBeVisible();

  // Each entry says who, and why, in the patient's words; a badge says where it stands.
  const badges = page.getByTestId('seal-badge');
  await expect(badges.first(), 'no access-history entry carries a seal badge').toBeVisible();
  const states = await badges.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-seal-status') ?? '')
  );
  // `partial` is a session whose rows are not all sealed yet.
  for (const state of states) expect([...SEAL_STATES, 'partial']).toContain(state);
  await expect(badges.first()).toContainText(/sealing pending|sealed|sealed and exported|partly sealed/i);

  // Sealing is explained, and explained without the chain.
  await expect(page.getByText(/signed fingerprint of each entry/i)).toBeVisible();
  const text = await readablePageText(page);
  expect(text, 'the access history uses chain vocabulary').not.toMatch(NOT_SEAL_WORDS);
  expect(retiredTermsIn(text)).toEqual([]);
});

test('the emergency card can be verified against its seal, and the answer is honest', async ({
  page,
  playwright,
}, testInfo) => {
  test.setTimeout(240_000);
  const fixtures = readFixtures();
  const patientId = fixtures.patient.linked_patient_id;

  // The contract first, over the API, as the patient.
  const request = await apiContext(playwright, testInfo);
  let verification: Record<string, unknown> = {};
  try {
    const token = await fixtureToken(request, {
      login_id: fixtures.patient.login_id,
      password: fixtures.patient.password ?? '',
    });
    const answer = await api(request, 'GET', `/api/patients/${patientId}/verify`, { token });
    expect(answer.status).toBe(200);
    verification = (answer.body?.data ?? answer.body) as Record<string, unknown>;
  } finally {
    await request.dispose();
  }

  // The capsule answer is one of four, and 'unanchored' -- the chain's word -- is gone.
  expect(CAPSULE_STATES, `emergency_capsule was "${String(verification.emergency_capsule)}"`).toContain(
    verification.emergency_capsule as string
  );
  expect(verification.emergency_capsule).not.toBe('mismatch');

  // A signing key, or an explicit null when batches are sealed without one.
  const key = verification.seal_key as { key_id: string; algorithm: string; public_key: string } | null;
  if (key !== null) {
    expect(key.algorithm).toBe('ed25519');
    expect(key.key_id).toBeTruthy();
    expect(key.public_key).toMatch(/^[0-9a-f]{64}$/i);
  }

  const rows = (verification.access_logs ?? []) as Array<Record<string, unknown>>;
  for (const row of rows) {
    // null: the row is not in a batch yet.
    if (row.seal_status !== null) expect(SEAL_STATES).toContain(row.seal_status);
    if (row.signature !== null) expect(SIGNATURES).toContain(row.signature);
    // A sealed row names its batch and says how the batch was signed; a missing
    // key is `unsigned`, never `valid`.
    if (row.seal_status === 'sealed' || row.seal_status === 'exported') {
      expect(row.batch_hash, 'a sealed row without a batch hash').toBeTruthy();
      expect(row.signature, 'a sealed row without a signature verdict').not.toBeNull();
    }
    if (key === null && row.signature !== null) {
      expect(row.signature, 'batches sealed without a key must not read as validly signed').not.toBe('valid');
    }
    expect(row.signature, 'a sealed batch failed its signature check').not.toBe('invalid');
    for (const retired of ['tx_hash', 'block_number', 'anchor_status', 'blockchain_tx_hash']) {
      expect(row, `a verification row carries ${retired}`).not.toHaveProperty(retired);
    }
  }

  // The screen. Where the control exists, it renders the same answer.
  await signInAsFixturePatient(page);
  await settle(page, '/emergency-card');
  const verify = page.getByRole('button', { name: /^verify$/i });
  if ((await verify.count()) === 0) {
    test.info().annotations.push({
      type: 'gap',
      description:
        'No page mounts CapsuleVerify: the emergency card offers no Verify control, so the match/unsealed answer and the signature line have no screen yet.',
    });
    return;
  }
  await verify.click();
  const answerText = page.getByText(
    /matches its sealed record|has not been sealed yet|no emergency card to verify|does not match its sealed record/i
  );
  await expect(answerText.first()).toBeVisible({ timeout: 30000 });
  if (rows.some((row) => row.seal_status === 'sealed' || row.seal_status === 'exported')) {
    await expect(page.getByTestId('signature-result')).toBeVisible();
  }
  expect(await readablePageText(page)).not.toMatch(NOT_SEAL_WORDS);
});
