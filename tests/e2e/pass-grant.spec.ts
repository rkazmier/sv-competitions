import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-010 US-1 (AC-1…AC-11): formularz „Przyznaj karnet” w `/panel/zamowienia/przyznaj/` (admin).
// Reguły bazy (idempotencja `request_key` — AC-9, limit miejsc — AC-10, wydarzenie niedostępne — AC-11)
// sprawdza pgTAP: supabase/tests/033_pass_grant_test.sql; komunikaty błędów — Vitest (lib/pass-grant.test.ts).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const warsawToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const plusYear = (date: string) => `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`.replace(/-02-29$/, '-02-28');

async function seedPerson(): Promise<{ id: string; fullName: string }> {
  const db = admin();
  const fullName = unique('Anna Obdarowana');
  const { data, error } = await db.auth.admin.createUser({
    email: `${unique('prezent').replace(/\s/g, '-')}@example.test`,
    email_confirm: true,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  expect((await db.from('profiles').update({ full_name: fullName }).eq('id', id)).error).toBeNull();
  return { id, fullName };
}

/** Nowy produkt jest ukryty (`is_active = false`) — dokładnie przypadek z AC-3. */
async function seedHiddenProduct(fields: Record<string, unknown>): Promise<string> {
  const name = unique(String(fields.name));
  const { error } = await admin().from('products').insert({ price: 12000, ...fields, name });
  expect(error).toBeNull();
  return name;
}

async function seedPaidEvent(fields: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const db = admin();
  const { data: category } = await db.from('event_categories').insert({ name: unique('Kategoria P') }).select('id').single();
  const { data, error } = await db
    .from('calendar_events')
    .insert({
      name: unique('Szkolenie P'),
      category_id: category!.id,
      starts_on: day(20),
      status: 'published',
      access_mode: 'paid',
      ticket_price: 5000,
      ...fields,
    })
    .select('id, name')
    .single();
  expect(error).toBeNull();
  return data!;
}

const itemSelect = (page: Page) => page.getByLabel('Co przyznać *');

async function choosePerson(page: Page, fullName: string): Promise<void> {
  await page.getByLabel('Imię i nazwisko lub e-mail').fill(fullName);
  await page.getByRole('button', { name: 'Szukaj' }).click();
  await page.getByRole('button', { name: `Wybierz: ${fullName}` }).click();
  await expect(page.getByText(`Wybrana osoba: ${fullName}`)).toBeVisible();
}

test.describe('admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-1…AC-4, AC-6…AC-8: przyznanie ukrytego karnetu czasowego z „Zamówienia”', async ({ page }) => {
    const product = await seedHiddenProduct({ kind: 'days', name: 'Karnet prezent E2E', days: 30 });
    const person = await seedPerson();

    await page.goto('/panel/zamowienia/');
    await page.getByRole('link', { name: 'Przyznaj karnet' }).click();
    await expect(page).toHaveURL(/\/panel\/zamowienia\/przyznaj\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Przyznaj karnet');
    await expect(page.getByLabel('Osoba bez konta')).toHaveCount(0);

    await choosePerson(page, person.fullName);
    await expect(itemSelect(page).locator('optgroup[label="Karnety czasowe"] option', { hasText: product }))
      .toHaveText(`${product} (ukryty w Ofercie)`);
    await itemSelect(page).selectOption({ label: `${product} (ukryty w Ofercie)` });
    await expect(page.getByText('Cena w Ofercie: 120,00 zł')).toBeVisible();

    const expires = page.getByLabel('Ważny do *');
    const today = warsawToday();
    await expect(expires).toHaveValue(plusYear(today));
    await expect(expires).toHaveAttribute('min', today);
    await expect(page.getByText('Do tego dnia trzeba zacząć korzystać z karnetu — dni liczą się od pierwszego wejścia.')).toBeVisible();

    const reason = page.getByLabel('Powód *');
    await reason.fill('ab');
    await page.getByRole('button', { name: 'Przyznaj karnet' }).click();
    await expect(page.getByText('Powód musi mieć od 3 do 300 znaków.')).toBeVisible();
    await reason.fill('Nagroda — zawody X');
    await expect(page.getByText('18/300 znaków')).toBeVisible();
    await expect(page.getByText('Widoczny tylko dla admina. Nie wpisuj danych osobowych — osoba jest już wskazana.')).toBeVisible();
    await expires.fill(day(60));
    await page.getByRole('button', { name: 'Przyznaj karnet' }).click();

    await expect(page.getByText(new RegExp(`^Przyznano: ${product} — ${person.fullName}\\. Zamówienie SV-\\d{4}-\\d{6,}\\.$`)))
      .toBeVisible();
    const { data: order } = await admin()
      .from('orders')
      .select('order_number, amount, payment_method, status, order_grants(reason), user_passes(expires_on, kind)')
      .eq('user_id', person.id)
      .single();
    expect(order).toMatchObject({
      amount: 0,
      payment_method: 'gift',
      status: 'paid',
      order_grants: { reason: 'Nagroda — zawody X' },
      user_passes: { expires_on: day(60), kind: 'days' },
    });

    const showOrder = page.getByRole('link', { name: 'Pokaż zamówienie' });
    await expect(showOrder).toHaveAttribute('href', `/panel/zamowienia/?numer=${order!.order_number}`);

    await page.getByRole('button', { name: 'Przyznaj kolejny' }).click();
    await expect(page.getByLabel('Imię i nazwisko lub e-mail')).toBeVisible();
    await expect(page.getByLabel('Powód *')).toHaveValue('');
    await expect(page.getByLabel('Co przyznać *')).toHaveValue('');

    await page.goto(`/panel/zamowienia/?numer=${order!.order_number}`);
    await expect(page.getByLabel('Osoba lub nr zamówienia')).toHaveValue(order!.order_number);
    await expect(page.getByRole('row').filter({ hasText: order!.order_number })).toBeVisible();
  });

  test('AC-1, AC-3, AC-5: z profilu osoby — wejściówka bez „Ważny do”, wyprzedane nieaktywne', async ({ page }) => {
    const person = await seedPerson();
    const open = await seedPaidEvent({ capacity: 5 });
    const full = await seedPaidEvent({ capacity: 1 });
    const past = await seedPaidEvent({ starts_on: day(-3), ends_on: day(-2) });
    // Jedyne miejsce sprzedane (jak `soldTicket` w event-tickets.spec.ts).
    const { error } = await admin().from('orders').insert({
      calendar_event_id: full.id,
      item_name: `Wejściówka: ${full.name}`,
      amount: 5000,
      payment_method: 'tpay',
      status: 'paid',
      paid_at: new Date().toISOString(),
    });
    expect(error).toBeNull();

    await page.goto(`/panel/uzytkownicy/profil/?id=${person.id}`);
    await page.getByRole('link', { name: 'Przyznaj karnet' }).click();
    await expect(page).toHaveURL(`/panel/zamowienia/przyznaj/?osoba=${person.id}`);
    await expect(page.getByText(`Wybrana osoba: ${person.fullName}`)).toBeVisible();

    const tickets = itemSelect(page).locator('optgroup[label="Wejściówki"] option');
    await expect(tickets.filter({ hasText: open.name })).toContainText('wolne: 5');
    await expect(tickets.filter({ hasText: full.name })).toContainText('wyprzedane');
    await expect(tickets.filter({ hasText: full.name })).toBeDisabled();
    await expect(tickets.filter({ hasText: past.name })).toHaveCount(0);

    const openLabel = (await tickets.filter({ hasText: open.name }).textContent())!;
    await itemSelect(page).selectOption({ label: openLabel });
    await expect(page.getByLabel('Ważny do *')).toBeHidden();
    await expect(page.getByText('Wejściówka ważna w dniach wydarzenia.')).toBeVisible();
    await page.getByLabel('Powód *').fill('Barter — współpraca');
    await page.getByRole('button', { name: 'Przyznaj karnet' }).click();
    await expect(page.getByText(new RegExp(`^Przyznano: Wejściówka: ${open.name} — ${person.fullName}\\.`))).toBeVisible();

    const { data } = await admin().from('orders').select('payment_method, user_passes(valid_until)').eq('user_id', person.id).single();
    expect(data).toMatchObject({ payment_method: 'gift', user_passes: { valid_until: day(20) } });
  });
});

test('AC-1: obsługa nie widzi przycisku, a formularz kończy się bramką panelu', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/panel/zamowienia/przyznaj/');
  // Strona tylko dla admina: obsługa widzi bramkę panelu zamiast treści (PanelLayout, `access="admin"`).
  await expect(page.getByText('Moduły obsługi będą dostępne wkrótce.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Przyznaj karnet' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Przyznaj karnet' })).toBeHidden();
  await expect(page.getByLabel('Co przyznać *')).toBeHidden();
});
