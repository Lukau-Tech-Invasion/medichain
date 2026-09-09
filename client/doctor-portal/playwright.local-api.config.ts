import { defineConfig, devices } from '@playwright/test';

/**
 * Run the browser suites against a locally built API instead of the Docker stack.
 *
 * The default config points the dev-server proxy at Nginx on `:80` and sets
 * `reuseExistingServer`, so a dev server already listening on 5173 is adopted
 * whatever it is proxying to. That is how these suites came to exercise a
 * days-old API image without anyone noticing: the run is green, and green means
 * "the image from last week still works".
 *
 * This config binds its own port and its own proxy target, so a change that has
 * only been built locally can actually be tested. Point `VITE_API_PROXY_TARGET`
 * at wherever the API under test is listening.
 *
 *   npx playwright test --config playwright.local-api.config.ts
 */
const PORT = Number(process.env.E2E_PORT || 5199);
const API = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8090';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Serial for the same reason as the default config: every test signs in, and
  // sign-in is several requests against an API that rate-limits at 60/minute.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Deliberately false: adopting a stray dev server is the failure this
    // config exists to avoid.
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_API_PROXY_TARGET: API },
  },
});
