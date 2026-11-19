import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-007 US-4 (AC-15…AC-17) i AC-19: dyżurny Prowadzący w bazie w `/panel/ksiazka/` (zastępuje SPEC-005 AC-3, AC-4).
// Kolejność źródeł, „na liście”, upsert i czyszczenie — pgTAP: supabase/tests/028_range_duty_test.sql.
// Dyżurny jest jeden dla całej bazy: ten plik działa w osobnym projekcie Playwright po pozostałych testach
// (playwright.config.ts) i szeregowo.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');
test.describe.configure({ mode: 'serial' });

const QUESTION = 'Kto prowadzi dziś strzelanie?';

async function today(): Promise<string> {
  const { data, error } = await admin().rpc('range_today');
  if (error) throw error;
  return data as string;
}

async function clearDuty(): Promise<void> {
  const { error } = await admin().from('range_duty').delete().eq('day', await today());
  if (error) throw error;
}

async function addOfficer(name: string, isActive = true): Promise<string> {
  const { data, error } = await admin().from('range_officers').insert({ full_name: name, is_active: isActive }).select('id').single();
  if (error || !data) throw error ?? new Error('Brak prowadzącego');
  return data.id as string;
}

/** Zatwierdzony prowadzący z konta z „Ukryj mnie dla innych” (SPEC-007 AC-2, AC-8). */
async function addHiddenAccountOfficer(name: string): Promise<string> {
  const db = admin();
  const email = `${unique('dyzurny').replace(/\s/g, '-')}@example.test`;
  const { data: user, error: userError } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (userError || !user.user) throw userError ?? new Error('Brak konta');
  await db.from('profiles').update({ full_name: name }).eq('id', user.user.id);
  const { data, error } = await db
    .from('range_officers')
    .insert({ full_name: name, profile_id: user.user.id, license_number: '1', institution: 'PZSS', hide_from_others: true, status: 'approved' })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Brak prowadzącego');
  return data.id as string;
}

async function setDuty(source: 'book' | 'schedule', officerId: string): Promise<void> {
  const { error } = await admin()
    .from('range_duty')
    .upsert({ day: await today(), source, range_officer_id: officerId }, { onConflict: 'day,source' });
  if (error) throw error;
}

const dutyBar = (page: Page) => page.getByRole('main').getByText('Dyżurny:');

test.beforeEach(async ({ page }) => {
  await clearDuty();
  await signIn(page, 'staff');
});

test.afterAll(clearDuty);

test('AC-15, AC-19: bez dyżurnego — pytanie z listą i wyszukiwarką; wybór zapisuje dyżurnego w bazie', async ({ page }) => {
  const visible = unique('Widoczny');
  const hidden = unique('Ukryta Dla Innych');
  const inactive = unique('Ukryty Admin');
  const visibleId = await addOfficer(visible);
  await addHiddenAccountOfficer(hidden);
  await addOfficer(inactive, false);

  await page.goto('/panel/ksiazka/');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: QUESTION })).toBeVisible();
  await expect(main.getByRole('button', { name: visible, exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: hidden, exact: true })).toHaveCount(0);
  await expect(main.getByRole('button', { name: inactive, exact: true })).toHaveCount(0);
  // Bez dyżurnego nie ma czego anulować ani przebiegu wpisu.
  await expect(main.getByRole('button', { name: 'Anuluj', exact: true })).toBeHidden();
  await expect(main.getByRole('heading', { name: 'Kogo wpisujemy?' })).toBeHidden();

  // AC-19: wyszukiwarka — od 3 znaków, także ukryci dla innych; spoza listy — brak.
  const search = main.getByLabel('Szukaj prowadzącego');
  await search.fill('Uk');
  await main.getByRole('button', { name: 'Szukaj', exact: true }).click();
  await expect(main.getByRole('status').filter({ hasText: 'Wpisz co najmniej 3 znaki imienia lub nazwiska.' })).toBeVisible();
  await search.fill(inactive);
  await search.press('Enter');
  await expect(main.getByRole('status').filter({ hasText: 'Nie znaleziono prowadzącego.' })).toBeVisible();
  await search.fill(hidden);
  await search.press('Enter');
  await expect(main.getByRole('button', { name: hidden, exact: true })).toBeVisible();

  await main.getByRole('button', { name: visible, exact: true }).click();
  await expect(dutyBar(page)).toContainText(visible);
  await expect(main.getByRole('heading', { name: QUESTION })).toBeHidden();
  await expect(main.getByRole('heading', { name: 'Kogo wpisujemy?' })).toBeVisible();

  const { data } = await admin().from('range_duty').select('source, range_officer_id').eq('day', await today());
  expect(data).toEqual([{ source: 'book', range_officer_id: visibleId }]);
  // Urządzenie niczego nie zapamiętuje (`sv-range-shift` nie jest używany).
  expect(await page.evaluate(() => window.localStorage.getItem('sv-range-shift'))).toBeNull();
});

