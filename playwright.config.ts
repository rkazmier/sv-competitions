import { execSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// Testy E2E na zbudowanej stronie (`web/`, astro preview). Wymaga `npm ci` w web/.
// `--ignore-lock`: preview zawsze na pierwszym planie (Astro sam przechodzi w tło, gdy wykryje agenta AI).
const PORT = 4321;

/**
 * Testy panelu potrzebują lokalnego Supabase (`supabase start`). Gdy zmienne nie są ustawione,
 * bierzemy je z `supabase status` — klucze lokalnej instancji CLI, nigdy staging/produkcja.
 * Build (webServer) i testy dziedziczą `process.env`.
 */
function useLocalSupabase(): void {
  if (process.env.PUBLIC_SUPABASE_URL) return;
  let output: string;
  try {
    output = execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return; // brak lokalnego Supabase — testy panelu zostaną pominięte (poza CI)
  }
  const vars = Object.fromEntries([...output.matchAll(/^(\w+)="?([^"\n]*)"?$/gm)].map((m) => [m[1], m[2]]));
  if (!vars.API_URL || !vars.PUBLISHABLE_KEY || !vars.SECRET_KEY) return;
  process.env.PUBLIC_SUPABASE_URL = vars.API_URL;
  process.env.PUBLIC_SUPABASE_ANON_KEY = vars.PUBLISHABLE_KEY;
  process.env.SUPABASE_SECRET_KEY = vars.SECRET_KEY;
  // Skrzynka lokalnego Supabase (e-maile Auth — SPEC-002 AC-1, AC-6)
  if (vars.MAILPIT_URL) process.env.MAILPIT_URL = vars.MAILPIT_URL;
}

useLocalSupabase();

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /(range-duty(-schedule)?|duty-officer-range-log)\.spec\.ts$/ },
    // SPEC-007 US-4: dyżurny Prowadzący jest jeden dla całej bazy — testy, które go zmieniają, po pozostałych
    // (testy wpisów używają wspólnego dyżurnego `ensureRangeDuty()`).
    {
      name: 'range-duty',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /range-duty\.spec\.ts$/,
      dependencies: ['chromium'],
    },
    // SPEC-007 US-6: grafik dyżurów zmienia dyżurnego dziś i w kolejnych dniach — po testach dyżurnego.
    {
      name: 'range-duty-schedule',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /range-duty-schedule\.spec\.ts$/,
      dependencies: ['range-duty'],
    },
    // SPEC-008: dyżurny Prowadzący z konta w książce — zmienia dyżurnego dziś, po grafiku.
    {
      name: 'duty-officer-range-log',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /duty-officer-range-log\.spec\.ts$/,
      dependencies: ['range-duty-schedule'],
    },
  ],
  webServer: {
    command: `npm --prefix web run build && npm --prefix web run preview -- --host 127.0.0.1 --port ${PORT} --ignore-lock`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
