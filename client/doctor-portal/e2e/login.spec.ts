import { portalPath } from './portal-path';
import { test, expect } from '@playwright/test';
import { signIn, skipFirstVisitReload } from './support';

test.describe('Login Flow', () => {
  test('should login successfully with a seeded doctor account', async ({ page }) => {
    // See `skipFirstVisitReload`: index.html reloads itself 100ms into a fresh
    // profile's first visit, which detaches whatever this test is mid-way
    // through doing.
    await signIn(page, 'Doctor', 0);

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*dashboard/);

    // Scoped to the main landmark. A bare `locator('h1')` matched three
    // elements and failed strict mode -- the sidebar brand was marked up as an
    // <h1> and `renderSidebar` runs twice. The brand is a <span> now, but
    // scoping to `main` is the right assertion regardless: this test is about
    // the *page* heading.
    const heading = page.locator('main h1');
    await expect(heading).toContainText(/Welcome back/);
    // The signed-in clinician's name, whoever the seed provides. Asserting a
    // specific person ("Mbeki") tied this test to a fixture that has since been
    // replaced twice; what matters is that the greeting is personalised at all.
    await expect(heading).not.toHaveText(/^Welcome back,?\s*$/);
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await skipFirstVisitReload(page);
    await page.goto(portalPath('/login'));

    // The form takes an employee identifier and a password, the way a clinician
    // signs in; an earlier version of this test filled a field that no longer
    // existed and timed out after 30s against the redesigned screen.
    await page.locator('input#identifier').fill('no.such.person');
    await page.locator('input#password').fill('wrong-password-value');
    await page.click('button[type="submit"]');

    // Check for error message. The selector follows the semantic token, not a
    // raw palette shade: `bg-red-50` was migrated to `bg-critical-subtle` so the
    // alert carries a dark tint in dark mode instead of a glaring pale patch.
    // Asserting on a palette class would have quietly stopped matching.
    const errorAlert = page.locator('.bg-critical-subtle');
    // Longer than the 5s default, because the thing being waited on is an
    // Argon2id verification that is slow *on purpose*. Under the full suite the
    // form was still showing "Signing in..." at 5s and this failed; run alone it
    // finishes in under nine seconds. A password check fast enough to assert in
    // five would be the actual defect.
    await expect(errorAlert).toBeVisible({ timeout: 20_000 });
    // Deliberately NOT asserting which of identifier/password was wrong: the
    // server answers both identically so the form cannot be used to enumerate
    // valid accounts.
    await expect(errorAlert).not.toBeEmpty();
  });
});
