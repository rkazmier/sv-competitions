import { expect, test, type Page } from '@playwright/test';
import { admin, ensureRangeDuty, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-005 US-5, US-6 (AC-13…AC-20): ekran podpisu, zapis wpisu z zużyciem, osoba bez konta ze sprzedażą
// na miejscu, osoba towarzysząca. Reguły bazy (transakcja, blokada, zużycie): pgTAP 013_range_log_test.sql.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const todayType = () => {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(new Date());
  return day === 'Sat' || day === 'Sun' ? 'weekend' : 'weekday';
};

const ADDRESS = 'ul. Stalowa 1, Katowice';

/** Osoba z kontem i karnetem 5 wejść (opłacony kluczem secret). */
async function seedPersonWithPass(): Promise<{ id: string; fullName: string; passId: string; passName: string }> {
  const db = admin();
  const { data, error } = await db.auth.admin.createUser({ email: `${unique('podpis').replace(/\s/g, '-')}@example.test`, email_confirm: true });
  expect(error).toBeNull();
  const id = data.user!.id;
  const fullName = unique('Jan Podpisujący');
  await db.from('profiles').update({ full_name: fullName, address: ADDRESS }).eq('id', id);
  const passName = unique('Karnet 5 wejść');
  const { data: product } = await db.from('products').insert({ kind: 'entries', name: passName, price: 1000, entries: 5 }).select('id').single();
  const { data: order } = await db
    .from('orders')
    .insert({ user_id: id, product_id: product!.id, item_name: passName, amount: 1000, payment_method: 'on_site', on_site_method: 'cash' })
    .select('id')
    .single();
  expect((await db.rpc('fulfil_order', { p_order_id: order!.id })).error).toBeNull();
  const { data: pass } = await db.from('user_passes').select('id').eq('order_id', order!.id).single();
  return { id, fullName, passId: pass!.id as string, passName };
}

/** Dyżurny Prowadzący (SPEC-007 AC-16) — domyślny Prowadzący każdego wpisu. */
async function openRangeLog(page: Page, path: string): Promise<string> {
  const officer = await ensureRangeDuty();
  await page.goto(path);
  await expect(page.getByRole('main').getByText('Dyżurny:')).toContainText(officer);
  return officer;
}

/** Podpis myszą: `steps` ruchów = tyle punktów ścieżki (+1 za naciśnięcie). */
async function drawSignature(page: Page, steps = 30): Promise<void> {
  const box = (await page.getByRole('img', { name: /Pole podpisu/ }).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 40, { steps });
  await page.mouse.up();
}

const save = (page: Page) => page.getByRole('button', { name: 'Zapisz wpis' });
const guestForm = (page: Page) => page.locator('[data-guest]');

