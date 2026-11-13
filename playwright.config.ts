import { defineConfig, devices } from '@playwright/test';

// Testy E2E na zbudowanej stronie (`web/`, astro preview). Wymaga `npm ci` w web/.
// `--ignore-lock`: preview zawsze na pierwszym planie (Astro sam przechodzi w tło, gdy wykryje agenta AI).
const PORT = 4321;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm --prefix web run build && npm --prefix web run preview -- --host 127.0.0.1 --port ${PORT} --ignore-lock`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
