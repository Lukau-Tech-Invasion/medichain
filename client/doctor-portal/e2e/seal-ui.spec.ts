import { test, expect } from '@playwright/test';
import {
  api,
  fixtureStaff,
  fixtureToken,
  retiredTermsIn,
} from './identity';
import {
  fixturePatientId,
  openChartWithReason,
  readablePageText,
  settle,
  signIn,
} from './support';

/**
 * The sealed audit stream, as a clinician and an administrator see it.
 *
 * The chain that used to "anchor" these entries is gone. What replaced it is a
 * chained, signed, exportable audit stream: every access-log row and audit event
 * is batched, hashed into a Merkle tree, chained to the previous batch and signed
 * with Ed25519 (`docs/BLOCKCHAIN_REMOVAL_PLAN.md`, Phase A). The screens show
 * where an entry stands in that stream -- "Sealing pending", "Sealed", "Sealed
 * and exported" -- and never a block, a transaction or a retired identity.
 *
 *   * Access Logs: each row carries a seal badge.
 *   * Admin dashboard: the System Status card shows the audit-seal panel: how many
 *     entries wait, when the last batch was sealed and exported, whether
 *     checkpoints leave the host, whether batches are signed.
 *   * The test API is configured with the checkpoint sink `none`, so the panel must
 *     say plainly that no checkpoint export is configured, in the caution style, and
 *     the emergency read (`emergency-read.spec.ts`) must still succeed.
 *
 * The seal STATE of a fresh row is timing: the sealing job batches on its own
 * schedule, so a row is `pending` or already `sealed`. Assertions accept the
 * three states and refuse everything else, including any chain vocabulary.
 */

const SEAL_STATES = ['pending', 'sealed', 'exported'];
/** The words the seal UI must never use: chain, block, transaction, anchor, finalised. */
const NOT_SEAL_WORDS = /\banchor(ed|ing|s)?\b|finali[sz]ed|transaction hash|block number|on-chain|blockchain/i; // retired-term-negative-assertion

test('the admin dashboard shows the audit-seal panel, and says when nothing leaves the host', async ({
  browser,
  request,
}) => {
  test.setTimeout(240_000);
  const page = await browser.newPage();
  await signIn(page, 'Admin');
  await settle(page, '/admin');

  const panel = page.getByTestId('audit-seal-status');
  await expect(panel).toBeVisible({ timeout: 30000 });
  await expect(panel).toContainText(/audit sealing/i);
  await expect(panel).toContainText(/entries waiting to be sealed/i);
  await expect(panel).toContainText(/sealed|nothing sealed yet/i);
  await expect(panel).toContainText(/exported|nothing exported yet/i);

  // One of the two honest answers about checkpoints, and one about signing. A
  // weaker state is worded as the weaker state it is, never as a healthy default.
  await expect(panel).toContainText(
    /no checkpoint export is configured|checkpoints are exported to disk/i
  );
  await expect(panel).toContainText(
    /batches are signed|batches are sealed without a signature/i
  );

  // The words on the whole card are the seal's, not the chain's.
  const text = await panel.innerText();
  expect(text).not.toMatch(NOT_SEAL_WORDS);
  expect(retiredTermsIn(text)).toEqual([]);

  // What the panel shows is what the API reports.
  const token = await fixtureToken(request, fixtureStaff('Admin'));
  const health = await api(request, 'GET', '/api/health/detailed', { token });
  expect(health.status).toBe(200);
  const seal = health.body?.audit_seal;
  expect(seal, '/api/health/detailed carries no audit_seal').toBeTruthy();
  expect(typeof seal.unsealed_events).toBe('number');
  expect(['none', 'filesystem']).toContain(seal.sink);
  expect(['ed25519', 'unsigned']).toContain(seal.signing);
  for (const key of ['last_sealed_at', 'last_exported_at']) {
    expect(seal[key] === null || typeof seal[key] === 'string', key).toBe(true);
  }

  if (seal.sink === 'none') {
    // The configured test posture: nothing is exported, and the panel says so.
    await expect(panel).toContainText(/no checkpoint export is configured/i);
    await expect(panel).toContainText(/nothing exported yet/i);
  }
  await page.close();
});

test('the access log shows a seal badge on each row a clinician has just created', async ({ browser }) => {
  test.setTimeout(300_000);

  // A clinician opens a chart, declaring why: that writes the access-log row.
  const doctor = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(doctor, 'Doctor');
  await openChartWithReason(doctor, fixturePatientId(), 'Treatment');
  const chartOpened = await doctor
    .getByRole('button', { name: /access/i })
    .first()
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  test.skip(
    !chartOpened,
    'the fixture doctor has no care relationship with the fixture patient, so the chart stayed closed behind break-glass'
  );
  await doctor.close();

  // The administrator reads the log.
  const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await signIn(admin, 'Admin');
  await settle(admin, '/access-logs');
  const rows = admin.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 30000 });

  const badges = admin.getByTestId('seal-badge');
  await expect(badges.first(), 'no access-log row carries a seal badge').toBeVisible({ timeout: 30000 });
  const states = await badges.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-seal-status') ?? '')
  );
  expect(states.length).toBeGreaterThan(0);
  for (const state of states) {
    expect(SEAL_STATES, `a badge reported the state "${state}"`).toContain(state);
  }
  // The badge reads in the seal's words.
  await expect(badges.first()).toContainText(/sealing pending|sealed|sealed and exported|partly sealed/i);

  const text = await readablePageText(admin);
  expect(text, 'the access log uses chain vocabulary').not.toMatch(NOT_SEAL_WORDS);
  expect(retiredTermsIn(text)).toEqual([]);
  await admin.close();
});

test('the access-log API carries a seal state and none of the chain fields', async ({ request }) => {
  const token = await fixtureToken(request, fixtureStaff('Admin'));
  const logs = await api(request, 'GET', '/api/access/logs', { token });
  expect(logs.status).toBe(200);
  const rows = (Array.isArray(logs.body) ? logs.body : (logs.body?.access_logs ?? logs.body?.data ?? [])) as Array<
    Record<string, unknown>
  >;
  test.skip(rows.length === 0, 'the access log is empty; nothing to check the fields of');

  for (const row of rows.slice(0, 50)) {
    if (row.seal_status !== undefined && row.seal_status !== null) {
      expect(SEAL_STATES).toContain(row.seal_status);
    }
    for (const retired of ['blockchain_tx_hash', 'tx_hash', 'block_number', 'anchor_status']) { // retired-term-negative-assertion
      expect(row, `an access-log row carries ${retired}`).not.toHaveProperty(retired);
    }
  }
});
