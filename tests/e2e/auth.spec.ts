import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signInAs } from './support/supabase';

// SPEC-002 US-1: rejestracja, logowanie e-mail + hasło, klauzula informacyjna, reset hasła (AC-1…AC-6).
// E-maile Supabase Auth trafiają do lokalnego Mailpit (`supabase start`, MAILPIT_URL z playwright.config.ts).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const PASSWORD = 'haslo-e2e-123';
const uniqueEmail = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;

/**
 * Testy z e-mailem wymagają Mailpit. CI uruchamia `supabase start -x …,mailpit,…` — do czasu usunięcia `mailpit`
 * z tej listy w .github/workflows/ci.yml (zmiana dla właściciela, PR do #44) są tam pomijane.
 */
async function requireMailpit(): Promise<void> {
  const up = await fetch(`${MAILPIT}/api/v1/info`).then((r) => r.ok, () => false);
  test.skip(!up, 'Brak Mailpit (supabase start bez -x mailpit) — Auth nie wyśle e-maili');
}

/** Link z najnowszego e-maila do adresu (ścieżka i zapytanie — host z szablonu to `site_url`). */
async function mailLink(to: string, subject: string): Promise<string> {
  let html = '';
  await expect
    .poll(async () => {
      const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"${subject}"`)}`);
      const id = ((await search.json()) as { messages: { ID: string }[] }).messages[0]?.ID;
      if (!id) return false;
      html = ((await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string }).HTML;
      return true;
    }, { timeout: 15_000 })
    .toBe(true);
  const href = /href="([^"]*token_hash=[^"]*)"/.exec(html)![1].replace(/&amp;/g, '&');
  const url = new URL(href);
  return url.pathname + url.search;
}

/** Konto z hasłem; `ack` jak po formularzu rejestracji (bez — jak pierwsze logowanie Google). */
async function createUser(email: string, { confirmed = true, ack = true } = {}): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: confirmed,
    user_metadata: ack ? { privacy_notice_ack: true } : {},
  });
  if (error) throw error;
  return data.user.id;
}

async function fillLogin(page: Page, email: string, password = PASSWORD): Promise<void> {
  const form = page.locator('form[data-login]');
  await form.getByLabel('E-mail').fill(email);
  await form.getByLabel('Hasło').fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
}

test('AC-2: „Załóż konto” nieaktywny bez zgody; link otwiera klauzulę', async ({ page }) => {
  await page.goto('/rejestracja/');
  const submit = page.getByRole('button', { name: 'Załóż konto' });
  await expect(submit).toBeDisabled();
  await page.getByRole('link', { name: 'Informacja o przetwarzaniu danych' }).click();
  const dialog = page.getByRole('dialog', { name: 'Informacja o przetwarzaniu danych osobowych' });
  await expect(dialog).toContainText('Administratorem Twoich danych osobowych');
  await dialog.getByRole('button', { name: 'Zamknij' }).click();
  await expect(dialog).toBeHidden();
  await page.getByLabel('Zapoznałem(-am) się z informacją o przetwarzaniu danych osobowych').check();
  await expect(submit).toBeEnabled();
});

test('AC-1, AC-4: rejestracja e-mailem → e-mail z potwierdzeniem → profil user z klauzulą → /konto/', async ({ page }) => {
  await requireMailpit();
  const email = uniqueEmail('rejestracja');
  await page.goto('/rejestracja/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Hasło', { exact: true }).fill('krotkie');
  await page.getByLabel('Powtórz hasło').fill('krotkie');
  await page.getByLabel('Zapoznałem(-am) się z informacją o przetwarzaniu danych osobowych').check();
  await page.getByRole('button', { name: 'Załóż konto' }).click();
  await expect(page.getByText('Hasło musi mieć co najmniej 8 znaków.')).toBeVisible();

  await page.getByLabel('Hasło', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Powtórz hasło').fill(PASSWORD);
  await page.getByRole('button', { name: 'Załóż konto' }).click();
  await expect(page.getByText('Sprawdź skrzynkę e-mail i kliknij link, aby potwierdzić konto.')).toBeVisible();

  const { data } = await admin().auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((u) => u.email === email)!;
  expect(user.email_confirmed_at ?? null).toBeNull();
  const { data: profile } = await admin().from('profiles').select('role, qr_token, full_name, privacy_notice_ack_at').eq('id', user.id).single();
  expect(profile).toMatchObject({ role: 'user', full_name: null });
  expect(profile!.qr_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(profile!.privacy_notice_ack_at).not.toBeNull();

  await page.goto(await mailLink(email, 'Potwierdź konto'));
  await expect(page).toHaveURL(/\/konto\/$/);
  await expect(page.getByRole('heading', { name: 'Moje konto' })).toBeVisible();
  await expect(page.getByText(`Zalogowano jako ${email}`)).toBeVisible();
});

test('AC-3: „Kontynuuj z Google” na /logowanie/ i /rejestracja/ wraca na /konto/ z ?next=', async ({ page }) => {
  const redirects: string[] = [];
  await page.route('**/auth/v1/authorize**', (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('provider')).toBe('google');
    redirects.push(url.searchParams.get('redirect_to')!);
    return route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto('/logowanie/?next=/panel/');
  await page.getByRole('button', { name: 'Kontynuuj z Google' }).click();
  await expect.poll(() => redirects.length).toBe(1);
  await page.goto('/rejestracja/');
  await page.getByRole('button', { name: 'Kontynuuj z Google' }).click();
  await expect.poll(() => redirects.length).toBe(2);
  expect(redirects.map((r) => new URL(r).pathname + new URL(r).search)).toEqual(['/konto/?next=%2Fpanel%2F', '/konto/']);
});

test('AC-3: pierwsze logowanie bez potwierdzonej klauzuli (Google) → klauzula i „Rozumiem” → privacy_notice_ack_at', async ({ page }) => {
  const email = uniqueEmail('google');
  const id = await createUser(email, { ack: false });
  await signInAs(page, email, PASSWORD);
  await page.goto('/konto/');
  await expect(page.getByRole('heading', { name: 'Informacja o przetwarzaniu danych osobowych' })).toBeVisible();
  await expect(page.getByText(/^Administratorem Twoich danych osobowych/)).toBeVisible();
  await page.getByRole('button', { name: 'Rozumiem' }).click();
  await expect(page.getByRole('heading', { name: 'Moje konto' })).toBeVisible();
  const { data } = await admin().from('profiles').select('privacy_notice_ack_at').eq('id', id).single();
  expect(data!.privacy_notice_ack_at).not.toBeNull();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Moje konto' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rozumiem' })).toBeHidden();
});