test('AC-16: dyżurny widoczny na każdym urządzeniu; „Zmień” obowiązuje od razu; dopisek „(z grafiku)”', async ({ page, browser }) => {
  const scheduled = unique('Grafikowy');
  const chosen = unique('Ukryty Zmieniony');
  await setDuty('schedule', await addOfficer(scheduled));
  const chosenId = await addHiddenAccountOfficer(chosen);

  await page.goto('/panel/ksiazka/');
  await expect(dutyBar(page)).toContainText(scheduled);
  await expect(dutyBar(page)).toContainText('(z grafiku)');

  // „Zmień” — wybór ukrytego dla innych z wyszukiwarki; „Anuluj” wraca bez zmiany.
  const main = page.getByRole('main');
  await main.getByRole('button', { name: /^Zmień/ }).click();
  await expect(main.getByRole('heading', { name: QUESTION })).toBeVisible();
  await main.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await expect(dutyBar(page)).toContainText(scheduled);
  await main.getByRole('button', { name: /^Zmień/ }).click();
  await main.getByLabel('Szukaj prowadzącego').fill(chosen);
  await main.getByRole('button', { name: 'Szukaj', exact: true }).click();
  await main.getByRole('button', { name: chosen, exact: true }).click();
  await expect(dutyBar(page)).toContainText(chosen);
  await expect(dutyBar(page)).not.toContainText('(z grafiku)');

  // Drugie urządzenie (osobna sesja przeglądarki) widzi tego samego dyżurnego.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, 'admin');
  await otherPage.goto('/panel/ksiazka/');
  await expect(dutyBar(otherPage)).toContainText(chosen);
  await other.close();

  const { data } = await admin().from('range_duty').select('range_officer_id').eq('day', await today()).eq('source', 'book').single();
  expect(data?.range_officer_id).toBe(chosenId);
});

test('AC-17: dyżurny ukryty — obowiązuje następne źródło, a gdy brak — ponowny wybór', async ({ page }) => {
  const booked = unique('Z Książki');
  const scheduled = unique('Z Grafiku');
  const bookedId = await addOfficer(booked);
  const scheduledId = await addOfficer(scheduled);
  await setDuty('schedule', scheduledId);
  await setDuty('book', bookedId);

  await page.goto('/panel/ksiazka/');
  await expect(dutyBar(page)).toContainText(booked);

  await admin().from('range_officers').update({ is_active: false }).eq('id', bookedId);
  await page.reload();
  await expect(dutyBar(page)).toContainText(scheduled);
  await expect(dutyBar(page)).toContainText('(z grafiku)');

  await admin().from('range_officers').update({ is_active: false }).eq('id', scheduledId);
  await page.reload();
  await expect(page.getByRole('heading', { name: QUESTION })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: scheduled, exact: true })).toHaveCount(0);
});

test('AC-15: wybór dyżurnego na telefonie (320 px) bez poziomego przewijania', async ({ page }) => {
  await addOfficer(unique('Telefon'));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/panel/ksiazka/');
  await expect(page.getByRole('heading', { name: QUESTION })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
