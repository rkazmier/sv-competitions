import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, signInAs, unique } from './support/supabase';

// SPEC-009: link „Książka” w nagłówku stron publicznych dla dyżurnego Prowadzącego z konta — AC-1…AC-4, AC-7, AC-9…AC-11.
// Logika pamięci i decyzji „pytać czy nie” (AC-3, AC-5, AC-8) — Vitest: web/src/lib/duty-link.test.ts.
// Dyżurny jest jeden dla całej bazy: osobny projekt Playwright po testach SPEC-008 (playwright.config.ts), szeregowo.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'local-e2e-duty-password';
const DUTY_KEY = 'sv-duty-link';
const FORBIDDEN = 'Nie masz uprawnień do panelu.';

async function today(): Promise<string> {
  const { data, error } = await admin().rpc('range_today');
  if (error) throw error;
  return data as string;
}

async function clearDuty(): Promise<void> {
  const { error } = await admin().from('range_duty').delete().eq('day', await today());
  if (error) throw error;
}

async function setDuty(officerId: string): Promise<void> {
  const { error } = await admin()
    .from('range_duty')
    .upsert({ day: await today(), source: 'book', range_officer_id: officerId }, { onConflict: 'day,source' });
  if (error) throw error;
}

/** Konto (rola `user`) z zatwierdzonymi uprawnieniami prowadzącego (SPEC-007). */
async function accountOfficer(name: string): Promise<{ email: string; officerId: string }> {
  const db = admin();
  const email = `${unique('naglowek-dyzurny').replace(/\s/g, '-')}@example.test`;
  const { data: user, error: userError } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  if (userError || !user.user) throw userError ?? new Error('Brak konta');
  await db.from('profiles').update({ full_name: name }).eq('id', user.user.id);
  const { data, error } = await db
    .from('range_officers')
    .insert({ full_name: name, profile_id: user.user.id, license_number: '1', institution: 'PZSS', status: 'approved' })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Brak prowadzącego');
  return { email, officerId: data.id as string };
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Nawigacja główna' });
const rangeLogLink = (page: Page) => nav(page).getByRole('link', { name: 'Książka', exact: true });

/** Liczy zapytania nagłówka / strony do `rpc/is_range_duty_officer`. */
function countDutyRequests(page: Page): () => number {
  let count = 0;
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/rpc/is_range_duty_officer')) count += 1;
  });
  return () => count;
}

test.beforeEach(clearDuty);
test.afterAll(clearDuty);

test('AC-1, AC-7: dyżurny widzi „Książka” przed „Moje konto”; kolejna strona bez zapytania', async ({ page }) => {
  const { email, officerId } = await accountOfficer(unique('Dyżurny Nagłówek'));
  await setDuty(officerId);
  await signInAs(page, email, PASSWORD);
  const requests = countDutyRequests(page);

  await page.goto('/');
  await expect(rangeLogLink(page)).toBeVisible();
  await expect(rangeLogLink(page)).toHaveAttribute('href', '/panel/ksiazka/');
  const links = await nav(page).getByRole('link').allTextContents();
  expect(links.indexOf('Książka')).toBe(links.indexOf('Moje konto') - 1);
  expect(requests()).toBe(1);

  await page.goto('/oferta/');
  await expect(nav(page).getByRole('link', { name: 'Moje konto' })).toBeVisible();
  await expect(rangeLogLink(page)).toBeVisible();
  expect(requests()).toBe(1);

  await rangeLogLink(page).click();
  await expect(page).toHaveURL(/\/panel\/ksiazka\/$/);
  await expect(page.getByRole('main').getByRole('heading', { name: 'Kogo wpisujemy?' })).toBeVisible();
});

test('AC-2, AC-9: niedyżurny bez linku; po ustawieniu dyżuru link pojawia się po wejściu na /konto/', async ({ page }) => {
  const { email, officerId } = await accountOfficer(unique('Przyszły Dyżurny'));
  await signInAs(page, email, PASSWORD);

  await page.goto('/');
  await expect(nav(page).getByRole('link', { name: 'Moje konto' })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), DUTY_KEY)).toContain('"duty":false');
  await expect(rangeLogLink(page)).toBeHidden();

  // Obsługa ustawia dyżurnego w ciągu dnia — pamięć karty ma `false` (AC-7), więc strona publiczna linku nie pokaże.
  await setDuty(officerId);
  await page.goto('/oferta/');
  await expect(nav(page).getByRole('link', { name: 'Moje konto' })).toBeVisible();
  await expect(rangeLogLink(page)).toBeHidden();

  await page.goto('/konto/');
  await expect(page.getByText('Dziś jesteś dyżurnym Prowadzącym.')).toBeVisible();
  await expect(rangeLogLink(page)).toBeVisible();
  await page.goto('/');
  await expect(rangeLogLink(page)).toBeVisible();
});

test('AC-3: gość — bez linku i bez zapytania', async ({ page }) => {
  const requests = countDutyRequests(page);
  await page.goto('/');
  await expect(nav(page).getByRole('link', { name: 'Zaloguj się' })).toBeVisible();
  await expect(rangeLogLink(page)).toBeHidden();
  expect(requests()).toBe(0);
});

test('AC-4: Obsługa — „Moje konto” i „Panel”, bez „Książka” i bez zapytania', async ({ page }) => {
  await signIn(page, 'staff');
  const requests = countDutyRequests(page);
  await page.goto('/');
  await expect(nav(page).getByRole('link', { name: 'Panel' })).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Moje konto' })).toBeVisible();
  await expect(rangeLogLink(page)).toBeHidden();
  expect(requests()).toBe(0);
});

test('AC-11: przestarzały link — brak uprawnień w panelu i zapis false', async ({ page }) => {
  const { email, officerId } = await accountOfficer(unique('Dyżurny Były'));
  await setDuty(officerId);
  await signInAs(page, email, PASSWORD);
  await page.goto('/');
  await expect(rangeLogLink(page)).toBeVisible();

  await clearDuty();
  await page.goto('/oferta/');
  await expect(rangeLogLink(page)).toBeVisible();
  await rangeLogLink(page).click();
  await expect(page.getByRole('main').getByText(FORBIDDEN)).toBeVisible();

  await page.goto('/');
  await expect(nav(page).getByRole('link', { name: 'Moje konto' })).toBeVisible();
  await expect(rangeLogLink(page)).toBeHidden();
});

test('AC-10: wylogowanie w /konto/ usuwa zapamiętany wynik', async ({ page }) => {
  const { email, officerId } = await accountOfficer(unique('Dyżurny Wylogowany'));
  await setDuty(officerId);
  await signInAs(page, email, PASSWORD);
  await page.goto('/konto/');
  await expect(rangeLogLink(page)).toBeVisible();
  await expect.poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), DUTY_KEY)).toContain('"duty":true');

  await page.getByRole('button', { name: 'Wyloguj się' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(nav(page).getByRole('link', { name: 'Zaloguj się' })).toBeVisible();
  await expect(rangeLogLink(page)).toBeHidden();
  expect(await page.evaluate((key) => window.sessionStorage.getItem(key), DUTY_KEY)).toBeNull();
});
