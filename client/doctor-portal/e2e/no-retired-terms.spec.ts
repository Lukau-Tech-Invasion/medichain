import { portalPath } from './portal-path';
import { test, expect, type Response } from '@playwright/test';
import { fixturePatientId, ROLES, settle, signIn, sidebarRoutes, requestPacer, readablePageText, skipFirstVisitReload, type RoleName } from './support';
import { retiredTermsIn } from './identity';

/**
 * No screen an account can reach mentions a chain or a wallet, and no API answer
 * it triggers carries one of their fields.
 *
 * The chain and the wallet were removed (ADR-0010), and the words and fields
 * that described them are the last thing to leave: a tooltip that still says
 * "anchored on-chain", a heading that still says "Wallet", a response that still
 * carries `tx_hash`. Nothing else finds these, because they render without error.
 *
 * # How the routes are found
 *
 * As `colour-sweep.spec.ts` does it: each role signs in and opens every section
 * of its own sidebar, so the sweep covers exactly the screens that account can
 * reach, and a screen added to the navigation is covered without editing this
 * file. The patient chart is added by hand for the two roles that open one; it
 * is reached from a list, not a link.
 *
 * # Two things are read on every screen
 *
 *   * the words: visible text and the text in attributes (placeholder,
 *     aria-label, title, alt), matched against the retired vocabulary in
 *     `identity.ts` (`RETIRED_TERMS`);
 *   * the wire: every JSON answer the screen's own requests receive, searched for
 *     the field names the chain and the wallet used (`RETIRED_FIELDS` below).
 *
 * Paced, not parallel, under the 60-a-minute budget: run alone.
 */

/** Response fields that belonged to the chain or the wallet. */
const RETIRED_FIELDS =
  /"(wallet_address|walletAddress|blockchain_tx_hash|blockchain_address|tx_hash|block_number|block_hash|anchor_status|anchor_seq|chain_tx_hash|chain_finalized|chain_audit_status|on_chain_hash|encrypted_keystore|recovery_phrase)"\s*:/;

for (const role of ROLES) {
  test(`${role}: no screen it can reach uses chain or wallet words or fields`, async ({ browser }) => {
    test.setTimeout(45 * 60_000);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pace = requestPacer(page);
    await signIn(page, role as RoleName);

    let current = '(sign-in)';
    const seen = new Set<string>();
    page.on('response', async (response: Response) => {
      try {
        const url = new URL(response.url());
        if (!url.pathname.startsWith('/api/')) return;
        if (!(response.headers()['content-type'] ?? '').includes('application/json')) return;
        const match = RETIRED_FIELDS.exec(await response.text());
        if (match) seen.add(`${current} ${response.request().method()} ${url.pathname} carries "${match[1]}"`);
      } catch {
        // Nothing to read.
      }
    });

    const routes = await sidebarRoutes(page);
    if (role === 'Doctor' || role === 'Nurse') routes.push(`/patients/${fixturePatientId()}`);
    expect(routes.length, `${role} sees no navigation at all`).toBeGreaterThan(0);

    const wording: string[] = [];
    const unreached: string[] = [];
    for (const path of routes) {
      await pace();
      current = path;
      try {
        await settle(page, path);
      } catch (error) {
        unreached.push(`${path}: ${String(error).replace(/\s+/g, ' ').slice(0, 160)}`);
        continue;
      }
      const terms = retiredTermsIn(await readablePageText(page));
      if (terms.length) wording.push(`${path}: ${terms.join(', ')}`);
    }
    await page.close();

    expect.soft(unreached, `${role} was offered screens it could not open`).toEqual([]);
    expect.soft(wording, `${role}: screens that still use chain or wallet words`).toEqual([]);
    expect.soft([...seen], `${role}: API answers that still carry chain or wallet fields`).toEqual([]);
  });
}

test('the sign-in and activation pages, before anyone is signed in, use none of them either', async ({ page }) => {
  test.setTimeout(120_000);
  // A fresh context gets the first-visit cache purge, whose reload aborts the navigation.
  await skipFirstVisitReload(page);
  for (const path of ['/login', '/activate']) {
    await page.goto(portalPath(path));
    await page.locator('form').first().waitFor({ state: 'visible', timeout: 20000 });
    expect(retiredTermsIn(await readablePageText(page)), path).toEqual([]);
  }
});
