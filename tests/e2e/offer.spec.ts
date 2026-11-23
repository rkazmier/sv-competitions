import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signInAs, unique } from './support/supabase';

// SPEC-003 US-2, US-3: `/oferta/`, podsumowanie zamówienia, powrót z Tpay, karnety i płatności w `/konto/`
// (AC-5…AC-7, AC-10, AC-12…AC-15). Bramka Tpay i `payments-create` są podmienione (`page.route`) — ich logikę
// sprawdzają testy Deno (supabase/functions/payments-create/handler_test.ts).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PASSWORD = 'haslo-e2e-123';

type Kind = 'entries' | 'days' | 'single_entry';

/** Aktywny produkt (jak po „Pokaż w ofercie” w panelu). */
async function product(kind: Kind, price: number, extra: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const name = unique(`Oferta E2E ${kind}`);
  const details = { entries: { entries: 10 }, days: { days: 30 }, single_entry: { day_type: 'weekend' } }[kind];
  const db = admin();
  const { data, error } = await db.from('products').insert({ kind, name, price, ...details, ...extra }).select('id').single();
  if (error) throw error;
  const { error: showError } = await db.from('products').update({ is_active: true }).eq('id', data.id);
  if (showError) throw showError;
  return { id: data.id as string, name };
}

/** Nowe konto z potwierdzoną klauzulą, zalogowane w `page`. */
async function newAccount(page: Page): Promise<string> {
  const email = `oferta-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  if (error) throw error;
  await signInAs(page, email, PASSWORD);
  return data.user.id;
}

/** Zamówienie Tpay `pending` (jak po `payments-create`); `paid` — zrealizowane przez `fulfil_order`. */
async function order(userId: string, item: { id: string; name: string }, amount: number, paid: boolean): Promise<string> {
  const db = admin();
  const { data, error } = await db
    .from('orders')
    .insert({ user_id: userId, product_id: item.id, item_name: item.name, amount, payment_method: 'tpay' })
    .select('id')
    .single();
  if (error) throw error;
  if (paid) await fulfil(data.id as string);
  return data.id as string;
}

async function fulfil(orderId: string): Promise<void> {
  const { error } = await admin().rpc('fulfil_order', { p_order_id: orderId });
  if (error) throw error;
}

const offerItem = (page: Page, name: string) =>
  page.getByRole('main').getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });

test('AC-5: grupy produktów z ceną, opisem i informacjami o ważności', async ({ page }) => {
  const entries = await product('entries', 12000, { description: 'Wejścia na dowolną oś.' });
  const days = await product('days', 25000);
  const weekend = await product('single_entry', 4000);
  await page.goto('/oferta/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Oferta');

  const entriesItem = page.getByRole('region', { name: 'Karnety ilościowe' }).getByRole('listitem').filter({ hasText: entries.name });
  await expect(entriesItem).toContainText('120,00 zł');
  await expect(entriesItem).toContainText('Wejścia na dowolną oś.');
  await expect(entriesItem).toContainText('Ważny 1 rok od zakupu.');

  const daysItem = page.getByRole('region', { name: 'Karnety czasowe' }).getByRole('listitem').filter({ hasText: days.name });
  await expect(daysItem).toContainText('Odliczanie dni zaczyna się od pierwszego wejścia.');

  const singleItem = page.getByRole('region', { name: 'Wejścia jednorazowe' }).getByRole('listitem').filter({ hasText: weekend.name });
  await expect(singleItem).toContainText('Tylko w soboty i niedziele.');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Oferta' })).toHaveAttribute('href', '/oferta/');
});

test('AC-6: „Kup” bez logowania → logowanie z powrotem do podsumowania', async ({ page }) => {
  const item = await product('entries', 12000);
  await page.goto('/oferta/');
  await offerItem(page, item.name).getByRole('link', { name: `Kup: ${item.name}` }).click();
  await expect(page).toHaveURL(/\/logowanie\/\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(`/oferta/zamowienie/?product=${item.id}`);
});

test.describe('zalogowany', () => {
  test('AC-7: „Kup” → podsumowanie: produkt, cena, ważność, regulamin i „Zapłać 120,00 zł”', async ({ page }) => {
    const item = await product('entries', 12000);
    await newAccount(page);
    await page.goto('/oferta/');
    await offerItem(page, item.name).getByRole('link', { name: `Kup: ${item.name}` }).click();
    await expect(page).toHaveURL(new RegExp(`/oferta/zamowienie/\\?product=${item.id}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Podsumowanie zamówienia');
    await expect(page.getByText(item.name, { exact: true })).toBeVisible();
    await expect(page.getByText('Ważny 1 rok od zakupu.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'regulamin sprzedaży' })).toHaveAttribute('href', '/regulamin-sprzedazy/');
    // #154: regulamin w nowej karcie — zamówienie zostaje otwarte
    await expect(page.getByRole('link', { name: 'regulamin sprzedaży' })).toHaveAttribute('target', '_blank');

    const pay = page.getByRole('button', { name: 'Zapłać 120,00 zł' });
    await pay.click();
    await expect(page.getByText('Zaakceptuj regulamin sprzedaży, aby zapłacić.')).toBeVisible();

    // AC-8 (bez Tpay): `payments-create` zwraca adres bramki, przeglądarka tam przechodzi.
    let body: Record<string, unknown> = {};
    await page.route('**/functions/v1/payments-create', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ json: { order_id: crypto.randomUUID(), payment_url: 'https://secure.sandbox.tpay.com/?title=TEST' } });
    });
    await page.route('https://secure.sandbox.tpay.com/**', (route) => route.fulfill({ body: 'Tpay' }));
    await page.getByLabel(/Akceptuję regulamin sprzedaży/).check();
    await pay.click();
    await expect(page).toHaveURL(/secure\.sandbox\.tpay\.com/);
    expect(body.product_id).toBe(item.id);
    expect(body).not.toHaveProperty('amount');
  });

  test('AC-7: produkt ukryty lub błąd płatności → komunikaty', async ({ page }) => {
    const item = await product('entries', 12000);
    await newAccount(page);
    await page.route('**/functions/v1/payments-create', (route) => route.fulfill({ status: 502, json: { error: 'payment_failed' } }));
    await page.goto(`/oferta/zamowienie/?product=${item.id}`);
    await page.getByLabel(/Akceptuję regulamin sprzedaży/).check();
    await page.getByRole('button', { name: 'Zapłać 120,00 zł' }).click();
    await expect(page.getByText('Nie udało się rozpocząć płatności. Spróbuj ponownie.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zapłać 120,00 zł' })).toBeEnabled();

    await admin().from('products').update({ is_active: false }).eq('id', item.id);
    await page.reload();
    await expect(page.getByText('Ten produkt nie jest już dostępny.')).toBeVisible();
  });

  test('AC-10, SPEC-006 AC-13: powrót z Tpay — numer zamówienia, czekamy, a po potwierdzeniu „Płatność przyjęta…”', async ({ page }) => {
    const item = await product('entries', 12000);
    const userId = await newAccount(page);
    const orderId = await order(userId, item, 12000, false);
    const { data: created } = await admin().from('orders').select('order_number').eq('id', orderId).single();
    await page.goto(`/konto/platnosc/?order=${orderId}`);
    await expect(page.getByText('Czekamy na potwierdzenie płatności…')).toBeVisible();
    await expect(page.getByText(`Zamówienie ${created!.order_number}`, { exact: true })).toBeVisible();
    await fulfil(orderId);
    await expect(page.getByText('Płatność przyjęta. Karnet jest aktywny w Twoim koncie.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: 'Moje konto' }).last()).toHaveAttribute('href', '/konto/');
  });

  test('AC-10: brak potwierdzenia przez 60 s → „Potwierdzenie może potrwać kilka minut…”', async ({ page }) => {
    const item = await product('entries', 12000);
    const userId = await newAccount(page);
    const orderId = await order(userId, item, 12000, false);
    await page.clock.install();
    await page.goto(`/konto/platnosc/?order=${orderId}`);
    await expect(page.getByText('Czekamy na potwierdzenie płatności…')).toBeVisible();
    for (let i = 0; i < 21; i += 1) await page.clock.runFor(3000);
    await expect(page.getByText('Potwierdzenie może potrwać kilka minut. Sprawdź „Moje konto”.')).toBeVisible();
  });

  test('AC-12, AC-13, AC-15, SPEC-006 AC-12: „Twoje karnety”, „Historia karnetów”, „Historia płatności”', async ({ page }) => {
    const entries = await product('entries', 12000);
    const days = await product('days', 25000);
    const cancelledItem = await product('single_entry', 4000);
    const pendingItem = await product('single_entry', 3500);
    const userId = await newAccount(page);
    const entriesOrder = await order(userId, entries, 12000, true);
    await order(userId, days, 25000, true);
    const cancelledOrder = await order(userId, cancelledItem, 4000, true);
    await order(userId, pendingItem, 3500, false);
    const db = admin();
    await db.from('user_passes').update({ entries_left: 7 }).eq('order_id', entriesOrder);
    await db.from('user_passes').update({ status: 'cancelled' }).eq('order_id', cancelledOrder);

    await page.goto('/konto/');
    const passes = page.getByRole('region', { name: 'Twoje karnety' });
    const entriesPass = passes.getByRole('listitem').filter({ hasText: entries.name });
    await expect(entriesPass).toContainText('Pozostałe wejścia: 7 z 10');
    await expect(entriesPass).toContainText('Ważny do:');
    await expect(passes.getByRole('listitem').filter({ hasText: days.name })).toContainText(
      'Nieaktywny — dni liczą się od pierwszego wejścia',
    );
    // AC-15: anulowane tylko w zwiniętej historii
    await expect(passes.locator('[data-passes]').getByText(cancelledItem.name)).toHaveCount(0);
    const history = passes.locator('details');
    await expect(history.getByText(cancelledItem.name)).toBeHidden();
    await history.getByText('Historia karnetów').click();
    await expect(history.getByRole('listitem').filter({ hasText: cancelledItem.name })).toContainText('Anulowany');

    // AC-13: od najnowszych, metoda i status
    const rows = page.getByRole('region', { name: 'Historia płatności' }).getByRole('row');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(1)).toContainText(pendingItem.name);
    await expect(rows.nth(1)).toContainText('35,00 zł');
    await expect(rows.nth(1)).toContainText('Online');
    await expect(rows.nth(1)).toContainText('Oczekuje');
    await expect(rows.filter({ hasText: entries.name })).toContainText('Opłacone');
    // SPEC-006 AC-12: „Nr: SV-2026-000123” przy każdym zamówieniu.
    const { data: numbered } = await db.from('orders').select('order_number').eq('id', entriesOrder).single();
    await expect(rows.filter({ hasText: entries.name })).toContainText(`Nr: ${numbered!.order_number}`);
    await expect(rows.filter({ hasText: /Nr: SV-\d{4}-\d{6,}/ })).toHaveCount(4);
  });

  test('AC-14: „Przedłuż karnet” → /oferta/', async ({ page }) => {
    await newAccount(page);
    await page.goto('/konto/');
    await page.getByRole('link', { name: 'Przedłuż karnet' }).click();
    await expect(page).toHaveURL(/\/oferta\/$/);
  });
});
