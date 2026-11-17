import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signInAs } from './support/supabase';

// SPEC-002 US-2: panel użytkownika /konto/ — dane i gotowość do wpisu (AC-7…AC-11, AC-22).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PASSWORD = 'haslo-e2e-123';

/** Nowe konto z potwierdzoną klauzulą (jak po rejestracji) i opcjonalnymi danymi; zalogowane w `page`. */
async function newAccount(page: Page, data: Record<string, string> = {}): Promise<{ id: string; email: string }> {
  const email = `konto-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;
  const db = admin();
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  if (error) throw error;
  const id = created.user.id;
  if (Object.keys(data).length) {
    const { error: updateError } = await db.from('profiles').update(data).eq('id', id);
    if (updateError) throw updateError;
  }
  await signInAs(page, email, PASSWORD);
  return { id, email };
}

async function profileRow(id: string) {
  const { data, error } = await admin().from('profiles').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Record<string, string | boolean | null>;
}

const form = (page: Page) => page.locator('form[data-profile]');

test('AC-9: puste konto → blok „Co uzupełnić…” z listą braków i „Uzupełnij dane”', async ({ page }) => {
  await newAccount(page);
  await page.goto('/konto/');
  const block = page.locator('[data-missing]');
  await expect(block.getByRole('heading', { name: 'Co uzupełnić, aby wejść na strzelnicę' })).toBeVisible();
  await expect(block.getByRole('listitem')).toHaveText([
    'Imię i nazwisko',
    'Numer decyzji i organ wydający albo adres zamieszkania',
  ]);
  await expect(page.getByText('Gotowy do wpisu do książki')).toBeHidden();
  await block.getByRole('link', { name: 'Uzupełnij dane' }).click();
  await expect(page).toHaveURL(/\/konto\/dane\/$/);
});

test('AC-9: samo imię i nazwisko → brakuje tylko decyzji z organem albo adresu', async ({ page }) => {
  await newAccount(page, { full_name: 'Anna Nowak' });
  await page.goto('/konto/');
  await expect(page.locator('[data-missing]').getByRole('listitem')).toHaveText([
    'Numer decyzji i organ wydający albo adres zamieszkania',
  ]);
});

test('AC-7: „Edytuj dane” → formularz z polami danych; e-mail tylko do odczytu', async ({ page }) => {
  const { email } = await newAccount(page, { full_name: 'Anna Nowak', phone: '600100200' });
  await page.goto('/konto/');
  await page.getByRole('link', { name: 'Edytuj dane' }).click();
  await expect(page).toHaveURL(/\/konto\/dane\/$/);
  await expect(form(page).getByLabel('Imię i nazwisko')).toHaveValue('Anna Nowak');
  await expect(form(page).getByLabel('Telefon')).toHaveValue('600100200');
  for (const label of ['Numer decyzji (pozwolenia na broń)', 'Organ wydający', 'Adres zamieszkania']) {
    await expect(form(page).getByLabel(label)).toBeEditable();
  }
  await expect(form(page).getByLabel('E-mail')).toHaveValue(email);
  await expect(form(page).getByLabel('E-mail')).not.toBeEditable();
});

test('AC-8: numer decyzji bez organu (i odwrotnie) → komunikat, nic nie zapisane', async ({ page }) => {
  const { id } = await newAccount(page, { full_name: 'Anna Nowak' });
  await page.goto('/konto/dane/');
  const message = 'Podaj numer decyzji razem z organem wydającym.';
  await form(page).getByLabel('Numer decyzji (pozwolenia na broń)').fill('SA-123/2020');
  await form(page).getByRole('button', { name: 'Zapisz dane' }).click();
  await expect(form(page).getByText(message)).toBeVisible();
  await expect(form(page).getByLabel('Organ wydający')).toHaveAttribute('aria-invalid', 'true');

  await form(page).getByLabel('Numer decyzji (pozwolenia na broń)').fill('');
  await form(page).getByLabel('Organ wydający').fill('KWP w Katowicach');
  await form(page).getByRole('button', { name: 'Zapisz dane' }).click();
  await expect(form(page).getByText(message)).toBeVisible();
  await expect(page).toHaveURL(/\/konto\/dane\/$/);
  const row = await profileRow(id);
  expect([row.permit_number, row.permit_authority]).toEqual([null, null]);
});

test('AC-11: limity pól i wzorzec telefonu → komunikat przy polu, nic nie zapisane', async ({ page }) => {
  const { id } = await newAccount(page, { full_name: 'Anna Nowak' });
  await page.goto('/konto/dane/');
  await form(page).getByLabel('Imię i nazwisko').fill('A');
  await form(page).getByLabel('Telefon').fill('600-100-200');
  await form(page).getByLabel('Adres zamieszkania').fill('x'.repeat(301));
  await form(page).getByRole('button', { name: 'Zapisz dane' }).click();
  await expect(page.locator('[data-error-for="full_name"]')).toHaveText('Wpisz od 2 do 150 znaków.');
  await expect(page.locator('[data-error-for="phone"]')).toHaveText(
    'Podaj numer telefonu: 9–20 cyfr, mogą być spacje i „+” na początku.',
  );
  await expect(page.locator('[data-error-for="address"]')).toHaveText('Wpisz od 5 do 300 znaków.');
  await expect(form(page).getByLabel('Imię i nazwisko')).toBeFocused();
  await expect(page).toHaveURL(/\/konto\/dane\/$/);
  const row = await profileRow(id);
  expect([row.full_name, row.phone, row.address]).toEqual(['Anna Nowak', null, null]);
});

test('AC-10, AC-22: zapis własnych danych → „Gotowy do wpisu do książki” (is_range_ready), bez wpisu w audit_log', async ({
  page,
}) => {
  const { id } = await newAccount(page);
  await page.goto('/konto/dane/');
  await form(page).getByLabel('Imię i nazwisko').fill('  Jan Kowalski ');
  await form(page).getByLabel('Telefon').fill('+48 600 100 200');
  await form(page).getByLabel('Adres zamieszkania').fill('ul. Stalowa 1, 40-001 Katowice');
  await form(page).getByRole('button', { name: 'Zapisz dane' }).click();

  await expect(page).toHaveURL(/\/konto\/$/);
  await expect(page.getByText('Gotowy do wpisu do książki')).toBeVisible();
  await expect(page.locator('[data-missing]')).toBeHidden();
  await expect(page.locator('[data-field="full_name"]')).toHaveText('Jan Kowalski');
  await expect(page.locator('[data-field="address"]')).toHaveText('ul. Stalowa 1, 40-001 Katowice');
  await expect(page.locator('[data-field="permit_number"]')).toHaveText('nie podano');

  const row = await profileRow(id);
  expect(row).toMatchObject({ full_name: 'Jan Kowalski', phone: '+48 600 100 200', is_range_ready: true });
  const { count } = await admin().from('audit_log').select('id', { count: 'exact', head: true }).eq('target_user_id', id);
  expect(count).toBe(0);
});
