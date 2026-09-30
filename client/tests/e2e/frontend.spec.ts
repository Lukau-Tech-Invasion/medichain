import { test, expect } from '@playwright/test';
import { patientFixture, staffFixture } from './support';

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

      // Sign in as the seeded doctor fixture with Employee ID and password.
      const doctor = staffFixture('Doctor');
      await page.locator('input#identifier').fill(doctor.login_id);
      await page.locator('input#password').fill(doctor.password);
      await page.locator('button[type="submit"]').click();

      // Verify redirection to dashboard
      await expect(page).toHaveURL(/.*dashboard/, { timeout: 30000 });
      await expect(page.locator('h1')).toContainText(/Welcome back/i);
      
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

      // Sign in as the seeded fixture patient with username and password.
      const patient = patientFixture();
      await page.locator('input#username').fill(patient.login_id);
      await page.locator('input#password').fill(patient.password);
      await page.locator('button[type="submit"]').click();

      // Verify redirection to dashboard
      await expect(page).toHaveURL(/.*dashboard/, { timeout: 30000 });
      
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
