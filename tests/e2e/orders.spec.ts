import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-003 US-6 (AC-24…AC-27): zamówienia w `/panel/zamowienia/` (admin).
// Reguły bazy (filtry, zwrot Tpay, cofnięcie) sprawdza też pgTAP: supabase/tests/017_orders_admin_refund_test.sql;
// Edge Function `payments-refund` — testy Deno (bez edge-runtime w CI odpowiedź funkcji jest tu zamockowana).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

interface Seeded {
  item: string;
  person: string;
  orderId: string;
  orderNumber: string;
}

/**
 * Opłacone zamówienie z uprawnieniem (`fulfil_order` kluczem secret) dla nowej osoby.
 * `paidDaysAgo` — przesunięcie `paid_at` (SPEC-012: okno 14 dni od opłacenia), `entries` — wejścia karnetu.
 */
async function seedOrder(method: 'tpay' | 'on_site', amount: number, { paidDaysAgo = 0, entries = 5 } = {}): Promise<Seeded> {
  const db = admin();
  const item = unique('Karnet zwrot E2E');
  const person = unique('Ewa Zwrotna');
  const { data: user, error: userError } = await db.auth.admin.createUser({
    email: `${unique('zwrot').replace(/\s/g, '-')}@example.test`,
    email_confirm: true,
  });
  expect(userError).toBeNull();
  const userId = user.user!.id;
  expect((await db.from('profiles').update({ full_name: person }).eq('id', userId)).error).toBeNull();
  const { data: product } = await db.from('products').insert({ kind: 'entries', name: item, price: amount, entries })
    .select('id').single();
  const { data: order, error } = await db.from('orders').insert({
    user_id: userId,
    product_id: product!.id,
    item_name: item,
    amount,
    payment_method: method,
    on_site_method: method === 'on_site' ? 'cash' : null,
    tpay_transaction_id: method === 'tpay' ? unique('TX').replace(/\s/g, '') : null,
  }).select('id, order_number').single();
  expect(error).toBeNull();
  expect((await db.rpc('fulfil_order', { p_order_id: order!.id })).error).toBeNull();
  if (paidDaysAgo) {
    const paidAt = new Date(Date.now() - paidDaysAgo * 24 * 60 * 60 * 1000).toISOString();
    expect((await db.from('orders').update({ paid_at: paidAt }).eq('id', order!.id)).error).toBeNull();
  }
  return { item, person, orderId: order!.id, orderNumber: order!.order_number };
}

const rowOf = (page: Page, item: string) => page.getByRole('row').filter({ hasText: item });

async function filterByPerson(page: Page, person: string): Promise<void> {
  await page.getByLabel('Osoba lub nr zamówienia').fill(person);
  await page.getByRole('button', { name: 'Pokaż' }).click();
}

