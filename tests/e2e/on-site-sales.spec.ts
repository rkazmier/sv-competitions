import { expect, test, type Page } from '@playwright/test';
import { admin, ensureUser, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-003 US-5 (AC-21…AC-23): sprzedaż na miejscu w `/panel/sprzedaz/` (obsługa).
// Reguły bazy (wejściówki, limit, osoba bez konta, lista dnia) sprawdza też pgTAP: supabase/tests/016_on_site_sales_test.sql.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const todayType = () => {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(new Date());
  return day === 'Sat' || day === 'Sun' ? 'weekend' : 'weekday';
};

async function seedProduct(fields: Record<string, unknown>): Promise<string> {
  const name = unique(String(fields.name));
  const db = admin();
  // Nowy produkt jest zawsze ukryty (AC-1) — „Pokaż w ofercie” osobnym zapisem.
  const { data, error } = await db.from('products').insert({ ...fields, name }).select('id').single();
  expect(error).toBeNull();
  expect((await db.from('products').update({ is_active: true }).eq('id', data!.id)).error).toBeNull();
  return name;
}

async function seedPerson(): Promise<{ id: string; fullName: string }> {
  const db = admin();
  const fullName = unique('Jan Kupujący');
  const { data, error } = await db.auth.admin.createUser({
    email: `${unique('kupujacy').replace(/\s/g, '-')}@example.test`,
    email_confirm: true,
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  expect((await db.from('profiles').update({ full_name: fullName }).eq('id', id)).error).toBeNull();
  return { id, fullName };
}

const options = (page: Page) => page.getByLabel('Produkt lub wejściówka *').locator('option');

test.beforeEach(async ({ page }) => {
  const staffEmail = await ensureUser('staff');
  const db = admin();
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const staffId = data.users.find((user) => user.email === staffEmail)!.id;
  await db.from('profiles').update({ full_name: 'Obsługa E2E' }).eq('id', staffId);
  await signIn(page, 'staff');
});

test('AC-21, AC-23: obsługa sprzedaje karnet osobie z kontem; pozycja i suma w dzisiejszej sprzedaży', async ({ page }) => {
  const product = await seedProduct({ kind: 'entries', name: 'Karnet E2E', price: 12345, entries: 5 });
  const person = await seedPerson();

  await page.goto('/panel/sprzedaz/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sprzedaż na miejscu');
  await expect(page.getByRole('navigation', { name: 'Menu panelu' }).getByRole('link', { name: 'Sprzedaż', exact: true })).toBeVisible();

  await page.getByLabel('Imię i nazwisko lub e-mail').fill(person.fullName);
  await page.getByRole('button', { name: 'Szukaj' }).click();
  await page.getByRole('button', { name: `Wybierz: ${person.fullName}` }).click();
  await expect(page.getByText(`Wybrana osoba: ${person.fullName}`)).toBeVisible();

  await page.getByLabel('Produkt lub wejściówka *').selectOption({ label: `${product} — 123,45 zł` });
  await page.getByLabel('Gotówka').check();
  await page.getByRole('button', { name: 'Zarejestruj sprzedaż' }).click();
  await expect(page.getByText(`Sprzedaż zarejestrowana: ${product}, 123,45 zł.`)).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: product });
  await expect(row).toContainText('Gotówka');
  await expect(row).toContainText('Obsługa E2E');
  await expect(page.getByText(/^Suma gotówka: /)).toBeVisible();

  const { data } = await admin()
    .from('orders')
    .select('status, payment_method, on_site_method, user_passes(user_id, kind)')
    .eq('user_id', person.id)
    .single();
  expect(data).toMatchObject({
    status: 'paid',
    payment_method: 'on_site',
    on_site_method: 'cash',
    user_passes: { user_id: person.id, kind: 'entries' },
  });
});

test('AC-22: osoba bez konta — tylko wejście na dziś, zamówienie bez danych osoby', async ({ page }) => {
  const fits = await seedProduct({ kind: 'single_entry', name: 'Wejście dziś E2E', price: 4000, day_type: todayType() });
  const other = await seedProduct({
    kind: 'single_entry',
    name: 'Wejście inny dzień E2E',
    price: 4000,
    day_type: todayType() === 'weekend' ? 'weekday' : 'weekend',
  });
  const pass = await seedProduct({ kind: 'days', name: 'Karnet czasowy E2E', price: 30000, days: 30 });

  await page.goto('/panel/sprzedaz/');
  await page.getByLabel('Osoba bez konta').check();
  await expect(page.getByLabel('Imię i nazwisko lub e-mail')).toBeHidden();
  await expect(options(page).filter({ hasText: fits })).toHaveCount(1);
  const labels = await options(page).allTextContents();
  expect(labels.some((label) => label.startsWith(fits))).toBe(true);
  expect(labels.some((label) => label.startsWith(other) || label.startsWith(pass))).toBe(false);

  await page.getByLabel('Produkt lub wejściówka *').selectOption({ label: `${fits} — 40,00 zł` });
  await page.getByLabel('Terminal').check();
  await page.getByRole('button', { name: 'Zarejestruj sprzedaż' }).click();
  await expect(page.getByText(`Sprzedaż zarejestrowana: ${fits}, 40,00 zł.`)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: fits })).toContainText('Terminal');

  const { data } = await admin().from('orders').select('user_id, user_passes(user_id)').eq('item_name', fits).single();
  expect(data).toEqual({ user_id: null, user_passes: { user_id: null } });
});
