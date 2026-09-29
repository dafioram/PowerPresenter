import { defineConfig, devices } from '@playwright/test';

// Headless by default. Run `npm run test:e2e:headed` to watch the tests in a
// real browser window (needs a display; on Linux CI use `xvfb-run -a`).
// Set PW_BROWSERS=chromium,firefox,webkit to choose engines
// (install them first with `npx playwright install firefox webkit`).
const browsers = (process.env.PW_BROWSERS || 'chromium').split(',').map((s) => s.trim());
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npm run preview',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ].filter((p) => browsers.includes(p.name)),
});
