import { expect, test, type Page } from '@playwright/test';
import { admin, ensureRangeDuty, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-005 US-3, US-4 (AC-5…AC-12): wpis osoby z kontem w `/panel/ksiazka/` — skan QR, wyszukanie, uzupełnienie
// danych, lista uprawnień, „Sprzedaj na miejscu”; skan QR także w `/panel/sprzedaz/`.
// Reguły bazy: pgTAP supabase/tests/013_range_log_test.sql (kolejność, staff_find_by_qr) i 018_range_log_person_test.sql.
// Kamera: atrapa `getUserMedia` + `BarcodeDetector` zwracająca podany kod (CI nie ma kamery).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const todayType = () => {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(new Date());
  return day === 'Sat' || day === 'Sun' ? 'weekend' : 'weekday';
};

interface Person {
  id: string;
  email: string;
  fullName: string;
  qrToken: string;
}

async function seedPerson(profile: Record<string, string | null> = {}): Promise<Person> {
  const db = admin();
  const email = `${unique('wpis').replace(/\s/g, '-')}@example.test`;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  expect(error).toBeNull();
  const id = data.user!.id;
  const fullName = unique('Jan Wpisywany');
  const { data: row, error: updateError } = await db
    .from('profiles')
    .update({ full_name: fullName, address: 'ul. Stalowa 1, Katowice', ...profile })
    .eq('id', id)
    .select('qr_token')
    .single();
  expect(updateError).toBeNull();
  return { id, email, fullName, qrToken: row!.qr_token as string };
}

/** Opłacone uprawnienie (`fulfil_order` kluczem secret). */
async function seedPass(userId: string, product: Record<string, unknown>): Promise<string> {
  const db = admin();
  const name = unique(String(product.name));
  const { data: created, error } = await db.from('products').insert({ price: 1000, ...product, name }).select('id').single();
  expect(error).toBeNull();
  const { data: order } = await db
    .from('orders')
    .insert({ user_id: userId, product_id: created!.id, item_name: name, amount: 1000, payment_method: 'on_site', on_site_method: 'cash' })
    .select('id')
    .single();
  expect((await db.rpc('fulfil_order', { p_order_id: order!.id })).error).toBeNull();
  return name;
}

/** Atrapa kamery: kanwa jako strumień, `BarcodeDetector` „odczytuje” `code`. */
async function fakeCamera(page: Page, code: string): Promise<void> {
  await page.addInitScript((value) => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      static async getSupportedFormats() {
        return ['qr_code'];
      }
      async detect() {
        return [{ rawValue: value }];
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      canvas.getContext('2d')!.fillRect(0, 0, 64, 64);
      return canvas.captureStream();
    };
  }, code);
}

/** Dyżurny Prowadzący (SPEC-007 AC-16) — przebieg wpisu jest dostępny, gdy dyżurny jest ustawiony. */
async function openRangeLog(page: Page, path = '/panel/ksiazka/'): Promise<void> {
  const officer = await ensureRangeDuty();
  await page.goto(path);
  await expect(page.getByRole('main').getByText('Prowadzący strzelanie:')).toContainText(officer);
}

const passOptions = (page: Page) => page.getByRole('group', { name: 'Uprawnienie do wykorzystania' }).getByRole('radio');

