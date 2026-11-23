import { expect, test, type Page } from '@playwright/test';
import { admin, ensureUser, hasLocalSupabase, signIn, signInAs, unique } from './support/supabase';

// SPEC-004 US-1, US-2 (AC-1…AC-9): faktura przy zakupie (zapisany NIP pobierany automatycznie, dane z rejestru bez potwierdzenia), „Dane do faktury” w `/konto/dane/`, status w „Historii płatności”,
// faktura przy sprzedaży na miejscu. `company-lookup` i `payments-create` są podmienione (`page.route`) — ich logikę
// sprawdzają testy Deno; zapis kopii w zamówieniu i `billing_details` — pgTAP (supabase/tests/022_invoices_test.sql).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PASSWORD = 'haslo-e2e-123';
const NIP = '5260250995';
const FIRM = { name: 'Firma Rejestrowa sp. z o.o.', address: 'ul. Prosta 1, 00-001 Warszawa' };

async function product(fields: Record<string, unknown> = { kind: 'entries', entries: 10 }, price = 12000): Promise<{ id: string; name: string }> {
  const name = unique('Faktura E2E');
  const db = admin();
  const { data, error } = await db.from('products').insert({ name, price, ...fields }).select('id').single();
  if (error) throw error;
  await db.from('products').update({ is_active: true }).eq('id', data.id);
  return { id: data.id as string, name };
}

