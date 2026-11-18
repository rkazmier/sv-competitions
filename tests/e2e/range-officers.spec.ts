import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-005 US-1, US-2: lista prowadzących strzelanie (admin) i wybór prowadzącego na zmianę (obsługa).
// AC-2 (kopia nazwiska we wpisie) — także pgTAP: supabase/tests/013_range_log_test.sql.
// Wymaga lokalnego Supabase (zmienne — tests/e2e/support/supabase.ts); w CI zawsze uruchamiane.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const SHIFT_KEY = 'sv-range-shift';

const itemFor = (page: Page, name: string) =>
  page.getByRole('main').getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });

async function addOfficer(name: string, isActive = true): Promise<string> {
  const { data, error } = await admin()
    .from('range_officers')
    .insert({ full_name: name, is_active: isActive })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Brak prowadzącego');
  return data.id as string;
}

test.describe('admin — /panel/prowadzacy/', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-1: dodanie prowadzącego (imię i nazwisko, nr legitymacji, instytucja) — na liście jako aktywny; menu', async ({
    page,
  }) => {
    const name = unique('Prowadzący');
    await page.goto('/panel/prowadzacy/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prowadzący strzelanie');
    const form = page.getByRole('form', { name: 'Dodaj prowadzącego' });

    await form.getByLabel('Imię i nazwisko', { exact: true }).fill('A');
    await form.getByRole('button', { name: 'Dodaj' }).click();
    await expect(form.getByText('Imię i nazwisko musi mieć co najmniej 2 znaki.')).toBeVisible();
    await expect(form.getByText('Podaj nr legitymacji.')).toBeVisible();
    await expect(form.getByText('Wybierz instytucję.')).toBeVisible();

    await form.getByLabel('Imię i nazwisko', { exact: true }).fill(`  ${name}  `);
    await form.getByLabel('Nr legitymacji').fill(' 123/2024 ');
    await form.getByLabel('Instytucja').selectOption({ label: 'PZŁ' });
    await expect(form.getByLabel('Nazwa instytucji')).toBeHidden();
    await form.getByRole('button', { name: 'Dodaj' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();
    await expect(itemFor(page, name)).toContainText('Aktywny');
    await expect(itemFor(page, name)).toContainText('Nr legitymacji: 123/2024 · PZŁ');
    const { data } = await admin()
      .from('range_officers')
      .select('is_active, license_number, institution, institution_other')
      .eq('full_name', name)
      .single();
    expect(data).toEqual({ is_active: true, license_number: '123/2024', institution: 'PZL', institution_other: null });

    const menu = page.getByRole('navigation', { name: 'Menu panelu' });
    await expect(menu.getByRole('link', { name: 'Prowadzący', exact: true })).toHaveAttribute('href', '/panel/prowadzacy/');
    await expect(menu.getByRole('link', { name: 'Książka', exact: true })).toHaveAttribute('href', '/panel/ksiazka/');
  });

  test('AC-1: instytucja „Inne” — wymagane pole „Nazwa instytucji”', async ({ page }) => {
    const name = unique('Inna instytucja');
    await page.goto('/panel/prowadzacy/');
    const form = page.getByRole('form', { name: 'Dodaj prowadzącego' });
    await form.getByLabel('Imię i nazwisko', { exact: true }).fill(name);
    await form.getByLabel('Nr legitymacji').fill('77');
    await form.getByLabel('Instytucja').selectOption({ label: 'Inne' });
    await form.getByRole('button', { name: 'Dodaj' }).click();
    await expect(form.getByText('Podaj nazwę instytucji.')).toBeVisible();

    await form.getByLabel('Nazwa instytucji').fill('Klub Strzelecki ABC');
    await form.getByRole('button', { name: 'Dodaj' }).click();
    await expect(itemFor(page, name)).toContainText('Nr legitymacji: 77 · Klub Strzelecki ABC');
    const { data } = await admin().from('range_officers').select('institution, institution_other').eq('full_name', name).single();
    expect(data).toEqual({ institution: 'OTHER', institution_other: 'Klub Strzelecki ABC' });
  });

  test('AC-1: „Ukryj” / „Przywróć”, bez usuwania', async ({ page }) => {
    const name = unique('Do ukrycia');
    await addOfficer(name);
    await page.goto('/panel/prowadzacy/');
    const item = itemFor(page, name);
    await expect(item.getByRole('button', { name: /usuń/i })).toHaveCount(0);

    await item.getByRole('button', { name: 'Ukryj' }).click();
    await expect(item).toContainText('Ukryty');
    const { data: hidden } = await admin().from('range_officers').select('is_active').eq('full_name', name).single();
    expect(hidden?.is_active).toBe(false);

    await item.getByRole('button', { name: 'Przywróć' }).click();
    await expect(item).toContainText('Aktywny');
  });

  test('AC-2, AC-1a: edycja prowadzącego sprzed #104 — uzupełnienie nr legitymacji i instytucji', async ({ page }) => {
    const name = unique('Stary');
    const renamed = unique('Nowy');
    const id = await addOfficer(name);
    await page.goto('/panel/prowadzacy/');
    const item = itemFor(page, name);
    await expect(item).toContainText('Brak nr legitymacji');
    await item.getByRole('button', { name: 'Edytuj' }).click();
    await item.getByLabel('Imię i nazwisko', { exact: true }).fill(renamed);
    await item.getByRole('button', { name: 'Zapisz' }).click();
    await expect(item.getByText('Podaj nr legitymacji.')).toBeVisible();

    await item.getByLabel('Nr legitymacji').fill('9');
    await item.getByLabel('Instytucja').selectOption({ label: 'LOK' });
    await item.getByRole('button', { name: 'Zapisz' }).click();
    await expect(itemFor(page, renamed)).toContainText('Nr legitymacji: 9 · LOK');
    const { data } = await admin().from('range_officers').select('full_name, license_number, institution').eq('id', id).single();
    expect(data).toEqual({ full_name: renamed, license_number: '9', institution: 'LOK' });
  });
});