test.describe('obsługa — /panel/ksiazka/', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'staff');
  });

  test('AC-5, AC-10, AC-11: skan QR → osoba gotowa, uprawnienia w kolejności z opisem skutku', async ({ page }) => {
    const person = await seedPerson();
    const entries = await seedPass(person.id, { kind: 'entries', name: 'Karnet 5 wejść', entries: 5 });
    const days = await seedPass(person.id, { kind: 'days', name: 'Karnet 3 dni', days: 3 });
    await fakeCamera(page, person.qrToken);
    await openRangeLog(page);

    await page.getByRole('button', { name: 'Skanuj kod QR' }).click();
    const card = page.getByRole('main');
    await expect(card.getByRole('heading', { name: person.fullName })).toBeVisible();
    await expect(card.getByText('Gotowy do wpisu do książki')).toBeVisible();

    // (2) nieaktywowany czasowy przed (3) ilościowym; domyślnie pierwsza pozycja.
    await expect(passOptions(page)).toHaveCount(2);
    await expect(passOptions(page).nth(0)).toBeChecked();
    await expect(page.getByRole('radio', { name: new RegExp(`^${days} — aktywacja dziś, ważny do \\d{2}\\.\\d{2}$`) })).toBeVisible();
    await expect(page.getByLabel(`${entries} — zostanie 4`)).toBeVisible();

    await page.getByLabel(`${entries} — zostanie 4`).check();
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByRole('heading', { name: 'Wpis do książki rejestru pobytu' })).toBeVisible();
    await expect(page.locator('[data-sign-field="pass"]')).toHaveText(`${entries} — zostanie 4`);
  });

  test('AC-5: nieznany kod → „Nie znaleziono konta dla tego kodu.”', async ({ page }) => {
    await fakeCamera(page, 'nieznany-kod-qr-0123456789');
    await openRangeLog(page);
    await page.getByRole('button', { name: 'Skanuj kod QR' }).click();
    await expect(page.getByText('Nie znaleziono konta dla tego kodu.')).toBeVisible();
  });

  test('AC-6, AC-7, AC-12: wyszukanie po e-mailu, uzupełnienie danych (audit_log), brak uprawnienia', async ({ page }) => {
    const person = await seedPerson({ full_name: null, address: null });
    await openRangeLog(page);

    await page.getByLabel('Imię i nazwisko lub e-mail').fill(person.email.slice(0, 2));
    await page.getByRole('button', { name: 'Szukaj' }).click();
    await expect(page.getByText('Wpisz co najmniej 3 znaki.').last()).toBeVisible();

    await page.getByLabel('Imię i nazwisko lub e-mail').fill(person.email);
    await page.getByRole('button', { name: 'Szukaj' }).click();
    const hit = page.getByRole('listitem').filter({ hasText: person.email.slice(0, 2) + '…@example.test' });
    await expect(hit).toHaveCount(1);
    await hit.getByRole('button', { name: /^Wybierz/ }).click();

    await expect(page.getByText('Brakuje danych:')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dalej' })).toBeDisabled();
    await page.getByRole('button', { name: 'Uzupełnij dane' }).click();
    await page.locator('[data-person]').getByLabel('Imię i nazwisko', { exact: true }).fill(person.fullName);
    await page.locator('[data-person]').getByLabel('Numer decyzji (pozwolenia na broń)').fill('AB 123');
    await page.getByRole('button', { name: 'Zapisz dane' }).click();
    await expect(page.getByText('Podaj numer decyzji razem z organem wydającym.')).toBeVisible();
    await page.locator('[data-person]').getByLabel('Organ wydający').fill('KWP Katowice');
    await page.getByRole('button', { name: 'Zapisz dane' }).click();
    await expect(page.getByText('Dane zapisane.')).toBeVisible();
    await expect(page.getByText('Gotowy do wpisu do książki')).toBeVisible();

    const { data: log } = await admin().from('audit_log').select('actor_id, changes').eq('target_user_id', person.id);
    expect(log).toHaveLength(1);
    expect(log![0].changes).toMatchObject({ full_name: [null, person.fullName], permit_number: [null, 'AB 123'] });
    const { data: actor } = await admin().from('profiles').select('role').eq('id', log![0].actor_id).single();
    expect(actor?.role).toBe('staff');

    // AC-12: brak uprawnienia na dziś.
    await expect(page.getByText('Brak ważnego karnetu lub wejścia na dziś.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sprzedaj na miejscu' })).toHaveAttribute(
      'href',
      `/panel/sprzedaz/?osoba=${person.id}&powrot=ksiazka`,
    );
    await expect(page.getByRole('button', { name: 'Dalej' })).toBeDisabled();
    await page.getByRole('button', { name: 'Wpisz jako osobę towarzyszącą' }).click();
    await expect(page.locator('[data-sign-field="pass"]')).toHaveText('osoba towarzysząca (bez zużycia uprawnienia)');
  });

  test('AC-12: „Sprzedaj na miejscu” → sprzedaż → powrót do wpisu z nowym uprawnieniem', async ({ page }) => {
    const person = await seedPerson();
    const product = unique('Wejście dziś');
    const db = admin();
    const { data: created } = await db
      .from('products')
      .insert({ kind: 'single_entry', name: product, price: 4000, day_type: todayType() })
      .select('id')
      .single();
    await db.from('products').update({ is_active: true }).eq('id', created!.id);

    await openRangeLog(page, `/panel/ksiazka/?osoba=${person.id}`);
    await page.getByRole('link', { name: 'Sprzedaj na miejscu' }).click();
    await expect(page.getByText(`Wybrana osoba: ${person.fullName}`)).toBeVisible();
    await page.getByLabel('Produkt lub wejściówka *').selectOption({ label: `${product} — 40,00 zł` });
    await page.getByLabel('Gotówka').check();
    await page.getByRole('button', { name: 'Zarejestruj sprzedaż' }).click();

    await expect(page).toHaveURL(new RegExp(`/panel/ksiazka/\\?osoba=${person.id}$`));
    await expect(page.getByRole('heading', { name: person.fullName })).toBeVisible();
    await expect(page.getByLabel(`${product} — zostanie wykorzystane`)).toBeChecked();
  });

  test('AC-9: osoba ma dziś wpis → ostrzeżenie z godziną, „Kontynuuj”', async ({ page }) => {
    const person = await seedPerson();
    // Tu tylko godzina ostatniego wpisu z `staff_person_by_id` (wartość liczy baza — pgTAP 013).
    await page.route('**/rest/v1/rpc/staff_person_by_id', async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as Record<string, unknown>[];
      await route.fulfill({ response, json: rows.map((row) => ({ ...row, last_entry_today: '2027-03-10T09:32:00Z' })) });
    });
    await openRangeLog(page, `/panel/ksiazka/?osoba=${person.id}`);

    await expect(page.getByText('Ta osoba ma dziś wpis o 10:32. Kontynuować?')).toBeVisible();
    await expect(page.getByText('Gotowy do wpisu do książki')).toBeHidden();
    await page.getByRole('button', { name: 'Kontynuuj' }).click();
    await expect(page.getByText('Gotowy do wpisu do książki')).toBeVisible();
  });
});

test('AC-5: skan QR w /panel/sprzedaz/ wybiera osobę', async ({ page }) => {
  const person = await seedPerson();
  await signIn(page, 'staff');
  await fakeCamera(page, person.qrToken);
  await page.goto('/panel/sprzedaz/');
  await page.getByRole('button', { name: 'Skanuj kod QR' }).click();
  await expect(page.getByText(`Wybrana osoba: ${person.fullName}`)).toBeVisible();
});

test('AC-8: admin — „Rozpocznij wpis do książki” w karcie użytkownika', async ({ page }) => {
  const person = await seedPerson();
  await seedPass(person.id, { kind: 'entries', name: 'Karnet 10 wejść', entries: 10 });
  await signIn(page, 'admin');
  await page.goto(`/panel/uzytkownicy/profil/?id=${person.id}`);
  const start = page.getByRole('link', { name: 'Rozpocznij wpis do książki' });
  await expect(start).toHaveAttribute('href', `/panel/ksiazka/?osoba=${person.id}`);

  await ensureRangeDuty();
  await start.click();
  await expect(page.getByRole('heading', { name: person.fullName })).toBeVisible();
  await expect(passOptions(page)).toHaveCount(1);
  await expect(passOptions(page).first()).toBeChecked();
});
