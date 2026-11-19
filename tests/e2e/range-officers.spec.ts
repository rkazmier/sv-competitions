import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-005 US-1: lista prowadzących strzelanie (admin; obsługa — odczyt). Wybór prowadzącego na zmianę (SPEC-005 AC-3,
// AC-4) zastąpił dyżurny Prowadzący w bazie — tests/e2e/range-duty.spec.ts (SPEC-007 AC-15…AC-17).
// AC-2 (kopia nazwiska we wpisie) — także pgTAP: supabase/tests/013_range_log_test.sql.
// Wymaga lokalnego Supabase (zmienne — tests/e2e/support/supabase.ts); w CI zawsze uruchamiane.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

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
    await expect(menu.getByRole('link', { name: /^Prowadzący/ })).toHaveAttribute('href', '/panel/prowadzacy/');
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

test.describe('obsługa — /panel/prowadzacy/', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'staff');
  });

  test('AC-1, SPEC-007 AC-10: obsługa widzi listę prowadzących tylko do odczytu (dodawanie i edycja — admin)', async ({
    page,
  }) => {
    const name = unique('Tylko odczyt');
    await addOfficer(name);
    await page.goto('/panel/prowadzacy/');
    await expect(itemFor(page, name)).toContainText('Aktywny');
    await expect(page.getByRole('form', { name: 'Dodaj prowadzącego' })).toBeHidden();
    await expect(itemFor(page, name).getByRole('button')).toHaveCount(0);

    // Menu obsługi: Książka i Prowadzący (SPEC-007 AC-10), bez stron admina.
    const menu = page.getByRole('navigation', { name: 'Menu panelu' });
    await expect(menu.getByRole('link', { name: 'Książka', exact: true })).toHaveAttribute('href', '/panel/ksiazka/');
    await expect(menu.getByRole('link', { name: /^Prowadzący/ })).toHaveAttribute('href', '/panel/prowadzacy/');
    await expect(menu.getByRole('link', { name: 'Dyscypliny', exact: true })).toHaveCount(0);
  });
});
