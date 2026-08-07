import { defineConfig, devices } from '@playwright/test';

// Keep Playwright on its own port so it never reuses a manually started dev
// server that lacks the explicit auth-test bypass.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3101);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    env: { PORTAL_TEST_AUTH_BYPASS: '1' },
    reuseExistingServer: false,
    timeout: 120000,
    url: baseURL,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