test.describe('admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-24: filtry, suma i eksport CSV bieżącego widoku', async ({ page }) => {
    const first = await seedOrder('on_site', 4321);
    const other = await seedOrder('tpay', 9900);

    await page.goto('/panel/zamowienia/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zamówienia');
    await expect(page.getByRole('navigation', { name: 'Menu panelu' }).getByRole('link', { name: 'Zamówienia' })).toBeVisible();
    await expect(rowOf(page, first.item)).toBeVisible();
    await expect(rowOf(page, other.item)).toBeVisible();

    await filterByPerson(page, first.person);
    await expect(rowOf(page, other.item)).toHaveCount(0);
    await expect(rowOf(page, first.item)).toContainText('Na miejscu / gotówka');
    await expect(page.getByText('Zamówień: 1. Suma: 43,21 zł')).toBeVisible();

    await page.getByLabel('Metoda').selectOption({ label: 'Online' });
    await page.getByRole('button', { name: 'Pokaż' }).click();
    await expect(page.getByText('Brak zamówień dla wybranych filtrów.')).toBeVisible();

    await page.getByLabel('Metoda').selectOption({ label: 'Wszystkie' });
    await page.getByRole('button', { name: 'Pokaż' }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Eksportuj CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^zamowienia-\d{4}-\d{2}-01-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv).toContain('"Numer zamówienia";"Data";"Produkt";"Kwota"');
    expect(csv).toContain(`"${first.item}";"43,21"`);
    expect(csv).toMatch(new RegExp(`"${first.orderNumber}";"[^"]+";"${first.item}"`));
    expect(csv).not.toContain(other.item);
  });

  test('SPEC-006 AC-9, AC-10, AC-11: kolumna „Nr zamówienia” i wyszukiwanie po numerze', async ({ page }) => {
    const sale = await seedOrder('on_site', 3100);
    const other = await seedOrder('tpay', 3200);
    await page.goto('/panel/zamowienia/');
    await expect(page.getByRole('columnheader', { name: 'Nr zamówienia' })).toBeVisible();
    await expect(rowOf(page, sale.item)).toContainText(sale.orderNumber);

    // AC-10: mała litera, spacje, bez zer wiodących; zakres dat i metoda pomijane.
    const [, year, counter] = /^SV-(\d{4})-(\d+)$/.exec(sale.orderNumber)!;
    await page.getByLabel('Od dnia').fill('2099-01-01');
    await page.getByLabel('Metoda').selectOption({ label: 'Online' });
    await filterByPerson(page, `  sv-${year}-${Number(counter)}  `);
    await expect(page.getByText('Wynik wyszukiwania po numerze zamówienia — pozostałe filtry pominięte.')).toBeVisible();
    await expect(rowOf(page, sale.item)).toBeVisible();
    await expect(rowOf(page, other.item)).toHaveCount(0);

    await filterByPerson(page, 'SV-1999-999999');
    await expect(page.getByText('Brak zamówienia o tym numerze.')).toBeVisible();
    await expect(page.getByText('Brak zamówień dla wybranych filtrów.')).toBeHidden();

    // AC-11: tekst bez formy numeru — wyszukiwanie po osobie (z pozostałymi filtrami).
    await page.getByLabel('Od dnia').fill('');
    await page.getByLabel('Metoda').selectOption({ label: 'Wszystkie' });
    await filterByPerson(page, sale.person);
    await expect(rowOf(page, sale.item)).toBeVisible();
    await expect(page.getByText('Wynik wyszukiwania po numerze zamówienia', { exact: false })).toBeHidden();

    await rowOf(page, sale.item).getByRole('button', { name: /^Anuluj i zwróć/ }).click();
    await expect(page.getByRole('dialog', { name: 'Anuluj i zwróć' })).toContainText(`Zamówienie ${sale.orderNumber}:`);
  });

  test('AC-25, AC-27: „Anuluj i zwróć” na miejscu — od razu zwrócone, wpis w audit_log', async ({ page }) => {
    const sale = await seedOrder('on_site', 5000);
    await page.goto('/panel/zamowienia/');
    await filterByPerson(page, sale.person);

    await rowOf(page, sale.item).getByRole('button', { name: `Anuluj i zwróć: ${sale.item}, 50,00 zł` }).click();
    const dialog = page.getByRole('dialog', { name: 'Anuluj i zwróć' });
    await expect(dialog).toContainText('Oddaj 50,00 zł gotówką lub na terminal');
    // SPEC-012 AC-22: na miejscu w oknie 14 dni — bez ostrzeżenia, notatka wymagana.
    await expect(dialog.getByText('Minęło 14 dni od zakupu.', { exact: false })).toBeHidden();
    await dialog.getByLabel('Notatka * (3–300 znaków)').fill('Gotówka oddana');
    await dialog.getByRole('button', { name: 'Potwierdź zwrot' }).click();

    await expect(page.getByText('Zamówienie zwrócone. Oddaj pieniądze klientowi.')).toBeVisible();
    await expect(rowOf(page, sale.item)).toContainText('Zwrócone');
    await expect(rowOf(page, sale.item)).toContainText('Gotówka oddana');
    await expect(rowOf(page, sale.item).getByRole('button')).toHaveCount(0);

    const db = admin();
    const { data: pass } = await db.from('user_passes').select('status').eq('order_id', sale.orderId).single();
    expect(pass).toEqual({ status: 'cancelled' });
    const { data: log } = await db.from('audit_log').select('actor_id, changes').eq('action', 'order_refund')
      .eq('changes->>order_id', sale.orderId);
    expect(log).toHaveLength(1);
    expect(log![0].actor_id).not.toBeNull();
    expect(log![0].changes).toMatchObject({ amount: 5000, refund_amount: 5000 });
  });

  test('AC-25, SPEC-012 AC-21: „Anuluj i zwróć” online po 14 dniach — ostrzeżenie, wymagana notatka, payments-refund', async ({ page }) => {
    const sale = await seedOrder('tpay', 12000, { paidDaysAgo: 20 });
    let body: unknown = null;
    // Bez edge-runtime: odpowiedź funkcji zamockowana; zmiana stanu jak w `cancel_order` (refund_pending).
    await page.route('**/functions/v1/payments-refund', async (route) => {
      body = route.request().postDataJSON();
      await admin().from('orders').update({ status: 'refund_pending' }).eq('id', sale.orderId);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'refund_pending' }) });
    });
    await page.goto('/panel/zamowienia/');
    await filterByPerson(page, sale.person);

    await rowOf(page, sale.item).getByRole('button', { name: /^Anuluj i zwróć/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Anuluj i zwróć' });
    await expect(dialog).toContainText('Tpay zwróci 120,00 zł');
    await expect(dialog).toContainText(
      'Minęło 14 dni od zakupu. Regulamin nie przewiduje zwrotu — zwróć tylko w uzasadnionym przypadku (np. reklamacja).',
    );
    const note = dialog.getByLabel('Notatka * (3–300 znaków)');
    await expect(note).toHaveAttribute('required', '');
    await note.fill('Reklamacja klienta');
    await dialog.getByRole('button', { name: 'Potwierdź zwrot' }).click();

    await expect(page.getByText('Zlecono zwrot w Tpay.', { exact: false })).toBeVisible();
    expect(body).toEqual({ order_id: sale.orderId, refund_note: 'Reklamacja klienta' });
    await expect(rowOf(page, sale.item)).toContainText('Zwrot w toku');
  });

  test('AC-26: karnet używany po 14 dniach — bez „Anuluj i zwróć”, informacja o zwrocie poza systemem', async ({ page }) => {
    const sale = await seedOrder('tpay', 7000, { paidDaysAgo: 20 });
    expect((await admin().from('user_passes').update({ entries_left: 4 }).eq('order_id', sale.orderId)).error).toBeNull();
    await page.goto('/panel/zamowienia/');
    await filterByPerson(page, sale.person);

    await expect(rowOf(page, sale.item)).toContainText('Karnet był używany — zwrot poza systemem.');
    await expect(rowOf(page, sale.item).getByRole('button', { name: /Anuluj i zwróć/ })).toHaveCount(0);
    await expect(rowOf(page, sale.item).getByRole('button', { name: /Odstąpienie od umowy/ })).toHaveCount(0);
  });

  test('SPEC-012 AC-15…AC-20: odstąpienie w oknie — wyliczenie, „Zleć zwrot” (mode withdrawal), zwrot częściowy', async ({ page }) => {
    const sale = await seedOrder('tpay', 10000, { entries: 3 });
    expect((await admin().from('user_passes').update({ entries_left: 2 }).eq('order_id', sale.orderId)).error).toBeNull();
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
    const [year, month, day] = today.split('-');
    const last = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 14));
    const until = `${last.getUTCDate()}.${String(last.getUTCMonth() + 1).padStart(2, '0')}.${last.getUTCFullYear()}`;
    let body: unknown = null;
    // Bez edge-runtime: odpowiedź funkcji zamockowana; zmiana stanu jak w `withdraw_order`.
    await page.route('**/functions/v1/payments-refund', async (route) => {
      body = route.request().postDataJSON();
      await admin().from('orders').update({ status: 'refund_pending', refund_amount: 6667, withdrawal_on: today })
        .eq('id', sale.orderId);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'refund_pending' }) });
    });
    await page.goto('/panel/zamowienia/');
    await filterByPerson(page, sale.person);

    const row = rowOf(page, sale.item);
    await expect(row).toContainText(`Odstąpienie możliwe do ${until}`);
    await expect(row.getByRole('button', { name: /Anuluj i zwróć/ })).toHaveCount(0);
    await row.getByRole('button', { name: `Odstąpienie od umowy: zamówienie ${sale.orderNumber}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Odstąpienie od umowy' });
    await expect(dialog.getByLabel('Dzień odstąpienia *')).toHaveValue(today);
    await expect(dialog).toContainText('Cena 100,00 zł, wykorzystano 1 z 3 wejść (33,33 zł). Zwrot: 66,67 zł.');
    await dialog.getByRole('button', { name: 'Zleć zwrot' }).click();

    await expect(page.getByText('Zlecono zwrot 66,67 zł w Tpay.', { exact: false })).toBeVisible();
    expect(body).toEqual({ order_id: sale.orderId, mode: 'withdrawal', withdrawal_on: today, refund_note: null });
    await expect(row).toContainText('Zwrot w toku: 66,67 zł');
    await expect(page.getByText('Zwroty: −66,67 zł', { exact: false })).toBeVisible();
  });

  test('SPEC-012 AC-18: usługa wykonana w całości — „Odstąpienie od umowy” nieaktywne', async ({ page }) => {
    const sale = await seedOrder('tpay', 9000, { entries: 3 });
    expect((await admin().from('user_passes').update({ entries_left: 0 }).eq('order_id', sale.orderId)).error).toBeNull();
    await page.goto('/panel/zamowienia/');
    await filterByPerson(page, sale.person);

    const row = rowOf(page, sale.item);
    await expect(row.getByRole('button', { name: /Odstąpienie od umowy/ })).toBeDisabled();
    await expect(row).toContainText('Usługa wykonana w całości — prawo odstąpienia wygasło.');
  });
});

test('AC-24: obsługa nie ma dostępu do zamówień', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/panel/zamowienia/');
  await expect(page.getByRole('heading', { level: 1, name: 'Zamówienia' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Menu panelu' }).getByRole('link', { name: 'Zamówienia' })).toHaveCount(0);
});
