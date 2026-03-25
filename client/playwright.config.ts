import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'doctor-portal',
      use: { 
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'patient-app',
      use: { 
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5174',
      },
    },
  ],
  // We can start both servers if needed, but it might be heavy.
  // Alternatively, assume they are running or start them separately.
  /*
  webServer: [
    {
      command: 'npm run dev --workspace=doctor-portal',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev --workspace=patient-app',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
    },
  ],
  */
});