test.describe('obsługa — podpis i zapis wpisu', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'staff');
  });

  test('AC-13…AC-17, AC-20: podpis, zapis z zużyciem karnetu, potem osoba towarzysząca bez konta', async ({ page }) => {
    const person = await seedPersonWithPass();
    const officer = await openRangeLog(page, `/panel/ksiazka/?osoba=${person.id}`);
    await page.getByRole('button', { name: 'Dalej' }).click();

    // AC-13: dane wpisu, regulamin (tekst zastępczy), zdanie nad polem podpisu; bez nawigacji panelu.
    const sign = page.locator('[data-sign]');
    await expect(sign.getByRole('heading', { name: 'Wpis do książki rejestru pobytu' })).toBeVisible();
    await expect(sign.locator('[data-sign-field="time"]')).toHaveText(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
    await expect(sign.locator('[data-sign-field="name"]')).toHaveText(person.fullName);
    await expect(sign.locator('[data-sign-field="permit"]')).toHaveText(ADDRESS);
    await expect(sign.locator('[data-sign-field="officer"]')).toHaveText(officer);
    await expect(sign.getByRole('heading', { name: 'Regulamin strzelnicy' })).toBeVisible();
    await expect(sign.getByRole('region', { name: 'Regulamin strzelnicy' })).toContainText('[TEKST DO UZUPEŁNIENIA]');
    await expect(sign.getByText('Podpisując, potwierdzasz zapoznanie się z regulaminem strzelnicy.')).toBeVisible();
    await expect(sign.getByRole('heading', { name: 'Klauzula informacyjna' })).toBeHidden();
    await expect(page.locator('.site-header')).toBeHidden();

    // AC-14: pusty / za krótki podpis → nieaktywny; „Wyczyść” czyści.
    await expect(save(page)).toBeDisabled();
    await drawSignature(page, 5);
    await expect(save(page)).toBeDisabled();
    await drawSignature(page);
    await expect(save(page)).toBeEnabled();
    await page.getByRole('button', { name: 'Wyczyść' }).click();
    await expect(save(page)).toBeDisabled();
    await drawSignature(page);

    // AC-15, AC-17
    await save(page).click();
    await expect(page.getByText(new RegExp(`^Wpisano do książki: ${person.fullName}, \\d{2}:\\d{2}\\.$`))).toBeVisible();
    await expect(page.locator('.site-header')).toBeVisible();
    const db = admin();
    const { data: entry } = await db.from('range_log').select('*').eq('profile_id', person.id).single();
    expect(entry).toMatchObject({ full_name: person.fullName, address: ADDRESS, range_officer_name: officer, is_companion: false });
    expect(entry!.signature_path).toMatch(new RegExp(`^\\d{4}/\\d{2}/${entry!.id}\\.png$`));
    const { data: file } = await db.storage.from('signatures').download(entry!.signature_path as string);
    expect(file?.type).toBe('image/png');
    expect(file!.size).toBeLessThanOrEqual(200 * 1024);
    const { data: usage } = await db.from('pass_usages').select('user_pass_id, effect').eq('range_log_entry_id', entry!.id).single();
    expect(usage).toEqual({ user_pass_id: person.passId, effect: 'decremented' });
    const { data: pass } = await db.from('user_passes').select('entries_left').eq('id', person.passId).single();
    expect(pass!.entries_left).toBe(4);

    // AC-20: osoba towarzysząca (bez konta) — bez kroku uprawnienia, własny podpis, bez powiązania.
    await page.getByRole('button', { name: 'Dodaj osobę towarzyszącą' }).click();
    await expect(page.getByText('Osoba towarzysząca — bez zużycia uprawnienia')).toBeVisible();
    await page.getByRole('button', { name: 'Osoba bez konta' }).click();
    const companion = unique('Anna Towarzysząca');
    await guestForm(page).getByLabel('Imię i nazwisko *').fill(companion);
    await guestForm(page).getByLabel('Adres zamieszkania').fill(ADDRESS);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(sign.locator('[data-sign-field="pass"]')).toHaveText('osoba towarzysząca (bez zużycia uprawnienia)');
    await expect(sign.getByRole('heading', { name: 'Klauzula informacyjna' })).toBeVisible();
    await drawSignature(page);
    await save(page).click();
    await expect(page.getByText(new RegExp(`^Wpisano do książki: ${companion}, `))).toBeVisible();
    const { data: second } = await db.from('range_log').select('id, profile_id, is_companion').eq('full_name', companion).single();
    expect(second).toMatchObject({ profile_id: null, is_companion: true });
    expect((await db.from('pass_usages').select('id').eq('range_log_entry_id', second!.id)).data).toHaveLength(0);
    expect((await db.from('user_passes').select('entries_left').eq('id', person.passId).single()).data!.entries_left).toBe(4);
  });

  test('AC-16: błąd zapisu → komunikat, podpis zostaje; brak wpisu i zużycia', async ({ page }) => {
    const person = await seedPersonWithPass();
    await openRangeLog(page, `/panel/ksiazka/?osoba=${person.id}`);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await drawSignature(page);

    await page.route('**/rest/v1/rpc/create_range_log_entry', (route) =>
      route.fulfill({ status: 400, json: { code: 'P0001', message: 'pass_not_valid', details: null, hint: null } }),
    );
    await save(page).click();
    await expect(page.getByText('Uprawnienie zostało właśnie wykorzystane — wybierz inne.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wybierz inne uprawnienie' })).toBeVisible();
    await expect(save(page)).toBeEnabled();

    await page.unroute('**/rest/v1/rpc/create_range_log_entry');
    await page.route('**/rest/v1/rpc/create_range_log_entry', (route) => route.abort());
    await save(page).click();
    await expect(page.getByText('Nie udało się zapisać wpisu. Spróbuj ponownie.')).toBeVisible();
    await expect(save(page)).toBeEnabled();
    expect((await admin().from('range_log').select('id').eq('profile_id', person.id)).data).toHaveLength(0);
    expect((await admin().from('user_passes').select('entries_left').eq('id', person.passId).single()).data!.entries_left).toBe(5);

    // Ponowienie z tym samym podpisem (plik już w buckecie) zapisuje wpis.
    await page.unroute('**/rest/v1/rpc/create_range_log_entry');
    await save(page).click();
    await expect(page.getByText(new RegExp(`^Wpisano do książki: ${person.fullName}, `))).toBeVisible();
  });

  test('AC-18, AC-19: osoba bez konta — dane, sprzedaż wejścia na dziś, klauzula, wpis zużywa uprawnienie', async ({ page }) => {
    const db = admin();
    const product = unique('Wejście gość');
    const { data: created } = await db
      .from('products')
      .insert({ kind: 'single_entry', name: product, price: 5000, day_type: todayType() })
      .select('id')
      .single();
    await db.from('products').update({ is_active: true }).eq('id', created!.id);
    await openRangeLog(page, '/panel/ksiazka/');

    await page.getByRole('button', { name: 'Osoba bez konta' }).click();
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByText('Wpisz od 2 do 150 znaków.').first()).toBeVisible();
    const guest = unique('Piotr Gość');
    await guestForm(page).getByLabel('Imię i nazwisko *').fill(guest);
    await guestForm(page).getByLabel('Numer decyzji (pozwolenia na broń)').fill('GG 777');
    await guestForm(page).getByLabel('Organ wydający').fill('KWP Kraków');
    await page.getByRole('button', { name: 'Dalej' }).click();

    // AC-19: sprzedaż na miejscu przed podpisem.
    await expect(page.getByRole('heading', { name: 'Sprzedaż na miejscu — wejście na dziś' })).toBeVisible();
    await page.getByLabel('Produkt lub wejściówka *').selectOption({ label: `${product} — 50,00 zł` });
    await page.getByLabel('Terminal').check();
    await page.getByRole('button', { name: 'Zarejestruj sprzedaż' }).click();

    const sign = page.locator('[data-sign]');
    await expect(sign.locator('[data-sign-field="permit"]')).toHaveText('GG 777, KWP Kraków');
    await expect(sign.getByRole('heading', { name: 'Klauzula informacyjna' })).toBeVisible();
    await drawSignature(page);
    await save(page).click();
    await expect(page.getByText(new RegExp(`^Wpisano do książki: ${guest}, `))).toBeVisible();

    const { data: entry } = await db.from('range_log').select('id, profile_id, permit_number, permit_authority, address').eq('full_name', guest).single();
    expect(entry).toMatchObject({ profile_id: null, permit_number: 'GG 777', permit_authority: 'KWP Kraków', address: null });
    const { data: usage } = await db.from('pass_usages').select('effect, user_passes(user_id, status)').eq('range_log_entry_id', entry!.id).single();
    expect(usage).toMatchObject({ effect: 'consumed', user_passes: { user_id: null, status: 'used_up' } });
  });
});
