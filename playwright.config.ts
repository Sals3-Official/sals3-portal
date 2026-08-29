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
  /**
   * Wider than Playwright's 5s default, because `webServer` below is a DEV
   * server and a route's first request compiles it.
   *
   * Evidence, 2026-08-29: three specs failed inside `npm run verify` — which
   * runs lint, typecheck, build and 3,200 unit tests immediately before this —
   * and the catalog-shortlist redirect reported
   * `Received string: ".../products/shortlisted"` with `Timeout: 5000ms`. The
   * page was still on the ORIGINAL url: the server had not answered yet. The
   * same specs passed on five later runs against a warm `.next`, which is why
   * they read as flaky rather than broken.
   *
   * This is not a speed assertion. Nothing here measures how fast a route
   * compiles, and a genuinely wrong url still fails — ten seconds later.
   *
   * CI is unaffected in practice (`workers: 1`, `retries: 2`), which is why it
   * has stayed green while local runs flaked.
   */
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    /*
      The same reasoning for navigations. `page.goto` on a cold route waits for
      the dev server to compile it, and the default here is also too tight for
      the first hit after a build.
    */
    navigationTimeout: 30_000,
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
