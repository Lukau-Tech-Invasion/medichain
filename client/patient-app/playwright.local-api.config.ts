import { defineConfig, devices } from '@playwright/test';

/**
 * Run the patient-app suites against a locally built API instead of the Docker
 * stack — the mirror of `client/doctor-portal/playwright.local-api.config.ts`.
 *
 * The default config sets `reuseExistingServer` and points the dev-server proxy
 * at Nginx on `:80`, so a run adopts whatever dev server is already listening on
 * 5174, proxying to whatever API that server was started against — in practice a
 * days-old Docker image. A change that has only been built locally cannot be
 * tested at all that way.
 *
 * That matters more here than in the clinician portal, and the default config's
 * own comment says why: the screens these suites audit fall back to demo data
 * when the API is unreachable, so a run against no server at all is still green.
 *
 * This config binds its own port and its own proxy target and refuses to adopt a
 * stray server. Point `VITE_API_PROXY_TARGET` at wherever the API under test is
 * listening — `scripts/run-browser-e2e-api.sh` puts it on 8090.
 *
 *   npx playwright test --config playwright.local-api.config.ts
 */
const PORT = Number(process.env.E2E_PORT || 5299);
const API = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8090';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Serial, as in the clinician portal: every request comes from 127.0.0.1, so
  // the whole run shares one rate-limit bucket and parallel workers turn a
  // healthy run into navigation timeouts that read as application faults.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    // A phone first, because that is where this app is used; the desktop
    // project exists so the same screens are audited at both widths.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
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
