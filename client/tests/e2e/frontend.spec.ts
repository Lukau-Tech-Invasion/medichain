import { test, expect } from '@playwright/test';

/**
 * Comprehensive Frontend E2E Tests
 * Covers both Doctor Portal and Patient App
 */

test.describe('MediChain Whole Frontend', () => {
  
  test.describe('Doctor Portal', () => {
    test.use({ baseURL: 'http://localhost:5173' });

    test('should login as a doctor and see dashboard', async ({ page }) => {
      await page.goto('/login');
      
      // Check if we are on the Doctor Portal
      await expect(page.locator('h1')).toContainText('MediChain');
      await expect(page.locator('p')).toContainText('Doctor Portal');

      // Login as Dr. Mbeki using demo button
      const drMbekiButton = page.locator('button:has-text("Mbeki")');
      await expect(drMbekiButton).toBeVisible();
      await drMbekiButton.click();

      // Verify redirection to dashboard
      await expect(page).toHaveURL(/.*dashboard/);
      await expect(page.locator('h1')).toContainText(/Welcome back/i);
      await expect(page.locator('h1')).toContainText(/Mbeki/i);
      
      // Verify some dashboard elements
      await expect(page.locator('text=Recent Emergency Access')).toBeVisible();
    });
  });

  test.describe('Patient App', () => {
    test.use({ baseURL: 'http://localhost:5174' });

    test('should login as a patient and see dashboard', async ({ page }) => {
      await page.goto('/login');
      
      // Check if we are on the Patient App
      await expect(page.locator('h1')).toContainText('MediChain');
      // Patient app doesn't explicitly say "Patient App" in H1 but has different styling/icons
      await expect(page.locator('text=Patient Login')).toBeVisible();

      // Login as Thabo Mokoena using demo button
      const thaboButton = page.locator('button:has-text("Thabo")');
      await expect(thaboButton).toBeVisible();
      await thaboButton.click();

      // Verify redirection to dashboard
      await expect(page).toHaveURL(/.*dashboard/);
      await expect(page.locator('h2')).toContainText(/Thabo Mokoena/i);
      
      // Verify some dashboard elements
      await expect(page.locator('text=My Health Status')).toBeVisible();
      await expect(page.locator('text=Quick Actions')).toBeVisible();
    });
  });

  test.describe('Cross-Portal Integration (Conceptual)', () => {
    test('should demonstrate both portals are accessible', async ({ browser }) => {
      const doctorContext = await browser.newContext({ baseURL: 'http://localhost:5173' });
      const patientContext = await browser.newContext({ baseURL: 'http://localhost:5174' });

      const doctorPage = await doctorContext.newPage();
      const patientPage = await patientContext.newPage();

      await doctorPage.goto('/login');
      await patientPage.goto('/login');

      await expect(doctorPage.locator('text=Doctor Portal')).toBeVisible();
      await expect(patientPage.locator('text=Patient Login')).toBeVisible();

      await doctorContext.close();
      await patientContext.close();
    });
  });
});
