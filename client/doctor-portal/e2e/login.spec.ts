import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test('should login successfully with a demo doctor wallet', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');

    // Click on a demo doctor button (Dr. Thandi Mbeki)
    const demoDoctor = page.locator('button:has-text("Mbeki")');
    await demoDoctor.click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/.*dashboard/);

    // Scoped to the main landmark. A bare `locator('h1')` matched three
    // elements and failed strict mode -- the sidebar brand was marked up as an
    // <h1> and `renderSidebar` runs twice. The brand is a <span> now, but
    // scoping to `main` is the right assertion regardless: this test is about
    // the *page* heading.
    const heading = page.locator('main h1');
    await expect(heading).toContainText(/Welcome back/);
    await expect(heading).toContainText(/Mbeki/i);
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    // The form takes an employee identifier and a password. It used to take a
    // raw wallet address in `input#walletAddress`, and this test kept filling a
    // field that no longer exists -- timing out after 30s against a login
    // screen that had been redesigned around not making a clinician type an
    // SS58 address.
    await page.locator('input#identifier').fill('no.such.person');
    await page.locator('input#password').fill('wrong-password-value');
    await page.click('button[type="submit"]');

    // Check for error message. The selector follows the semantic token, not a
    // raw palette shade: `bg-red-50` was migrated to `bg-critical-subtle` so the
    // alert carries a dark tint in dark mode instead of a glaring pale patch.
    // Asserting on a palette class would have quietly stopped matching.
    const errorAlert = page.locator('.bg-critical-subtle');
    await expect(errorAlert).toBeVisible();
    // Deliberately NOT asserting which of identifier/password was wrong: the
    // server answers both identically so the form cannot be used to enumerate
    // valid accounts.
    await expect(errorAlert).not.toBeEmpty();
  });
});
