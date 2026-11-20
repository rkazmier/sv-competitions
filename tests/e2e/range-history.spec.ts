import { expect, test, type Page } from '@playwright/test';
import { E2E_DUTY_OFFICER, admin, ensureRangeDuty, hasLocalSupabase, signIn, signInAs, unique } from './support/supabase';

// SPEC-005 US-7, US-8 (AC-21…AC-25): adnotacje na liście dzisiejszych wpisów, „Historia wejść” i historia zużycia
// w `/konto/`, „Cofnij zużycie” w karcie użytkownika. Reguły bazy (RLS, niezmienność, cofnięcie): pgTAP 013, 020.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'local-e2e-only-password';
const ADDRESS = 'ul. Stalowa 1, Katowice';
let person: { id: string; email: string; fullName: string; passId: string; passName: string };

test.beforeAll(async () => {
  const db = admin();
  const email = `${unique('historia').replace(/\s/g, '-')}@example.test`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  expect(error).toBeNull();
  const id = data.user!.id;
  const fullName = unique('Jan Historia');
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
  person = { id, email, fullName, passId: pass!.id as string, passName };
});

async function drawSignature(page: Page): Promise<void> {
  const pad = page.getByRole('img', { name: /Pole podpisu/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 40, { steps: 30 });
  await page.mouse.up();
}

test('AC-21, AC-22: obsługa widzi dzisiejszy wpis na liście i dodaje adnotację', async ({ page }) => {
  await signIn(page, 'staff');
  const officer = await ensureRangeDuty();
  await page.goto(`/panel/ksiazka/?osoba=${person.id}`);
  await expect(page.getByRole('main').getByText('Prowadzący strzelanie:')).toContainText(officer);
  await page.getByRole('button', { name: 'Dalej' }).click();
  // Ekran podpisu (tryb „podaj urządzenie”) nie pokazuje listy wpisów innych osób.
  await expect(page.getByRole('heading', { name: 'Dzisiejsze wpisy' })).toBeHidden();
  await drawSignature(page);
  await page.getByRole('button', { name: 'Zapisz wpis' }).click();
  await expect(page.getByText(new RegExp(`^Wpisano do książki: ${person.fullName}, `))).toBeVisible();

  const today = page.locator('[data-today]');
  const item = today.getByRole('listitem').filter({ hasText: person.fullName });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: new RegExp(`Dodaj adnotację do wpisu: ${person.fullName}`) }).click();
  const field = item.getByLabel('Treść adnotacji (5–500 znaków)');
  await field.fill('abc');
  await item.getByRole('button', { name: 'Zapisz adnotację' }).click();
  await expect(item.getByText('Adnotacja musi mieć co najmniej 5 znaków.')).toBeVisible();

  // AC-22: odrzucenie przez RLS (wpis z innego dnia) — komunikat; reguła bazy w pgTAP 013.
  await page.route('**/rest/v1/range_log_annotations*', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 403, json: { code: '42501', message: 'new row violates row-level security policy', details: null, hint: null } })
      : route.fallback(),
  );
  await field.fill('Literówka w adresie');
  await item.getByRole('button', { name: 'Zapisz adnotację' }).click();
  await expect(item.getByText('Adnotację do wpisu z innego dnia może dodać tylko admin.')).toBeVisible();
  await page.unroute('**/rest/v1/range_log_annotations*');

  await item.getByRole('button', { name: 'Zapisz adnotację' }).click();
  await expect(today.getByRole('listitem').filter({ hasText: person.fullName }).getByText(/: Literówka w adresie$/)).toBeVisible();
  const { data } = await admin().from('range_log_annotations').select('body, range_log!inner(profile_id)').eq('range_log.profile_id', person.id);
  expect(data?.map((row) => row.body)).toEqual(['Literówka w adresie']);
});

test('AC-24, AC-25: użytkownik widzi historię wejść i historię zużycia karnetu', async ({ page }) => {
  await signInAs(page, person.email, PASSWORD);
  await page.goto('/konto/');
  const entries = page.getByRole('region', { name: 'Historia wejść' });
  const row = entries.getByRole('row').nth(1);
  await expect(row.getByRole('cell').nth(0)).toHaveText(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
  await expect(row.getByRole('cell').nth(1)).toHaveText(E2E_DUTY_OFFICER);
  await expect(row.getByRole('cell').nth(2)).toHaveText(person.passName);
  await expect(entries.locator('img, canvas')).toHaveCount(0);

  const pass = page.locator('.pass-item').filter({ hasText: person.passName });
  await pass.getByText('Historia zużycia').click();
  await expect(pass.getByRole('listitem')).toHaveText([/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/]);
});

test('AC-23: admin cofa zużycie w karcie użytkownika — licznik +1, adnotacja, historia zmian', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto(`/panel/uzytkownicy/profil/?id=${person.id}`);
  const passes = page.getByRole('region', { name: 'Karnety i zużycie' });
  await expect(passes.getByRole('heading', { name: person.passName })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await passes.getByRole('button', { name: /^Cofnij zużycie z dnia/ }).click();
  await expect(passes.getByText('Cofnięto zużycie karnetu.')).toBeVisible();
  await expect(passes.getByRole('button', { name: /^Cofnij zużycie/ })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historia zmian' }).getByText(/^Cofnięto zużycie karnetu z dnia /)).toBeVisible();

  const db = admin();
  expect((await db.from('user_passes').select('entries_left').eq('id', person.passId).single()).data!.entries_left).toBe(5);
  const { data: entry } = await db.from('range_log').select('id').eq('profile_id', person.id).single();
  expect(entry).not.toBeNull();
  const { data: notes } = await db.from('range_log_annotations').select('body').eq('entry_id', entry!.id).order('created_at');
  expect(notes?.map((note) => note.body)).toEqual(['Literówka w adresie', 'Cofnięto zużycie karnetu']);
});