/** Nowe konto z potwierdzoną klauzulą (zalogowane w `page`, jeśli podano). */
async function account(page?: Page, fullName?: string): Promise<string> {
  const email = `faktura-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  if (error) throw error;
  if (fullName) await admin().from('profiles').update({ full_name: fullName }).eq('id', data.user.id);
  if (page) await signInAs(page, email, PASSWORD);
  return data.user.id;
}

async function saveBilling(userId: string, name = 'Zapisana Firma S.A.'): Promise<void> {
  const { error } = await admin().from('billing_details').insert({
    user_id: userId,
    nip: NIP,
    company_name: name,
    company_address: 'ul. Zapisana 2, 30-001 Kraków',
    data_source: 'vat_whitelist',
    fetched_at: '2026-11-01T10:00:00Z',
  });
  if (error) throw error;
}

/** `company-lookup`: firma z rejestru albo brak; zwraca licznik wywołań. */
async function mockLookup(page: Page, found: boolean): Promise<{ count: number }> {
  const calls = { count: 0 };
  await page.route('**/functions/v1/company-lookup', async (route) => {
    calls.count += 1;
    await route.fulfill({
      json: found
        ? { found: true, name: FIRM.name, address: FIRM.address, source: 'vat_whitelist' }
        : { found: false, name: null, address: null, source: null },
    });
  });
  return calls;
}

async function mockPayment(page: Page): Promise<{ body: Record<string, unknown> }> {
  const sent = { body: {} as Record<string, unknown> };
  await page.route('**/functions/v1/payments-create', async (route) => {
    sent.body = route.request().postDataJSON();
    await route.fulfill({ json: { order_id: crypto.randomUUID(), payment_url: 'https://secure.sandbox.tpay.com/?title=TEST' } });
  });
  await page.route('https://secure.sandbox.tpay.com/**', (route) => route.fulfill({ body: 'Tpay' }));
  return sent;
}

test.describe('zakup online', () => {
  test('AC-1, AC-2, AC-3, AC-5, AC-6: NIP → dane z rejestru bez potwierdzenia → „Zapłać” z danymi faktury', async ({ page }) => {
    const item = await product();
    await account(page);
    const lookup = await mockLookup(page, true);
    const payment = await mockPayment(page);
    await page.goto(`/oferta/zamowienie/?product=${item.id}`);
    await page.getByLabel(/Akceptuję regulamin sprzedaży/).check();
    await page.getByLabel(/Chcę korzystać z karnetu/).check(); // SPEC-012 AC-6
    const pay = page.getByRole('button', { name: 'Zamawiam i płacę 120,00 zł' });
    await expect(pay).toBeEnabled();

    // AC-1, AC-6
    await page.getByLabel('Potrzebuję faktury').check();
    await expect(page.getByLabel('NIP *')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pobierz dane firmy' })).toBeVisible();
    await expect(pay).toBeDisabled();
    await expect(page.getByText('Potwierdź dane do faktury.')).toBeVisible();

    // AC-2: błędna suma kontrolna — bez zapytania do rejestru
    await page.getByLabel('NIP *').fill('526-025-09-96');
    await page.getByRole('button', { name: 'Pobierz dane firmy' }).click();
    await expect(page.getByText('Nieprawidłowy NIP.')).toBeVisible();
    expect(lookup.count).toBe(0);

    // AC-3: prefiks PL i myślniki dopuszczalne; dane z rejestru przyjęte od razu, ze źródłem
    await page.getByLabel('NIP *').fill('PL 526-025-09-95');
    await page.getByRole('button', { name: 'Pobierz dane firmy' }).click();
    await expect(page.getByText(FIRM.name)).toBeVisible();
    await expect(page.getByText(FIRM.address)).toBeVisible();
    await expect(page.getByText('Biała lista VAT')).toBeVisible();
    expect(lookup.count).toBe(1);
    await expect(page.getByRole('button', { name: 'Dane są poprawne' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Zmień dane do faktury' })).toBeVisible();
    await expect(pay).toBeEnabled();

    // AC-5: kopia danych w żądaniu do `payments-create`
    await pay.click();
    await expect(page).toHaveURL(/secure\.sandbox\.tpay\.com/);
    expect(payment.body.invoice).toMatchObject({
      nip: NIP,
      company_name: FIRM.name,
      company_address: FIRM.address,
      data_source: 'vat_whitelist',
    });
    expect(typeof (payment.body.invoice as { fetched_at: unknown }).fetched_at).toBe('string');
  });

  test('AC-1: zapisany NIP — wypełnia się sam, dane z rejestru pobierają się automatycznie', async ({ page }) => {
    const item = await product();
    const userId = await account(page);
    await saveBilling(userId);
    const lookup = await mockLookup(page, true);
    const payment = await mockPayment(page);
    await page.goto(`/oferta/zamowienie/?product=${item.id}`);
    await page.getByLabel(/Akceptuję regulamin sprzedaży/).check();
    await page.getByLabel(/Chcę korzystać z karnetu/).check(); // SPEC-012 AC-6
    expect(lookup.count).toBe(0); // rejestr dopiero po zaznaczeniu faktury
    await page.getByLabel('Potrzebuję faktury').check();
    await expect(page.getByText(FIRM.name)).toBeVisible(); // świeże dane z rejestru zamiast zapisanych
    expect(lookup.count).toBe(1);
    const pay = page.getByRole('button', { name: 'Zamawiam i płacę 120,00 zł' });
    await expect(pay).toBeEnabled();
    await pay.click();
    await expect(page).toHaveURL(/secure\.sandbox\.tpay\.com/);
    expect(payment.body.invoice).toMatchObject({ nip: NIP, company_name: FIRM.name, data_source: 'vat_whitelist' });
  });

  test('AC-1: rejestr nie zwraca danych — używane są zapisane dane', async ({ page }) => {
    const item = await product();
    const userId = await account(page);
    await saveBilling(userId);
    await mockLookup(page, false);
    const payment = await mockPayment(page);
    await page.goto(`/oferta/zamowienie/?product=${item.id}`);
    await page.getByLabel(/Akceptuję regulamin sprzedaży/).check();
    await page.getByLabel(/Chcę korzystać z karnetu/).check(); // SPEC-012 AC-6
    await page.getByLabel('Potrzebuję faktury').check();
    await expect(page.getByText('Zapisana Firma S.A.')).toBeVisible();
    await page.getByRole('button', { name: 'Zamawiam i płacę 120,00 zł' }).click();
    await expect(page).toHaveURL(/secure\.sandbox\.tpay\.com/);
    expect(payment.body.invoice).toMatchObject({ nip: NIP, company_name: 'Zapisana Firma S.A.', data_source: 'vat_whitelist' });
  });

  test('AC-4: firmy nie ma w rejestrze — wpis ręczny, źródło manual', async ({ page }) => {
    const item = await product();
    const userId = await account(page);
    await saveBilling(userId);
    await mockLookup(page, false);
    const payment = await mockPayment(page);
    await page.goto(`/oferta/zamowienie/?product=${item.id}`);
    await page.getByLabel(/Akceptuję regulamin sprzedaży/).check();
    await page.getByLabel(/Chcę korzystać z karnetu/).check(); // SPEC-012 AC-6
    await page.getByLabel('Potrzebuję faktury').check();
    await page.getByRole('button', { name: 'Zmień dane do faktury' }).click();
    await expect(page.getByLabel('NIP *')).toHaveValue(NIP);
    await page.getByRole('button', { name: 'Pobierz dane firmy' }).click();
    await expect(page.getByText('Nie znaleźliśmy firmy w rejestrze. Wpisz dane ręcznie.')).toBeVisible();
    await page.getByLabel('Nazwa *').fill('A');
    await page.getByLabel('Adres *', { exact: true }).fill('ul. Ręczna 3, Gliwice');
    await page.getByRole('button', { name: 'Dane są poprawne' }).click();
    await expect(page.getByText('Wpisz od 2 do 250 znaków.')).toBeVisible();
    await page.getByLabel('Nazwa *').fill('Firma Ręczna');
    await page.getByRole('button', { name: 'Dane są poprawne' }).click();
    await expect(page.getByText('Dane niezweryfikowane (wpisane ręcznie)')).toBeVisible();
    await page.getByRole('button', { name: 'Zamawiam i płacę 120,00 zł' }).click();
    await expect(page).toHaveURL(/secure\.sandbox\.tpay\.com/);
    expect(payment.body.invoice).toEqual({
      nip: NIP,
      company_name: 'Firma Ręczna',
      company_address: 'ul. Ręczna 3, Gliwice',
      data_source: 'manual',
      fetched_at: null,
    });
  });
});

test('AC-7: „Historia płatności” — „Faktura: w przygotowaniu” i „Faktura: <numer>”', async ({ page }) => {
  const userId = await account(page);
  const db = admin();
  const names: string[] = [];
  for (const number of [null, 'FV 7/11/2026']) {
    const item = await product();
    names.push(item.name);
    const { data, error } = await db
      .from('orders')
      .insert({ user_id: userId, product_id: item.id, item_name: item.name, amount: 12000, payment_method: 'tpay' })
      .select('id')
      .single();
    if (error) throw error;
    await db.rpc('fulfil_order', { p_order_id: data.id });
    const saved = await db.rpc('set_order_invoice_details', {
      p_order_id: data.id, p_nip: NIP, p_company_name: FIRM.name, p_company_address: FIRM.address, p_data_source: 'manual',
    });
    expect(saved.error).toBeNull();
    if (number) await db.from('orders').update({ invoice_number: number, invoice_issued_at: new Date().toISOString() }).eq('id', data.id);
  }
  await page.goto('/konto/');
  const rows = page.getByRole('region', { name: 'Historia płatności' }).getByRole('row');
  await expect(rows.filter({ hasText: names[0] })).toContainText('Faktura: w przygotowaniu');
  await expect(rows.filter({ hasText: names[1] })).toContainText('Faktura: FV 7/11/2026');
});

test('AC-8: „Dane do faktury” w /konto/dane/ — usunięcie i zapis nowych danych', async ({ page }) => {
  const userId = await account(page);
  await saveBilling(userId);
  await mockLookup(page, true);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/konto/dane/');
  const section = page.getByRole('region', { name: 'Dane do faktury' });
  await expect(section.getByText('Zapisana Firma S.A.')).toBeVisible();

  await section.getByRole('button', { name: 'Usuń dane do faktury' }).click();
  await expect(section.getByText('Nie masz zapisanych danych do faktury.')).toBeVisible();
  expect((await admin().from('billing_details').select('user_id').eq('user_id', userId)).data).toEqual([]);

  const save = section.getByRole('button', { name: 'Zapisz dane do faktury' });
  await expect(save).toBeDisabled();
  await section.getByLabel('NIP *').fill(NIP);
  await section.getByRole('button', { name: 'Pobierz dane firmy' }).click();
  await save.click();
  await expect(section.getByText('Zapisano dane do faktury.')).toBeVisible();
  const { data } = await admin().from('billing_details').select('nip, company_name, data_source').eq('user_id', userId).single();
  expect(data).toEqual({ nip: NIP, company_name: FIRM.name, data_source: 'vat_whitelist' });
});

test.describe('sprzedaż na miejscu', () => {
  test.beforeEach(async ({ page }) => {
    await ensureUser('staff');
    await signIn(page, 'staff');
  });

  test('AC-9: osoba z kontem — zapisany NIP pobiera się sam, kopia danych w zamówieniu', async ({ page }) => {
    const item = await product();
    const fullName = unique('Klient Firmowy');
    const userId = await account(undefined, fullName);
    await saveBilling(userId);
    await mockLookup(page, false); // rejestr bez danych — zostają zapisane `billing_details`

    await page.goto('/panel/sprzedaz/');
    await page.getByLabel('Imię i nazwisko lub e-mail').fill(fullName);
    await page.getByRole('button', { name: 'Szukaj' }).click();
    await page.getByRole('button', { name: `Wybierz: ${fullName}` }).click();
    await page.getByLabel('Produkt lub wejściówka *').selectOption({ label: `${item.name} — 120,00 zł` });
    await page.getByLabel('Gotówka').check();
    await page.getByLabel('Potrzebuję faktury').check();
    await expect(page.getByText('Zapisana Firma S.A.')).toBeVisible();
    await page.getByRole('button', { name: 'Zarejestruj sprzedaż' }).click();
    await expect(page.getByText(/^Sprzedaż zarejestrowana: SV-\d{4}-\d{6,}\.$/)).toBeVisible();

    const { data } = await admin()
      .from('orders')
      .select('invoice_requested, invoice_nip, invoice_company_name, invoice_data_source')
      .eq('user_id', userId)
      .single();
    expect(data).toEqual({ invoice_requested: true, invoice_nip: NIP, invoice_company_name: 'Zapisana Firma S.A.', invoice_data_source: 'vat_whitelist' });
  });

  test('AC-9: osoba bez konta — dane firmy tylko w zamówieniu', async ({ page }) => {
    const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(new Date());
    const item = await product({ kind: 'single_entry', day_type: day === 'Sat' || day === 'Sun' ? 'weekend' : 'weekday' }, 4000);
    await mockLookup(page, true);

    await page.goto('/panel/sprzedaz/');
    await page.getByLabel('Osoba bez konta').check();
    await page.getByLabel('Produkt lub wejściówka *').selectOption({ label: `${item.name} — 40,00 zł` });
    await page.getByLabel('Terminal').check();
    await page.getByLabel('Potrzebuję faktury').check();
    await page.getByLabel('NIP *').fill(NIP);
    await page.getByRole('button', { name: 'Pobierz dane firmy' }).click();
    await page.getByRole('button', { name: 'Zarejestruj sprzedaż' }).click();
    await expect(page.getByText(/^Sprzedaż zarejestrowana: SV-\d{4}-\d{6,}\.$/)).toBeVisible();

    const { data } = await admin().from('orders').select('user_id, invoice_nip, invoice_company_name').eq('item_name', item.name).single();
    expect(data).toEqual({ user_id: null, invoice_nip: NIP, invoice_company_name: FIRM.name });
  });
});
