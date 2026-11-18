import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-004 US-3 (AC-10…AC-16): panel faktur `/panel/faktury/` i „Dodaj dane do faktury” w `/panel/zamowienia/`.
// Reguły bazy (zakładki, zakres dat, uprawnienia) sprawdza też pgTAP: supabase/tests/024_invoices_admin_test.sql.
// `company-lookup` jest podmieniony (`page.route`) — jego logikę sprawdzają testy Deno.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const NIP = '5260250274';

interface Seeded {
  orderId: string;
  orderNumber: string;
  userId: string;
  person: string;
  company: string;
}

/** Opłacone zamówienie na miejscu (gotówka, 120,00 zł), opcjonalnie z danymi faktury wpisanymi ręcznie. */
async function seedOrder(withInvoice: boolean): Promise<Seeded> {
  const db = admin();
  const person = unique('Faktura Panel');
  const company = unique('Firma Panel');
  const { data: user, error: userError } = await db.auth.admin.createUser({
    email: `${unique('fpanel').replace(/\s/g, '-')}@example.test`,
    email_confirm: true,
  });
  expect(userError).toBeNull();
  const userId = user.user!.id;
  await db.from('profiles').update({ full_name: person }).eq('id', userId);
  const { data: product } = await db.from('products').insert({ kind: 'entries', name: unique('Karnet FP'), price: 12000, entries: 5 })
    .select('id, name').single();
  const { data: order, error } = await db.from('orders').insert({
    user_id: userId, product_id: product!.id, item_name: product!.name, amount: 12000,
    payment_method: 'on_site', on_site_method: 'cash',
  }).select('id, order_number').single();
  expect(error).toBeNull();
  expect((await db.rpc('fulfil_order', { p_order_id: order!.id })).error).toBeNull();
  if (withInvoice) {
    const { error: invoiceError } = await db.rpc('set_order_invoice_details', {
      p_order_id: order!.id, p_nip: NIP, p_company_name: company, p_company_address: 'ul. Panelowa 1, 00-001 Warszawa',
      p_data_source: 'manual',
    });
    expect(invoiceError).toBeNull();
  }
  return { orderId: order!.id, orderNumber: order!.order_number, userId, person, company };
}

const itemOf = (page: Page, company: string) => page.getByRole('listitem').filter({ hasText: company });

