import { defineConfig, devices } from '@playwright/test';

const playwrightPort = process.env.PLAYWRIGHT_PORT || '5174';
const playwrightBaseUrl = `http://localhost:${playwrightPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: playwrightBaseUrl,
    trace: 'on-first-retry',
  },
  projects: [
    // The patient app is used far more on a phone than at a desk, so the
    // default project is a mobile viewport. The doctor portal's config is
    // desktop-only for the mirror-image reason.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run dev -- --port ${playwrightPort}`,
    url: playwrightBaseUrl,
    // A reused server can carry an arbitrary proxy target from a previous
    // session. Refuse it so this suite's Docker target is deterministic.
    reuseExistingServer: false,
    env: {
      // Keep the HMR WebSocket and HTTP listener together on the selected
      // isolated port; otherwise Vite's reconnect loop reloads the app.
      VITE_DEV_PORT: playwrightPort,
      // Point the dev server's /api proxy at the Nginx front door, matching the
      // clinician portal's config.
      //
      // The default is 127.0.0.1:8090, where a standalone `cargo run` API binds.
      // Against the Docker stack the API is not published on the host at all —
      // it listens on 8080 inside its network and Nginx on :80 is the only way
      // in — so every request died as ECONNREFUSED. These suites still passed,
      // because the screens they audit fall back to demo data when the API is
      // unreachable. That is the worse failure: a green run that never spoke to
      // a server.
      VITE_API_PROXY_TARGET: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1',
    },
  },
});
