import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signInAs } from './support/supabase';

// SPEC-007 US-1, US-3: uprawnienia prowadzącego z konta w „Twoje dane” na /konto/ (AC-1…AC-4, AC-11…AC-13).
// Strona bazy (statusy, unikalność, synchronizacja nazwiska) — pgTAP: supabase/tests/027_range_officer_account_test.sql.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PASSWORD = 'haslo-e2e-123';
const HINT = 'Obsługa znajdzie Cię tylko przez wyszukiwanie. Przy Twoim własnym wpisie do książki zawsze możesz wskazać siebie.';

async function newAccount(page: Page, fullName: string | null): Promise<string> {
  const email = `prowadzacy-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;
  const db = admin();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  if (error) throw error;
  if (fullName) {
    const { error: updateError } = await db.from('profiles').update({ full_name: fullName }).eq('id', data.user.id);
    if (updateError) throw updateError;
  }
  await signInAs(page, email, PASSWORD);
  return data.user.id;
}

async function officerRow(profileId: string) {
  const { data, error } = await admin()
    .from('range_officers')
    .select('id, full_name, status, license_number, institution, institution_other, hide_from_others, is_active')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const dataCard = (page: Page) => page.getByRole('region', { name: 'Twoje dane' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Uprawnienia prowadzącego' });

/** AC-2: wypełnia i wysyła formularz w oknie. */
async function submitForm(page: Page, license: string, institution: string, other?: string): Promise<void> {
  const form = dialog(page);
  await form.getByLabel('Nr legitymacji').fill(license);
  await form.getByLabel('Instytucja').selectOption({ label: institution });
  if (other !== undefined) await form.getByLabel('Nazwa instytucji').fill(other);
  await form.getByRole('button', { name: 'Wyślij do zatwierdzenia' }).click();
}

test('AC-1, AC-2, AC-4: „Dodaj uprawnienia prowadzącego” → formularz → zgłoszenie pending', async ({ page }) => {
  const id = await newAccount(page, 'Anna Prowadząca');
  await page.goto('/konto/');
  const card = dataCard(page);
  await card.getByRole('button', { name: 'Dodaj uprawnienia prowadzącego' }).click();

  const form = dialog(page);
  await expect(form).toBeVisible();
  await expect(form.getByText('Anna Prowadząca')).toBeVisible();
  await expect(form.getByLabel('Ukryj mnie dla innych')).toBeChecked();
  await expect(form.getByText(HINT)).toBeVisible();

  // Walidacja jak SPEC-005 AC-1
  await form.getByRole('button', { name: 'Wyślij do zatwierdzenia' }).click();
  await expect(form.getByText('Podaj nr legitymacji.')).toBeVisible();
  await expect(form.getByText('Wybierz instytucję.')).toBeVisible();
  await form.getByLabel('Instytucja').selectOption({ label: 'Inne' });
  await form.getByLabel('Nazwa instytucji').fill('X');
  await form.getByRole('button', { name: 'Wyślij do zatwierdzenia' }).click();
  await expect(form.getByText('Nazwa instytucji musi mieć co najmniej 2 znaki.')).toBeVisible();
  expect(await officerRow(id)).toBeNull();

  await submitForm(page, ' 77/2025 ', 'Inne', 'Klub Strzelecki Stal');
  await expect(form).toBeHidden();
  await expect(card.getByText('Zapisano. Uprawnienia czekają na zatwierdzenie.')).toBeVisible();
  await expect(card.getByText('Uprawnienia prowadzącego: czekają na zatwierdzenie')).toBeVisible();
  await expect(card.getByText('77/2025')).toBeVisible();
  await expect(card.getByText('Klub Strzelecki Stal')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Edytuj', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Usuń' })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Dodaj uprawnienia prowadzącego' })).toBeHidden();

  expect(await officerRow(id)).toMatchObject({
    full_name: 'Anna Prowadząca',
    status: 'pending',
    license_number: '77/2025',
    institution: 'OTHER',
    institution_other: 'Klub Strzelecki Stal',
    hide_from_others: true,
    is_active: true,
  });
});

test('AC-3: profil bez imienia i nazwiska → komunikat, formularz się nie otwiera', async ({ page }) => {
  const id = await newAccount(page, null);
  await page.goto('/konto/');
  await dataCard(page).getByRole('button', { name: 'Dodaj uprawnienia prowadzącego' }).click();
  await expect(
    dataCard(page).getByText('Uzupełnij imię i nazwisko w „Twoje dane”, aby dodać uprawnienia prowadzącego.'),
  ).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  expect(await officerRow(id)).toBeNull();
});

test('AC-11: „Edytuj” po zatwierdzeniu — zmiana nr legitymacji → pending; zapis bez zmian nie zmienia statusu', async ({
  page,
}) => {
  const id = await newAccount(page, 'Bartosz Edytujący');
  await page.goto('/konto/');
  await dataCard(page).getByRole('button', { name: 'Dodaj uprawnienia prowadzącego' }).click();
  await submitForm(page, '10/2024', 'PZSS');
  await expect(dataCard(page).getByText('Uprawnienia prowadzącego: czekają na zatwierdzenie')).toBeVisible();
  const row = await officerRow(id);
  await admin().from('range_officers').update({ status: 'approved' }).eq('id', row!.id);

  await page.reload();
  const card = dataCard(page);
  await expect(card.getByText('Uprawnienia prowadzącego: zatwierdzone')).toBeVisible();

  // Zapis bez zmian nr legitymacji / instytucji — status bez zmian
  await card.getByRole('button', { name: 'Edytuj', exact: true }).click();
  await expect(dialog(page).getByLabel('Nr legitymacji')).toHaveValue('10/2024');
  await expect(dialog(page).getByLabel('Instytucja')).toHaveValue('PZSS');
  await dialog(page).getByRole('button', { name: 'Wyślij do zatwierdzenia' }).click();
  await expect(card.getByText('Uprawnienia prowadzącego: zatwierdzone')).toBeVisible();
  expect((await officerRow(id))!.status).toBe('approved');

  await card.getByRole('button', { name: 'Edytuj', exact: true }).click();
  await submitForm(page, '11/2024', 'LOK');
  await expect(card.getByText('Uprawnienia prowadzącego: czekają na zatwierdzenie')).toBeVisible();
  await expect(card.getByText('LOK', { exact: true })).toBeVisible();
  expect(await officerRow(id)).toMatchObject({ status: 'pending', license_number: '11/2024', institution: 'LOK' });
});

test('AC-12: przełącznik „Ukryj mnie dla innych” działa od razu, bez zmiany statusu', async ({ page }) => {
  const id = await newAccount(page, 'Celina Ukryta');
  await page.goto('/konto/');
  await dataCard(page).getByRole('button', { name: 'Dodaj uprawnienia prowadzącego' }).click();
  await submitForm(page, '20/2024', 'PZŁ');
  // Czekamy na zapis, zanim sięgniemy do bazy (inaczej wyścig z wysyłką formularza).
  await expect(dataCard(page).getByText('Uprawnienia prowadzącego: czekają na zatwierdzenie')).toBeVisible();
  const row = await officerRow(id);
  await admin().from('range_officers').update({ status: 'approved' }).eq('id', row!.id);
  await page.reload();

  const toggle = dataCard(page).getByLabel('Ukryj mnie dla innych');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(dataCard(page).getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();
  await expect.poll(async () => (await officerRow(id))!.hide_from_others).toBe(false);
  expect((await officerRow(id))!.status).toBe('approved');

  await page.reload();
  await expect(dataCard(page).getByLabel('Ukryj mnie dla innych')).not.toBeChecked();
  await expect(dataCard(page).getByText('Uprawnienia prowadzącego: zatwierdzone')).toBeVisible();
});

test('AC-13: „Usuń” po potwierdzeniu → is_active = false, znów „Dodaj…”; ponowne dodanie → pending', async ({ page }) => {
  const id = await newAccount(page, 'Dawid Usuwający');
  await page.goto('/konto/');
  const card = dataCard(page);
  await card.getByRole('button', { name: 'Dodaj uprawnienia prowadzącego' }).click();
  await submitForm(page, '30/2024', 'PZSS');
  await expect(card.getByText('Uprawnienia prowadzącego: czekają na zatwierdzenie')).toBeVisible();
  const row = await officerRow(id);
  await admin().from('range_officers').update({ status: 'approved' }).eq('id', row!.id);

  page.once('dialog', (confirm) => {
    expect(confirm.message()).toBe('Usunąć uprawnienia prowadzącego? Dawne wpisy w książce się nie zmienią.');
    void confirm.dismiss();
  });
  await card.getByRole('button', { name: 'Usuń' }).click();
  expect((await officerRow(id))!.is_active).toBe(true);

  page.once('dialog', (confirm) => void confirm.accept());
  await card.getByRole('button', { name: 'Usuń' }).click();
  await expect(card.getByRole('button', { name: 'Dodaj uprawnienia prowadzącego' })).toBeVisible();
  await expect(card.getByText('Uprawnienia prowadzącego: zatwierdzone')).toBeHidden();
  expect((await officerRow(id))!.is_active).toBe(false);

  await page.reload();
  await card.getByRole('button', { name: 'Dodaj uprawnienia prowadzącego' }).click();
  await submitForm(page, '31/2024', 'PZSS');
  await expect(card.getByText('Uprawnienia prowadzącego: czekają na zatwierdzenie')).toBeVisible();
  expect(await officerRow(id)).toMatchObject({ id: row!.id, is_active: true, status: 'pending', license_number: '31/2024' });
});