test('AC-5: złe dane, ?next= tylko w aplikacji, domyślnie /konto/', async ({ page }) => {
  const email = uniqueEmail('logowanie');
  await createUser(email);
  await page.goto('/logowanie/');
  await fillLogin(page, email, 'zle-haslo-123');
  await expect(page.getByText('Nieprawidłowy e-mail lub hasło.')).toBeVisible();

  await page.goto('/logowanie/?next=//evil.example/');
  await fillLogin(page, email);
  await expect(page).toHaveURL(/\/konto\/$/);
  await expect(page.getByRole('heading', { name: 'Moje konto' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('link', { name: 'Moje konto' })).toBeVisible();

  await page.getByRole('button', { name: 'Wyloguj się' }).click();
  await expect(page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('link', { name: 'Zaloguj się' })).toHaveAttribute('href', '/logowanie/');
  await page.goto('/logowanie/?next=/zawody/');
  await fillLogin(page, email);
  await expect(page).toHaveURL(/\/zawody\/$/);
});

test('AC-5: niepotwierdzony e-mail → komunikat i „Wyślij link ponownie”', async ({ page }) => {
  await requireMailpit();
  const email = uniqueEmail('niepotwierdzony');
  await createUser(email, { confirmed: false });
  await page.goto('/logowanie/');
  await fillLogin(page, email);
  await expect(page.getByText('Potwierdź adres e-mail — link wysłaliśmy w wiadomości po rejestracji.')).toBeVisible();
  await page.getByRole('button', { name: 'Wyślij link ponownie' }).click();
  await expect(page.getByText('Wysłaliśmy nowy link. Sprawdź skrzynkę e-mail.')).toBeVisible();
  expect(await mailLink(email, 'Potwierdź konto')).toMatch(/^\/konto\/\?token_hash=.+&type=email$/);
});

test('AC-6: „Nie pamiętam hasła” bez ujawniania konta → link → /logowanie/nowe-haslo/ → nowe hasło działa', async ({ page }) => {
  await requireMailpit();
  const email = uniqueEmail('reset');
  await createUser(email);
  const message = 'Jeśli konto istnieje, wysłaliśmy link do zmiany hasła.';
  for (const address of [uniqueEmail('nie-ma-konta'), email]) {
    await page.goto('/logowanie/');
    await page.getByRole('button', { name: 'Nie pamiętam hasła' }).click();
    await page.locator('#reset').getByLabel('E-mail').fill(address);
    await page.getByRole('button', { name: 'Wyślij link' }).click();
    await expect(page.getByText(message)).toBeVisible();
  }

  const link = await mailLink(email, 'Zmiana hasła');
  expect(link).toMatch(/^\/logowanie\/nowe-haslo\//);
  await page.goto(link);
  await page.getByLabel('Nowe hasło').fill('nowe-haslo-456');
  await page.getByLabel('Powtórz hasło').fill('nowe-haslo-457');
  await page.getByRole('button', { name: 'Zapisz hasło' }).click();
  await expect(page.getByText('Hasła nie są takie same.')).toBeVisible();
  await page.getByLabel('Powtórz hasło').fill('nowe-haslo-456');
  await page.getByRole('button', { name: 'Zapisz hasło' }).click();
  await expect(page.getByText('Hasło zostało zmienione.')).toBeVisible();

  await page.getByRole('link', { name: 'Przejdź do swojego konta' }).click();
  await page.getByRole('button', { name: 'Wyloguj się' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await page.goto('/logowanie/');
  await fillLogin(page, email, 'nowe-haslo-456');
  await expect(page).toHaveURL(/\/konto\/$/);
});

test('AC-6: link bez sesji → komunikat o nieważnym linku', async ({ page }) => {
  await page.goto('/logowanie/nowe-haslo/?token_hash=zly&type=recovery');
  await expect(page.getByText('Link do zmiany hasła wygasł lub jest nieprawidłowy.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zapisz hasło' })).toBeHidden();
});