test.describe('obsługa — /panel/ksiazka/', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'staff');
  });

  test('AC-3, AC-4: „Kto prowadzi strzelanie?” → wybór zapamiętany na urządzeniu, nazwisko i „Zmień”', async ({
    page,
  }) => {
    const name = unique('Zmiana');
    const hidden = unique('Ukryty');
    await addOfficer(name);
    await addOfficer(hidden, false);

    await page.goto('/panel/ksiazka/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Kto prowadzi strzelanie?' })).toBeVisible();
    await expect(main.getByRole('button', { name: hidden })).toHaveCount(0);
    await main.getByRole('button', { name, exact: true }).click();

    await expect(main.getByText('Prowadzący strzelanie:')).toContainText(name);
    await expect(main.getByRole('heading', { name: 'Kto prowadzi strzelanie?' })).toBeHidden();

    // Zapamiętane na urządzeniu — po przeładowaniu bez pytania (AC-3).
    await page.reload();
    await expect(main.getByText('Prowadzący strzelanie:')).toContainText(name);

    // „Zmień” wraca do wyboru (AC-4).
    await main.getByRole('button', { name: /^Zmień/ }).click();
    await expect(main.getByRole('heading', { name: 'Kto prowadzi strzelanie?' })).toBeVisible();
    await main.getByRole('button', { name, exact: true }).click();
    await expect(main.getByText('Prowadzący strzelanie:')).toContainText(name);

    // Menu obsługi: Książka, bez stron admina.
    const menu = page.getByRole('navigation', { name: 'Menu panelu' });
    await expect(menu.getByRole('link', { name: 'Książka', exact: true })).toHaveAttribute('href', '/panel/ksiazka/');
    await expect(menu.getByRole('link', { name: 'Prowadzący', exact: true })).toHaveCount(0);
  });

  test('AC-3: wybór z poprzedniego dnia nie obowiązuje — pytanie wraca', async ({ page }) => {
    const name = unique('Wczoraj');
    const id = await addOfficer(name);
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [SHIFT_KEY, JSON.stringify({ id, day: '2020-01-01' })] as const,
    );
    await page.goto('/panel/ksiazka/');
    await expect(page.getByRole('heading', { name: 'Kto prowadzi strzelanie?' })).toBeVisible();
  });

  test('AC-3, §7: prowadzący ukryty w trakcie zmiany — trzeba wybrać ponownie', async ({ page }) => {
    const name = unique('Ukrywany');
    const id = await addOfficer(name);
    await page.goto('/panel/ksiazka/');
    await page.getByRole('main').getByRole('button', { name, exact: true }).click();
    await expect(page.getByText('Prowadzący strzelanie:')).toContainText(name);

    await admin().from('range_officers').update({ is_active: false }).eq('id', id);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Kto prowadzi strzelanie?' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name, exact: true })).toHaveCount(0);
  });

  test('AC-1: obsługa nie widzi listy prowadzących (/panel/prowadzacy/ tylko admin)', async ({ page }) => {
    await page.goto('/panel/prowadzacy/');
    await expect(page.getByRole('main').getByText('Moduły obsługi będą dostępne wkrótce.')).toBeVisible();
    await expect(page.getByLabel('Imię i nazwisko', { exact: true })).toBeHidden();
  });

  test('AC-3: wybór prowadzącego na telefonie (320 px) bez poziomego przewijania', async ({ page }) => {
    await addOfficer(unique('Telefon'));
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/panel/ksiazka/');
    await expect(page.getByRole('heading', { name: 'Kto prowadzi strzelanie?' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
