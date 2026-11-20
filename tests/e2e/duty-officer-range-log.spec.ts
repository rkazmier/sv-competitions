import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signInAs, unique } from './support/supabase';

// SPEC-008 (UI): dyżurny Prowadzący z konta prowadzi książkę w dniu dyżuru — AC-1…AC-4, AC-8, AC-11, AC-14.
// Uprawnienia w bazie — pgTAP: supabase/tests/032_duty_officer_range_log_test.sql.
// Dyżurny jest jeden dla całej bazy: ten plik działa w osobnym projekcie Playwright po testach dyżurnego
// i grafiku (playwright.config.ts) i szeregowo.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'local-e2e-duty-password';
const FORBIDDEN = 'Nie masz uprawnień do panelu.';
const FORBIDDEN_NOTE = 'Książkę może prowadzić dyżurny Prowadzący w dniu dyżuru albo Obsługa strzelnicy.';
const DUTY_TODAY = 'Dziś jesteś dyżurnym Prowadzącym.';
const LOST = 'Nie jesteś już dyżurnym Prowadzącym — wpis nie został zapisany. Książkę prowadzi teraz Obsługa lub nowy dyżurny.';

async function today(): Promise<string> {
  const { data, error } = await admin().rpc('range_today');
  if (error) throw error;
  return data as string;
}

async function clearDuty(): Promise<void> {
  const { error } = await admin().from('range_duty').delete().eq('day', await today());
  if (error) throw error;
}

async function setDuty(officerId: string): Promise<void> {
  const { error } = await admin()
    .from('range_duty')
    .upsert({ day: await today(), source: 'book', range_officer_id: officerId }, { onConflict: 'day,source' });
  if (error) throw error;
}

/** Konto (rola `user`) z zatwierdzonymi uprawnieniami prowadzącego (SPEC-007). */
async function accountOfficer(name: string): Promise<{ email: string; officerId: string }> {
  const db = admin();
  const email = `${unique('dyzurny-konto').replace(/\s/g, '-')}@example.test`;
  // Klauzula potwierdzona — inaczej `/konto/` pokazuje ekran pierwszego logowania zamiast „Twoje dane”.
  const { data: user, error: userError } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  if (userError || !user.user) throw userError ?? new Error('Brak konta');
  await db.from('profiles').update({ full_name: name }).eq('id', user.user.id);
  const { data, error } = await db
    .from('range_officers')
    .insert({ full_name: name, profile_id: user.user.id, license_number: '1', institution: 'PZSS', status: 'approved' })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Brak prowadzącego');
  return { email, officerId: data.id as string };
}

const main = (page: Page) => page.getByRole('main');
const menu = (page: Page) => page.locator('[data-panel-menu="duty"]');

test.beforeEach(clearDuty);
test.afterAll(clearDuty);

test('AC-1, AC-2: dyżurny z konta — wejście z /konto/, „Dyżurny: …” bez „Zmień”, menu tylko „Książka”', async ({ page }) => {
  const name = unique('Dyżurna Z Konta');
  const { email, officerId } = await accountOfficer(name);
  await setDuty(officerId);
  await signInAs(page, email, PASSWORD);

  await page.goto('/konto/');
  const data = page.getByRole('region', { name: 'Twoje dane' });
  await expect(data.getByText(DUTY_TODAY)).toBeVisible();
  await data.getByRole('link', { name: 'Otwórz książkę rejestru pobytu' }).click();

  await expect(page).toHaveURL(/\/panel\/ksiazka\/$/);
  await expect(main(page).getByText('Dyżurny:')).toBeVisible();
  await expect(main(page).locator('[data-officer-name]')).toHaveText(name);
  await expect(main(page).locator('[data-change-officer]')).toBeHidden();
  await expect(main(page).getByRole('heading', { name: 'Kto prowadzi dziś strzelanie?' })).toBeHidden();
  await expect(main(page).getByRole('heading', { name: 'Kogo wpisujemy?' })).toBeVisible();
  // AC-11: lista dzisiejszych wpisów jak u Obsługi.
  await expect(main(page).getByRole('heading', { name: 'Dzisiejsze wpisy' })).toBeVisible();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole('link')).toHaveText(['Książka']);
});

