import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { admin, hasLocalSupabase, signIn, signInAs, unique } from './support/supabase';

// SPEC-012 US-9 (AC-46…AC-50, AC-55): „Odstąp od umowy” w `/konto/` i zgłoszenia w `/panel/zamowienia/`.
// Reguły bazy (okno, kwota, błędy, AC-52) sprawdza pgTAP: supabase/tests/041_withdrawal_requests_test.sql.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PASSWORD = 'Haslo-E2E-odstapienie-1';

interface Seeded {
  email: string;
  orderId: string;
  orderNumber: string;
  item: string;
}

/** Klient z hasłem i opłaconym online zamówieniem na produkt (`fulfil_order` kluczem secret). */
async function seedClient(kind: 'entries' | 'days', amount: number): Promise<Seeded> {
  const db = admin();
  const item = unique(kind === 'entries' ? 'Karnet odstąpienie E2E' : 'Karnet czasowy odstąpienie E2E');
  const email = `${unique('odstapienie').replace(/\s/g, '-')}@example.test`;
  const { data: user, error: userError } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  expect(userError).toBeNull();
  const { data: product, error: productError } = await db.from('products')
    .insert(kind === 'entries' ? { kind, name: item, price: amount, entries: 3 } : { kind, name: item, price: amount, days: 30 })
    .select('id').single();
  expect(productError).toBeNull();
  const { data: order, error } = await db.from('orders').insert({
    user_id: user.user!.id,
    product_id: product!.id,
    item_name: item,
    amount,
    payment_method: 'tpay',
    tpay_transaction_id: unique('TX').replace(/\s/g, ''),
  }).select('id, order_number').single();
  expect(error).toBeNull();
  expect((await db.rpc('fulfil_order', { p_order_id: order!.id })).error).toBeNull();
  return { email, orderId: order!.id, orderNumber: order!.order_number, item };
}

const rowOf = (page: Page, item: string) => page.getByRole('row').filter({ hasText: item });

test('SPEC-012 AC-46…AC-48: klient wysyła oświadczenie, karnet przestaje działać', async ({ page }) => {
  const sale = await seedClient('entries', 10000);
  expect((await admin().from('user_passes').update({ entries_left: 2 }).eq('order_id', sale.orderId)).error).toBeNull();
  await signInAs(page, sale.email, PASSWORD);
  await page.goto('/konto/');

  const row = rowOf(page, sale.item);
  await row.getByRole('button', { name: `Odstąp od umowy: zamówienie ${sale.orderNumber}` }).click();
  const dialog = page.getByRole('dialog', { name: 'Odstąpienie od umowy' });
  await expect(dialog).toContainText(`Odstępuję od umowy zakupu ${sale.item} (zamówienie ${sale.orderNumber}, opłacone`);
  await expect(dialog).toContainText('Cena 100,00 zł, wykorzystano 1 z 3 wejść (33,33 zł). Zwrot: 66,67 zł.');
  await expect(dialog).toContainText('Od chwili wysłania karnet przestaje działać.');
  await dialog.getByLabel('Uwagi (opcjonalnie, do 500 znaków)').fill('Zmiana planów');
  await dialog.getByRole('button', { name: 'Wyślij oświadczenie' }).click();

  await expect(page.getByText('Oświadczenie wysłane. Zwrot 66,67 zł otrzymasz w ciągu 14 dni.')).toBeVisible();
  await expect(row.getByRole('button', { name: /Odstąp od umowy/ })).toHaveCount(0);
  await expect(row).toContainText('Odstąpienie zgłoszone');
  const { data: pass } = await admin().from('user_passes').select('status').eq('order_id', sale.orderId).single();
  expect(pass!.status).toBe('cancelled');
});

test('SPEC-012 AC-55: karnet czasowy — bez „Odstąp od umowy”', async ({ page }) => {
  // Karnet czasowy sprzedany przed wycofaniem (AC-53: produkt `days` tylko kluczem secret).
  const sale = await seedClient('days', 30000);
  await signInAs(page, sale.email, PASSWORD);
  await page.goto('/konto/');
  await expect(rowOf(page, sale.item)).toBeVisible();
  await expect(rowOf(page, sale.item).getByRole('button', { name: /Odstąp od umowy/ })).toHaveCount(0);
});

test('SPEC-012 AC-49: panel — filtr „Zgłoszone odstąpienia” i „Zleć zwrot” kwoty ze zgłoszenia', async ({ page }) => {
  const sale = await seedClient('entries', 10000);
  // Zgłoszenie jak z /konto/: `submit_withdrawal` z sesją klienta.
  const db = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  expect((await db.auth.signInWithPassword({ email: sale.email, password: PASSWORD })).error).toBeNull();
  const submitted = await db.rpc('submit_withdrawal', { p_order_id: sale.orderId, p_comment: null });
  expect(submitted.error).toBeNull();
  expect(submitted.data).toBe(10000);

  let body: unknown = null;
  // Bez edge-runtime: odpowiedź funkcji zamockowana; zmiana stanu jak w `withdraw_order` (gałąź zgłoszenia).
  await page.route('**/functions/v1/payments-refund', async (route) => {
    body = route.request().postDataJSON();
    await admin().from('orders').update({ status: 'refund_pending' }).eq('id', sale.orderId);
    await admin().from('withdrawal_requests').update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('order_id', sale.orderId);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'refund_pending' }) });
  });
  await signIn(page, 'admin');
  await page.goto('/panel/zamowienia/');
  await page.getByLabel('Status').selectOption({ label: 'Zgłoszone odstąpienia' });
  await page.getByRole('button', { name: 'Pokaż' }).click();

  const row = rowOf(page, sale.item);
  await expect(row).toContainText(/Odstąpienie zgłoszone \d{1,2}\.\d{2}\.\d{4} — zwróć do \d{1,2}\.\d{2}\.\d{4}/);
  await row.getByRole('button', { name: new RegExp(`Zleć zwrot 100,00\\s*zł: zamówienie ${sale.orderNumber}`) }).click();
  // Po zleceniu zgłoszenie znika z filtra (→ `processed`).
  await expect(page.getByText('Zlecono zwrot', { exact: false })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(body).toEqual({ order_id: sale.orderId, mode: 'withdrawal', withdrawal_on: null, refund_note: null });
});
