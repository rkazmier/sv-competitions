import { expect, test, type Page } from '@playwright/test';
import { admin, ensureUser, hasLocalSupabase, signIn } from './support/supabase';

// SPEC-002 US-4…US-6: panel admina — lista kont, rola, dane użytkownika, historia zmian, usunięcie konta
// (AC-16…AC-18, AC-20, AC-21, AC-23…AC-25).
// Logikę bazy (ostatni admin, uprawnienia, wpisy audit_log) sprawdza też pgTAP (007, 010).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const suffix = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** Nowe konto użytkownika z danymi (bez logowania). */
async function newUser(data: Record<string, string> = {}): Promise<{ id: string; email: string; name: string }> {
  const tag = suffix();
  const email = `karta-${tag}@example.test`;
  const name = `Jan Karta${tag}`;
  const db = admin();
  const { data: created, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  const { error: updateError } = await db.from('profiles').update({ full_name: name, ...data }).eq('id', created.user.id);
  if (updateError) throw updateError;
  return { id: created.user.id, email, name };
}

async function profileRow(id: string) {
  const { data, error } = await admin().from('profiles').select('*').eq('id', id).single();
  if (error) throw error;
  return data as Record<string, string | boolean | null>;
}

async function auditRows(id: string) {
  const { data, error } = await admin()
    .from('audit_log').select('actor_id, action, changes').eq('target_user_id', id).order('id', { ascending: true });
  if (error) throw error;
  return data;
}

async function adminId(): Promise<string> {
  const email = await ensureUser('admin');
  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((user) => user.email === email)!.id;
}

const history = (page: Page) => page.locator('[data-history] > li');

test.describe('admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-16: lista kont z wyszukiwarką po imieniu i nazwisku lub e-mailu', async ({ page }) => {
    const user = await newUser({ address: 'ul. Stalowa 1, Katowice' });
    await page.goto('/panel/uzytkownicy/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Użytkownicy');
    await expect(page.getByRole('navigation', { name: 'Menu panelu' }).getByRole('link', { name: 'Użytkownicy' })).toBeVisible();

    const search = page.getByLabel('Szukaj po imieniu i nazwisku lub e-mailu');
    await search.fill(user.name.slice(4));
    await page.getByRole('button', { name: 'Szukaj' }).click();
    const row = page.locator('[data-list] > li');
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('link', { name: user.name })).toBeVisible();
    await expect(row.locator('[data-email]')).toHaveText(user.email);
    await expect(row.locator('[data-role]')).toHaveText('Użytkownik');
    await expect(row.locator('[data-ready]')).toHaveText('Tak');
    await expect(row.locator('[data-created]')).toHaveText(/^\d{2}\.\d{2}\.\d{4}$/);
    await expect(page.getByRole('status')).toHaveText('Kont: 1. Strona 1 z 1');

    await search.fill(user.email.toUpperCase());
    await page.getByRole('button', { name: 'Szukaj' }).click();
    await expect(row.getByRole('link', { name: user.name })).toBeVisible();

    await search.fill('brak-takiego-konta-xyz');
    await page.getByRole('button', { name: 'Szukaj' }).click();
    await expect(page.getByRole('status')).toHaveText('Nie znaleziono kont.');

    // Fraza krótsza niż 2 znaki nie filtruje listy.
    await search.fill('x');
    await page.getByRole('button', { name: 'Szukaj' }).click();
    await expect(page.getByRole('status')).toHaveText(/^Kont: \d+\./);
  });

  test('AC-17: zmiana roli po potwierdzeniu — od razu w bazie i w historii zmian', async ({ page }) => {
    const user = await newUser();
    await page.goto(`/panel/uzytkownicy/profil/?id=${user.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(user.name);
    await expect(page.getByLabel('E-mail')).toHaveValue(user.email);
    await expect(page.getByLabel('Rola')).toHaveValue('user');

    page.once('dialog', (dialog) => {
      expect(dialog.message()).toBe('Zmienić rolę na „Obsługa strzelnicy”?');
      void dialog.accept();
    });
    await page.getByLabel('Rola').selectOption({ label: 'Obsługa strzelnicy' });
    await page.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(page.getByText('Rola zmieniona.')).toBeVisible();
    expect((await profileRow(user.id)).role).toBe('staff');
    expect(await auditRows(user.id)).toEqual([
      { actor_id: await adminId(), action: 'role_change', changes: { role: ['user', 'staff'] } },
    ]);
    await expect(history(page).first()).toContainText('Rola: Użytkownik → Obsługa strzelnicy');
  });

  test('AC-17: anulowane potwierdzenie — rola bez zmian', async ({ page }) => {
    const user = await newUser();
    await page.goto(`/panel/uzytkownicy/profil/?id=${user.id}`);
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByLabel('Rola').selectOption('admin');
    await page.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(page.getByText('Brak zmian dokonanych przez obsługę lub admina.')).toBeVisible();
    expect((await profileRow(user.id)).role).toBe('user');
  });

  test('AC-18: ostatni admin — komunikat z bazy i rola bez zmian', async ({ page }) => {
    // Sprawdzenie w funkcji bazy testuje pgTAP (007); tu — komunikat, gdy baza zwróci `last_admin`.
    const id = await adminId();
    await page.route('**/rest/v1/rpc/set_user_role', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'P0001', message: 'last_admin', hint: 'Musi zostać co najmniej jeden admin.' }),
      }),
    );
    await page.goto(`/panel/uzytkownicy/profil/?id=${id}`);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByLabel('Rola').selectOption('user');
    await page.getByRole('button', { name: 'Zmień rolę' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Musi zostać co najmniej jeden admin.' })).toBeVisible();
    await expect(page.getByLabel('Rola')).toHaveValue('admin');
    expect((await profileRow(id)).role).toBe('admin');
  });

  test('AC-20, AC-21: edycja danych użytkownika — zapis, wpis w audit_log i historia od najnowszych', async ({ page }) => {
    const user = await newUser();
    await page.goto(`/panel/uzytkownicy/profil/?id=${user.id}`);
    const form = page.locator('form[data-profile]');
    await expect(form.getByLabel('Imię i nazwisko')).toHaveValue(user.name);

    // Te same walidacje co /konto/dane/ (AC-8): nic nie jest zapisywane.
    await form.getByLabel('Numer decyzji (pozwolenia na broń)').fill('SA-1/2020');
    await form.getByRole('button', { name: 'Zapisz dane' }).click();
    await expect(form.getByText('Podaj numer decyzji razem z organem wydającym.')).toBeVisible();
    expect(await auditRows(user.id)).toEqual([]);

    await form.getByLabel('Organ wydający').fill('KWP w Katowicach');
    await form.getByLabel('Telefon').fill('600 100 200');
    await form.getByRole('button', { name: 'Zapisz dane' }).click();
    await expect(form.getByText('Zapisano.')).toBeVisible();
    await expect(page.getByText('Gotowy do wpisu do książki')).toBeVisible();

    const row = await profileRow(user.id);
    expect([row.phone, row.permit_number, row.permit_authority]).toEqual(['600 100 200', 'SA-1/2020', 'KWP w Katowicach']);
    expect(await auditRows(user.id)).toEqual([
      {
        actor_id: await adminId(),
        action: 'profile_update',
        changes: {
          phone: [null, '600 100 200'],
          permit_number: [null, 'SA-1/2020'],
          permit_authority: [null, 'KWP w Katowicach'],
        },
      },
    ]);

    await form.getByLabel('Telefon').fill('');
    await form.getByRole('button', { name: 'Zapisz dane' }).click();
    await expect(history(page)).toHaveCount(2);
    await expect(history(page).first()).toContainText('Telefon: 600 100 200 → nie podano');
    await expect(history(page).nth(1)).toContainText('Organ wydający: nie podano → KWP w Katowicach');
    await expect(history(page).first().locator('time')).toHaveText(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  });

  test('AC-23, AC-24: usunięcie konta — ostrzeżenie, wpisanie „USUŃ”, wywołanie admin-delete-user', async ({ page }) => {
    // Edge Function (wpis account_delete, Auth Admin API) testują Deno i pgTAP (011); w E2E — odpowiedź zamockowana.
    const user = await newUser();
    const requests: { body: unknown; authorization: string | null }[] = [];
    await page.route('**/functions/v1/admin-delete-user', (route) => {
      requests.push({ body: route.request().postDataJSON(), authorization: route.request().headers()['authorization'] });
      return route.fulfill({ status: 204 });
    });
    await page.goto(`/panel/uzytkownicy/profil/?id=${user.id}`);
    await page.getByRole('button', { name: 'Usuń konto', exact: true }).click();
    await expect(page.getByText(
      'Konto, dane profilu i kod QR zostaną usunięte. Niewykorzystane karnety przepadną. Zamówienia i dane do faktur zostają przez 5 lat, wpisy w książce rejestru pobytu — do końca okresu przechowywania.',
    )).toBeVisible();
    const confirm = page.getByLabel('Aby potwierdzić, wpisz USUŃ');
    const submit = page.getByRole('button', { name: 'Usuń konto na stałe' });
    await expect(submit).toBeDisabled();
    await confirm.fill('USUN');
    await expect(submit).toBeDisabled();
    await confirm.fill('USUŃ');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole('status').filter({ hasText: 'Konto zostało usunięte.' })).toBeVisible();
    await expect(page.locator('[data-content]')).toBeHidden();
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({ user_id: user.id });
    expect(requests[0].authorization).toMatch(/^Bearer \S+/);
  });

  test('AC-23: „Anuluj” zamyka ostrzeżenie bez wywołania funkcji; błąd funkcji → komunikat', async ({ page }) => {
    const user = await newUser();
    let calls = 0;
    await page.route('**/functions/v1/admin-delete-user', (route) => {
      calls += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"delete_failed"}' });
    });
    await page.goto(`/panel/uzytkownicy/profil/?id=${user.id}`);
    await page.getByRole('button', { name: 'Usuń konto', exact: true }).click();
    await page.getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByLabel('Aby potwierdzić, wpisz USUŃ')).toBeHidden();
    expect(calls).toBe(0);

    await page.getByRole('button', { name: 'Usuń konto', exact: true }).click();
    await page.getByLabel('Aby potwierdzić, wpisz USUŃ').fill('USUŃ');
    await page.getByRole('button', { name: 'Usuń konto na stałe' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Nie udało się usunąć konta. Spróbuj ponownie.' })).toBeVisible();
    expect(calls).toBe(1);
    expect(await profileRow(user.id)).toBeTruthy();
  });

  test('AC-25: własne konto — „Usuń konto” niedostępne z podpowiedzią', async ({ page }) => {
    await page.goto(`/panel/uzytkownicy/profil/?id=${await adminId()}`);
    await expect(page.getByRole('button', { name: 'Usuń konto', exact: true })).toBeDisabled();
    await expect(page.getByText('Nie możesz usunąć własnego konta.')).toBeVisible();
  });

  test('karta: nieznane lub błędne id → „Nie znaleziono konta.”', async ({ page }) => {
    await page.goto('/panel/uzytkownicy/profil/?id=00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('Nie znaleziono konta.')).toBeVisible();
    await page.goto('/panel/uzytkownicy/profil/?id=abc');
    await expect(page.getByText('Nie znaleziono konta.')).toBeVisible();
  });
});

test('AC-16: obsługa nie widzi listy kont', async ({ page }) => {
  await signIn(page, 'staff');
  await page.goto('/panel/uzytkownicy/');
  await expect(page.getByText('Moduły obsługi będą dostępne wkrótce.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Użytkownicy' })).toBeHidden();
});