test('AC-2, AC-4: /panel/ prowadzi do książki; pozostałe strony panelu — brak uprawnień', async ({ page }) => {
  const { email, officerId } = await accountOfficer(unique('Dyżurny Panel'));
  await setDuty(officerId);
  await signInAs(page, email, PASSWORD);

  await page.goto('/panel/');
  await expect(page).toHaveURL(/\/panel\/ksiazka\/$/);
  await expect(main(page).getByRole('heading', { name: 'Kogo wpisujemy?' })).toBeVisible();

  for (const path of ['/panel/dyzury/', '/panel/prowadzacy/', '/panel/sprzedaz/', '/panel/ksiazka/przeglad/']) {
    await page.goto(path);
    await expect(main(page).getByText(FORBIDDEN)).toBeVisible();
    await expect(main(page).getByText(FORBIDDEN_NOTE)).toBeHidden();
  }
});

test('AC-3: zatwierdzony prowadzący, który nie jest dziś dyżurnym — brak uprawnień z dopiskiem, bez wejścia w /konto/', async ({ page }) => {
  const { email } = await accountOfficer(unique('Nie Dyżurny'));
  await signInAs(page, email, PASSWORD);

  await page.goto('/panel/ksiazka/');
  await expect(main(page).getByText(FORBIDDEN)).toBeVisible();
  await expect(main(page).getByText(FORBIDDEN_NOTE)).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Kto prowadzi dziś strzelanie?' })).toBeHidden();

  await page.goto('/konto/');
  await expect(page.getByText('Uprawnienia prowadzącego: zatwierdzone')).toBeVisible();
  await expect(page.getByText(DUTY_TODAY)).toBeHidden();
});

test('AC-8: osoba bez konta bez uprawnienia — komunikat o Obsłudze i tylko osoba towarzysząca', async ({ page }) => {
  const { email, officerId } = await accountOfficer(unique('Dyżurny Gość'));
  await setDuty(officerId);
  await signInAs(page, email, PASSWORD);

  await page.goto('/panel/ksiazka/');
  await main(page).getByRole('button', { name: 'Osoba bez konta' }).click();
  const guestForm = page.locator('[data-guest]');
  await guestForm.getByLabel('Imię i nazwisko *').fill(unique('Anna Gość'));
  await guestForm.getByLabel('Adres zamieszkania').fill('ul. Stalowa 1, 00-001 Warszawa');
  await guestForm.getByRole('button', { name: 'Dalej' }).click();

  await expect(guestForm.getByText('Brak ważnego karnetu lub wejścia na dziś. Sprzedaż na miejscu prowadzi Obsługa.')).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Sprzedaj na miejscu' })).toBeHidden();
  await expect(main(page).getByRole('heading', { name: /^Sprzedaż na miejscu/ })).toBeHidden();
  await guestForm.getByRole('button', { name: 'Wpisz jako osobę towarzyszącą' }).click();
  await expect(main(page).getByRole('heading', { name: 'Wpis do książki rejestru pobytu' })).toBeVisible();
});

test('AC-14: Obsługa zmienia dyżurnego — komunikat, „Odśwież” prowadzi do braku uprawnień', async ({ page }) => {
  const { email, officerId } = await accountOfficer(unique('Dyżurny Odwołany'));
  const { officerId: otherId } = await accountOfficer(unique('Nowy Dyżurny'));
  await setDuty(officerId);
  await signInAs(page, email, PASSWORD);
  await page.goto('/panel/ksiazka/');
  await expect(main(page).getByRole('heading', { name: 'Kogo wpisujemy?' })).toBeVisible();

  // Obsługa ustawia innego dyżurnego (zmiana w książce — ten sam wiersz `range_duty`, co „Zmień”).
  await setDuty(otherId);

  await main(page).getByLabel('Imię i nazwisko lub e-mail').fill('Kowalski');
  await main(page).getByRole('button', { name: 'Szukaj', exact: true }).click();
  await expect(main(page).getByText(LOST)).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Kogo wpisujemy?' })).toBeHidden();

  await main(page).getByRole('button', { name: 'Odśwież' }).click();
  await expect(main(page).getByText(FORBIDDEN)).toBeVisible();
  await expect(main(page).getByText(FORBIDDEN_NOTE)).toBeVisible();
});
