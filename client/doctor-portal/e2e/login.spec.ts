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

    // Check for welcome message
    await expect(page.locator('h1')).toContainText(/Welcome back/);
    await expect(page.locator('h1')).toContainText(/Mbeki/i);
  });

  test('should show error for invalid wallet', async ({ page }) => {
    await page.goto('/login');

    // Enter an invalid wallet address
    const walletInput = page.locator('input#walletAddress');
    await walletInput.fill('invalid-wallet-address');

    // Click Connect Wallet
    await page.click('button:has-text("Connect Wallet")');

    // Check for error message. The selector follows the semantic token, not a
    // raw palette shade: `bg-red-50` was migrated to `bg-critical-subtle` so the
    // alert carries a dark tint in dark mode instead of a glaring pale patch.
    // Asserting on a palette class would have quietly stopped matching.
    const errorAlert = page.locator('.bg-critical-subtle');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/Invalid wallet/i);
  });
});
