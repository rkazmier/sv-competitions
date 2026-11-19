import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-007 US-6 (AC-22, AC-23, AC-25): grafik dyżurów w `/panel/dyzury/`. Zakres dni, „na liście”, kolejność źródeł
// i uprawnienia — pgTAP: supabase/tests/030_range_duty_schedule_test.sql; AC-24 (dyżurny zawodów / wydarzeń, #120) —
// web/src/lib/range-duty-schedule.test.ts. Dyżurny jest jeden dla całej bazy: ten plik działa w osobnym projekcie
// Playwright po range-duty.spec.ts (playwright.config.ts) i szeregowo.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');
test.describe.configure({ mode: 'serial' });

async function today(): Promise<string> {
  const { data, error } = await admin().rpc('range_today');
  if (error) throw error;
  return data as string;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function clearDuty(): Promise<void> {
  const { error } = await admin().from('range_duty').delete().gte('day', await today());
  if (error) throw error;
}

async function addOfficer(name: string): Promise<string> {
  const { data, error } = await admin().from('range_officers').insert({ full_name: name }).select('id').single();
  if (error || !data) throw error ?? new Error('Brak prowadzącego');
  return data.id as string;
}

async function setDuty(day: string, source: 'book' | 'schedule', officerId: string): Promise<void> {
  const { error } = await admin().from('range_duty').upsert({ day, source, range_officer_id: officerId }, { onConflict: 'day,source' });
  if (error) throw error;
}

async function scheduled(day: string): Promise<string | null> {
  const { data } = await admin().from('range_duty').select('range_officer_id').eq('day', day).eq('source', 'schedule').maybeSingle();
  return (data?.range_officer_id as string | undefined) ?? null;
}

const dayCard = (page: Page, day: string) => page.locator(`[data-day="${day}"]`);

test.beforeEach(clearDuty);
test.afterAll(clearDuty);

test('AC-22: menu „Dyżury”, 30 dni od dziś, „Pokaż kolejne 30 dni” do 90 dni naprzód', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/panel/ksiazka/');
  await page.getByRole('navigation').getByRole('link', { name: 'Dyżury' }).click();
  await expect(page).toHaveURL(/\/panel\/dyzury\/$/);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Grafik dyżurów', level: 1 })).toBeVisible();

  const first = await today();
  const days = main.locator('[data-day]');
  await expect(days).toHaveCount(30);
  await expect(days.first()).toHaveAttribute('data-day', first);
  await expect(dayCard(page, first)).toContainText('dziś');
  await expect(dayCard(page, first)).toContainText('Brak dyżurnego');
  await expect(dayCard(page, first).getByRole('button', { name: /^Ustaw/ })).toBeVisible();
  await expect(dayCard(page, first).getByRole('button', { name: /^Usuń z grafiku/ })).toBeHidden();

  const more = main.getByRole('button', { name: 'Pokaż kolejne 30 dni' });
  await more.click();
  await expect(days).toHaveCount(60);
  await more.click();
  await expect(days).toHaveCount(90);
  await more.click();
  await expect(days).toHaveCount(91);
  await expect(days.last()).toHaveAttribute('data-day', addDays(first, 90));
  await expect(more).toBeHidden();
});

test('AC-23: „Ustaw”, „Zmień” (wyszukiwarka), „Usuń z grafiku” — zapis w bazie, widoczny na innym urządzeniu', async ({ page, browser }) => {
  const visible = unique('Grafik Widoczny');
  const other = unique('Grafik Drugi');
  const visibleId = await addOfficer(visible);
  const otherId = await addOfficer(other);
  const day = addDays(await today(), 3);

  await signIn(page, 'staff');
  await page.goto('/panel/dyzury/');
  const card = dayCard(page, day);
  await card.getByRole('button', { name: /^Ustaw/ }).click();
  await card.getByRole('button', { name: visible, exact: true }).click();
  await expect(card).toContainText(visible);
  await expect(card).toContainText('z grafiku');
  await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'Zapisano dyżurnego na' })).toBeVisible();
  expect(await scheduled(day)).toBe(visibleId);

  // „Zmień” — wyszukiwarka (AC-19); nadpisuje wpis grafiku.
  await card.getByRole('button', { name: /^Zmień/ }).click();
  await card.getByLabel('Szukaj prowadzącego').fill(other);
  await card.getByRole('button', { name: 'Szukaj', exact: true }).click();
  await card.locator('[data-officer-results]').getByRole('button', { name: other, exact: true }).click();
  await expect(card).toContainText(other);
  expect(await scheduled(day)).toBe(otherId);

  // Inne urządzenie (admin) widzi ten sam grafik.
  const context = await browser.newContext();
  const otherPage = await context.newPage();
  await signIn(otherPage, 'admin');
  await otherPage.goto('/panel/dyzury/');
  await expect(dayCard(otherPage, day)).toContainText(other);
  await context.close();

  await card.getByRole('button', { name: /^Usuń z grafiku/ }).click();
  await expect(card).toContainText('Brak dyżurnego');
  await expect(card.getByRole('button', { name: /^Usuń z grafiku/ })).toBeHidden();
  expect(await scheduled(day)).toBeNull();
});

test('AC-25: dziś obowiązuje zmiana z książki — zmiana i usunięcie wpisu grafiku jej nie zastępują', async ({ page }) => {
  const booked = unique('Z Książki');
  const planned = unique('Z Grafiku');
  const day = await today();
  await setDuty(day, 'book', await addOfficer(booked));
  await setDuty(day, 'schedule', await addOfficer(planned));
  const hint = `Dziś obowiązuje zmiana z książki: ${booked}.`;

  await signIn(page, 'staff');
  await page.goto('/panel/dyzury/');
  const card = dayCard(page, day);
  await expect(card).toContainText(booked);
  await expect(card).toContainText('zmiana w książce');
  await expect(card).toContainText(hint);

  await card.getByRole('button', { name: /^Usuń z grafiku/ }).click();
  await expect(card.getByRole('button', { name: /^Ustaw/ })).toBeVisible();
  await expect(card).toContainText(booked);
  await expect(card).toContainText(hint);
  const { data } = await admin().from('range_duty').select('source').eq('day', day);
  expect(data).toEqual([{ source: 'book' }]);
});

test('AC-22: użytkownik bez roli nie widzi grafiku', async ({ page }) => {
  await signIn(page, 'user');
  await page.goto('/panel/dyzury/');
  await expect(page.getByRole('main').getByText('Nie masz uprawnień do panelu.')).toBeVisible();
  await expect(page.locator('[data-day]')).toHaveCount(0);
});

test('AC-22: grafik na telefonie (320 px) bez poziomego przewijania', async ({ page }) => {
  await addOfficer(unique('Telefon Grafik'));
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page, 'staff');
  await page.goto('/panel/dyzury/');
  const first = dayCard(page, await today());
  await first.getByRole('button', { name: /^Ustaw/ }).click();
  await expect(first.getByLabel('Szukaj prowadzącego')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
