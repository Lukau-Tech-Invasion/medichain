import { portalPath } from '../../doctor-portal/e2e/portal-path';
import { test, expect, type Response } from '@playwright/test';
import { retiredTermsIn } from '../../doctor-portal/e2e/identity';
import { readablePageText, requestPacer, signInAsFixturePatient } from './support';

/**
 * No screen in the patient app mentions a chain or a wallet, and no API answer it
 * triggers carries one of their fields.
 *
 * This is every `<Route>` in `App.tsx` (the same list `colour-sweep.spec.ts`
 * measures, plus `/access-history`, which that list omits). The words are read
 * from the visible text and from attributes (placeholder, aria-label, title, alt);
 * the wire is every JSON answer the screens' own requests receive.
 *
 * Desktop project only: the words do not change with the viewport, and the sweep
 * spends the request budget.
 */

test.skip(({ isMobile }) => isMobile, 'the words do not change with the viewport');

const ROUTES = [
  '/dashboard', '/profile', '/records', '/consent', '/access-history', '/emergency-card',
  '/medications', '/appointments', '/messages', '/symptoms', '/medical-id', '/settings',
  '/reminders', '/family', '/telehealth', '/wearables', '/lab-trends', '/insurance', '/survey',
  '/symptom-checker', '/language', '/offline-sync', '/vitals', '/lab-results', '/notifications',
  '/medical-history',
];

/** Response fields that belonged to the chain or the wallet. */
const RETIRED_FIELDS =
  /"(wallet_address|walletAddress|blockchain_tx_hash|blockchain_address|tx_hash|block_number|block_hash|anchor_status|anchor_seq|chain_tx_hash|chain_finalized|chain_audit_status|on_chain_hash|encrypted_keystore|recovery_phrase)"\s*:/;

test('every patient screen is free of chain and wallet words and fields', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const pace = requestPacer(page);

  let current = '(sign-in)';
  const seen = new Set<string>();
  page.on('response', async (response: Response) => {
    try {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/')) return;
      // Never the event stream: it does not end, so reading it never resolves.
      if (!(response.headers()['content-type'] ?? '').includes('application/json')) return;
      const match = RETIRED_FIELDS.exec(await response.text());
      if (match) seen.add(`${current} ${response.request().method()} ${url.pathname} carries "${match[1]}"`);
    } catch {
      // A body that is gone (navigation, redirect) has nothing to check.
    }
  });

  await signInAsFixturePatient(page);

  const wording: string[] = [];
  const unreached: string[] = [];
  for (const path of ROUTES) {
    await pace();
    current = path;
    await page.goto(portalPath(path));
    const reached = await page
      .locator('main')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => new URL(page.url()).pathname.endsWith(path))
      .catch(() => false);
    if (!reached) {
      unreached.push(`${path}: landed on ${new URL(page.url()).pathname}`);
      continue;
    }
    // Late-arriving data paints into the page; a list that fills in after the
    // read is a list the sweep never checked.
    await page.waitForTimeout(1500);
    const terms = retiredTermsIn(await readablePageText(page));
    if (terms.length) wording.push(`${path}: ${terms.join(', ')}`);
  }

  expect.soft(unreached, 'the patient was offered screens it could not open').toEqual([]);
  expect.soft(wording, 'screens that still use chain or wallet words').toEqual([]);
  expect.soft([...seen], 'API answers that still carry chain or wallet fields').toEqual([]);
});
