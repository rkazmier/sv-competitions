import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-003 US-1 (AC-1…AC-4): produkty i ceny w panelu `/panel/oferta/`.
// AC-3 (blokada przy zamówieniach) sprawdza pgTAP (supabase/tests/009_products_test.sql) — tabela zamówień powstaje w #48.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const itemFor = (page: Page, name: string) =>
  page.getByRole('main').getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });

/** Nazwa przycisku „<akcja>: <produkt>” (nazwa produktu w ukrytym dla oka `span`, przeglądarka może dodać spację). */
const action = (label: string, product: string) => new RegExp(`^${label}\\s?: ${product}$`);

/** Produkty widoczne dla gościa (klucz publishable, RLS) — to samo źródło co `/oferta/`. */
async function publicProductNames(): Promise<string[]> {
  const client = createClient(process.env.PUBLIC_SUPABASE_URL ?? '', process.env.PUBLIC_SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.from('products').select('name');
  if (error) throw error;
  return (data ?? []).map((row) => row.name as string);
}

test.describe('admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-1: dodanie karnetu ilościowego — produkt pojawia się na liście jako ukryty', async ({ page }) => {
    const name = unique('Karnet E2E');
    await page.goto('/panel/oferta/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Oferta — produkty i ceny');
    await expect(page.getByLabel('Liczba wejść *')).toBeHidden();

    await page.getByLabel('Rodzaj *').selectOption({ label: 'Karnet ilościowy' });
    await page.getByLabel('Nazwa *').fill(name);
    await page.getByLabel('Cena (zł) *').fill('120,5');
    await page.getByLabel('Liczba wejść *').fill('10');
    await page.getByLabel('Opis').fill('Wejścia na dowolną oś.');
    await page.getByRole('button', { name: 'Dodaj produkt' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Dodano produkt.' })).toBeVisible();
    const item = page
      .getByRole('region', { name: 'Karnety ilościowe' })
      .getByRole('listitem')
      .filter({ has: page.getByText(name, { exact: true }) });
    await expect(item).toContainText('Ukryty');
    await expect(item).toContainText('120,50');
    await expect(item).toContainText('Liczba wejść: 10');

    const { data } = await admin().from('products').select('price, entries, is_active').eq('name', name).single();
    expect(data).toEqual({ price: 12050, entries: 10, is_active: false });
  });

  test('AC-1: walidacja — rodzaj, cena do grosza, liczba wejść 1–100', async ({ page }) => {
    await page.goto('/panel/oferta/');
    await page.getByLabel('Rodzaj *').selectOption({ label: 'Karnet ilościowy' });
    await page.getByLabel('Nazwa *').fill(unique('Zły'));
    await page.getByLabel('Cena (zł) *').fill('10,999');
    await page.getByLabel('Liczba wejść *').fill('101');
    await page.getByRole('button', { name: 'Dodaj produkt' }).click();

    await expect(page.getByLabel('Cena (zł) *')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('Podaj liczbę wejść od 1 do 100.')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Popraw zaznaczone pola.' })).toBeVisible();
  });

  test('SPEC-012 AC-53: „Rodzaj” bez „Karnet czasowy”; istniejący karnet czasowy można edytować', async ({ page }) => {
    const name = unique('Karnet czasowy sprzed 7-A');
    await admin().from('products').insert({ kind: 'days', name, price: 30000, days: 30 });
    await page.goto('/panel/oferta/');
    const kind = page.getByLabel('Rodzaj *');
    await expect(kind.locator('option:not([disabled])')).toHaveText(['— wybierz —', 'Karnet ilościowy', 'Wejście jednorazowe']);
    await itemFor(page, name).getByRole('button', { name: action('Edytuj', name) }).click();
    await expect(kind).toHaveValue('days');
    await page.getByLabel('Cena (zł) *').fill('310');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();
    await expect(itemFor(page, name)).toContainText('310,00');
  });
  test('AC-2: „Pokaż w ofercie” / „Ukryj” zmienia widoczność dla gościa; brak usuwania', async ({ page }) => {
    const name = unique('Wejście E2E');
    await admin().from('products').insert({ kind: 'single_entry', name, price: 5000, day_type: 'weekend' });
    await page.goto('/panel/oferta/');
    const item = itemFor(page, name);
    await expect(item).toContainText('Dzień: Weekend');
    await expect(item.getByRole('button', { name: /Usuń/ })).toHaveCount(0);

    await item.getByRole('button', { name: action('Pokaż w ofercie', name) }).click();
    await expect(item).toContainText('W ofercie');
    await expect.poll(publicProductNames).toContain(name);

    await item.getByRole('button', { name: action('Ukryj', name) }).click();
    await expect(item).toContainText('Ukryty');
    await expect.poll(publicProductNames).not.toContain(name);
  });

  test('AC-3: edycja nazwy i ceny produktu', async ({ page }) => {
    const name = unique('Karnet do zmiany');
    const renamed = unique('Karnet po zmianie');
    await admin().from('products').insert({ kind: 'days', name, price: 30000, days: 30 });
    await page.goto('/panel/oferta/');
    await itemFor(page, name).getByRole('button', { name: action('Edytuj', name) }).click();
    await expect(page.getByRole('heading', { name: `Edytuj produkt: ${name}` })).toBeVisible();
    await expect(page.getByLabel('Cena (zł) *')).toHaveValue('300,00');
    await page.getByLabel('Nazwa *').fill(renamed);
    await page.getByLabel('Cena (zł) *').fill('320');
    await page.getByRole('button', { name: 'Zapisz zmiany' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();
    await expect(itemFor(page, renamed)).toContainText('320,00');
    await expect(page.getByRole('heading', { name: 'Dodaj produkt' })).toBeVisible();
  });

  test('AC-4: strzałki zmieniają kolejność w grupie', async ({ page }) => {
    const first = unique('Pierwszy');
    const second = unique('Drugi');
    const db = admin();
    await db.from('products').insert({ kind: 'days', name: first, price: 100, days: 1 });
    await db.from('products').insert({ kind: 'days', name: second, price: 100, days: 2 });
    await page.goto('/panel/oferta/');
    const group = page.getByRole('region', { name: 'Karnety czasowe' });
    const order = async () => {
      const texts = await group.getByRole('listitem').allTextContents();
      return [first, second].sort((a, b) => texts.findIndex((t) => t.includes(a)) - texts.findIndex((t) => t.includes(b)));
    };
    await expect.poll(order).toEqual([first, second]);
    await expect(itemFor(page, second).getByRole('button', { name: action('W dół', second) })).toBeDisabled();

    await itemFor(page, second).getByRole('button', { name: action('W górę', second) }).click();
    await expect.poll(order).toEqual([second, first]);
    await expect(page.getByRole('button', { name: action('W górę', second) })).toBeFocused();

    const { data } = await db.from('products').select('name, position').in('name', [first, second]).order('position');
    expect(data?.map((row) => row.name)).toEqual([second, first]);
  });
});

test('obsługa nie widzi produktów w panelu (tylko admin)', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/panel/oferta/');
  await expect(page.getByRole('main').getByText('Moduły obsługi będą dostępne wkrótce.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dodaj produkt' })).toBeHidden();
});