test.describe('admin', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page, 'admin');
  });

  test('AC-10, AC-11, AC-12, AC-13, AC-15, SPEC-006 AC-7, AC-8: lista, kopiowanie, eksport, oznaczenie i cofnięcie', async ({ page }) => {
    const seeded = await seedOrder(true);
    await page.goto('/panel/faktury/');

    // AC-10: pozycja „Do wystawienia” z oznaczeniem danych wpisanych ręcznie; licznik w menu.
    const item = itemOf(page, seeded.company);
    await expect(item).toContainText(NIP);
    await expect(item).toContainText('120,00');
    await expect(item).toContainText('Dane niezweryfikowane');
    // SPEC-006 AC-7: numer zamówienia w nagłówku pozycji, obok daty zapłaty.
    await expect(item.locator('summary')).toContainText(seeded.orderNumber);
    await expect(page.getByRole('link', { name: /Faktury/ })).toContainText(/\(\d+\)/);

    // AC-11: rozwinięcie, dane do skopiowania, „Kopiuj” → schowek i „Skopiowano”.
    await item.locator('summary').click();
    await expect(item).toContainText('gotówka');
    await expect(item).not.toContainText(seeded.orderId);
    await item.getByRole('button', { name: 'Kopiuj: Numer zamówienia' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(seeded.orderNumber);
    await item.getByRole('button', { name: 'Kopiuj: NIP' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Skopiowano' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(NIP);

    // AC-15: eksport CSV (BOM, średnik, kolumny z AC-11 + numery).
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Eksport CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('faktury-do-wystawienia.csv');
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv.startsWith('﻿"NIP";"Nazwa nabywcy";"Adres"')).toBe(true);
    expect(csv).toContain('"Numer faktury";"Numer KSeF"');
    expect(csv).toContain(`"${NIP}";"${seeded.company}"`);
    expect(csv).toContain(`"${seeded.orderNumber}";""`);

    // AC-12: walidacja i oznaczenie jako wystawionej.
    await item.getByLabel('Numer KSeF').fill('zly-numer');
    await item.getByRole('button', { name: 'Oznacz jako wystawioną' }).click();
    await expect(item).toContainText('Wpisz numer faktury');
    await item.getByLabel('Numer faktury *').fill('FV 7/11/2026');
    await item.getByLabel('Numer KSeF').fill('5260250274-20261118-0100A0B1C2D3-E4');
    await item.getByRole('button', { name: 'Oznacz jako wystawioną' }).click();
    await expect(page.getByText('Oznaczono fakturę jako wystawioną.')).toBeVisible();
    await expect(itemOf(page, seeded.company)).toHaveCount(0);

    await page.getByRole('button', { name: 'Wystawione' }).click();
    const issued = itemOf(page, seeded.company);
    await expect(issued).toContainText('FV 7/11/2026');
    await issued.locator('summary').click();
    await expect(issued).toContainText('oznaczył(a)');

    // AC-13: cofnięcie oznaczenia.
    page.once('dialog', (dialog) => dialog.accept());
    await issued.getByRole('button', { name: 'Cofnij oznaczenie' }).click();
    await expect(page.getByText('Cofnięto oznaczenie.')).toBeVisible();
    await expect(itemOf(page, seeded.company)).toHaveCount(0);
    await page.getByRole('button', { name: 'Do wystawienia' }).click();
    await expect(itemOf(page, seeded.company)).toHaveCount(1);

    const { data: audit } = await admin().from('audit_log').select('action').eq('changes->>order_id', seeded.orderId)
      .order('created_at');
    expect(audit?.map((row) => row.action)).toEqual(['invoice_issued', 'invoice_unmarked']);
  });

  test('AC-16: zwrot — ostrzeżenie przy wystawionej, niewystawiona znika z „Do wystawienia”', async ({ page }) => {
    const issued = await seedOrder(true);
    const pending = await seedOrder(true);
    const db = admin();
    await db.from('orders').update({ invoice_number: 'FV 8/11/2026', invoice_issued_at: new Date().toISOString() })
      .eq('id', issued.orderId);
    await db.from('orders').update({ status: 'refunded', refunded_at: new Date().toISOString() })
      .in('id', [issued.orderId, pending.orderId]);

    await page.goto('/panel/faktury/');
    await expect(page.getByText('Pozycji:')).toBeVisible();
    await expect(itemOf(page, pending.company)).toHaveCount(0);
    await page.getByRole('button', { name: 'Wystawione' }).click();
    await expect(itemOf(page, issued.company)).toContainText('Zwrot — sprawdź, czy potrzebna jest korekta w e-mikrofirmie.');
  });

  test('AC-14: „Dodaj dane do faktury” do opłaconego zamówienia bez nadpisywania billing_details', async ({ page }) => {
    const seeded = await seedOrder(false);
    await page.route('**/functions/v1/company-lookup', (route) =>
      route.fulfill({ json: { found: true, name: seeded.company, address: 'ul. Rejestrowa 5, 00-001 Warszawa', source: 'vat_whitelist' } }));
    await page.goto('/panel/zamowienia/');
    await page.getByLabel('Osoba lub nr zamówienia').fill(seeded.person);
    await page.getByRole('button', { name: 'Pokaż' }).click();
    // „Pokaż” przeładowuje listę asynchronicznie — do tego czasu widać zamówienia z innych testów, więc szukamy w wierszu tej osoby.
    await page.getByRole('row').filter({ hasText: seeded.person })
      .getByRole('button', { name: /^Dodaj dane do faktury:/ }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('NIP *').fill('526-025-02-75');
    await dialog.getByRole('button', { name: 'Pobierz dane firmy' }).click();
    await expect(dialog.getByText('Nieprawidłowy NIP.')).toBeVisible();
    await dialog.getByLabel('NIP *').fill(NIP);
    await dialog.getByRole('button', { name: 'Pobierz dane firmy' }).click();
    await dialog.getByRole('button', { name: 'Dane są poprawne' }).click();
    await dialog.getByRole('button', { name: 'Zapisz i dodaj do „Do wystawienia”' }).click();
    await expect(page.getByText('Dodano dane do faktury.')).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: seeded.person })).toContainText('Faktura zamówiona');

    const db = admin();
    const { data: order } = await db.from('orders').select('invoice_requested, invoice_company_name, invoice_data_source')
      .eq('id', seeded.orderId).single();
    expect(order).toEqual({ invoice_requested: true, invoice_company_name: seeded.company, invoice_data_source: 'vat_whitelist' });
    const { count } = await db.from('billing_details').select('user_id', { count: 'exact', head: true }).eq('user_id', seeded.userId);
    expect(count).toBe(0);

    await page.goto('/panel/faktury/');
    await expect(itemOf(page, seeded.company)).toContainText(NIP);
  });
});
