import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, signInAs, unique } from './support/supabase';

// SPEC-012 US-6 (AC-30…AC-34): zamknięcia strzelnicy w panelu i „Przedłużono o…” w `/konto/`.
// Zasady przedłużenia (które uprawnienia, `valid_until`, `audit_log`, RLS) sprawdza pgTAP:
// supabase/tests/039_range_closures_test.sql.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PASSWORD = 'haslo-e2e-123';
const DAY = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Losowy 10-dniowy okres w przeszłości (zamknięcia nie mogą się nakładać, a lokalna baza przeżywa kolejne uruchomienia).
 * Kończy się najpóźniej 30 dni temu — nie dotyka uprawnień kupionych dziś przez inne testy.
 */
function pastPeriod(): { from: string; to: string } {
  const start = Date.now() - (40 + 10 * Math.floor(Math.random() * 300)) * DAY;
  return { from: isoDay(new Date(start)), to: isoDay(new Date(start + 9 * DAY)) };
}

/** Konto z aktywnym karnetem ilościowym kupionym dawno temu (ważnym w każdym okresie z `pastPeriod`). */
async function accountWithPass(): Promise<{ email: string; passId: string; expiresOn: string }> {
  const db = admin();
  const email = `zamkniecie-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;
  const { data: user, error } = await db.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { privacy_notice_ack: true },
  });
  if (error) throw error;
  const name = unique('Karnet Z');
  const { data: product } = await db.from('products').insert({ kind: 'entries', name, price: 12000, entries: 10 }).select('id').single();
  const { data: order } = await db
    .from('orders')
    .insert({ user_id: user.user.id, product_id: product!.id, item_name: name, amount: 12000, payment_method: 'tpay' })
    .select('id')
    .single();
  const { data: passId, error: fulfilError } = await db.rpc('fulfil_order', { p_order_id: order!.id });
  expect(fulfilError).toBeNull();
  const expiresOn = isoDay(new Date(Date.now() + 100 * DAY));
  await db.from('user_passes')
    .update({ created_at: new Date(Date.now() - 3200 * DAY).toISOString(), expires_on: expiresOn })
    .eq('id', passId);
  return { email, passId: passId as string, expiresOn };
}

async function fillClosure(page: Page, from: string, to: string, reason: string): Promise<void> {
  await page.getByLabel('Od *').fill(from);
  await page.getByLabel('Do *').fill(to);
  await page.getByLabel('Przyczyna *').fill(reason);
  await page.getByRole('button', { name: 'Dalej' }).click();
}

test('AC-30, AC-31, AC-32, AC-34: podgląd, walidacja, zapis z przedłużeniem i lista zamknięć', async ({ page }) => {
  const pass = await accountWithPass();
  const { from, to } = pastPeriod();
  const reason = unique('Remont kulochwytu');
  await signIn(page, 'admin');
  await page.goto('/panel/');
  await page.getByRole('navigation').getByRole('link', { name: 'Zamknięcia' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Zamknięcia strzelnicy' })).toBeVisible();
  await expect(page.getByText('Widoczna tylko dla admina. Nie wpisuj danych osobowych.')).toBeVisible();

  // AC-31: 7 dni — za krótko.
  await fillClosure(page, from, isoDay(new Date(Date.parse(from) + 6 * DAY)), reason);
  await expect(page.getByRole('alert')).toHaveText('Przedłużenie przysługuje przy zamknięciu dłuższym niż 7 kolejnych dni.');

  // AC-30: podgląd przed zapisem; „Wróć” wraca do formularza.
  await fillClosure(page, from, to, reason);
  const preview = page.getByText(/^Zamknięcie: 10 dni\. Ważność przedłuży się o 10 dni dla \d+ uprawnień\.$/);
  await expect(preview).toBeVisible();
  await page.getByRole('button', { name: 'Wróć' }).click();
  await expect(preview).toBeHidden();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Zapisz i przedłuż' }).click();
  await expect(page.getByRole('status')).toContainText('Zapisano. Przedłużono ważność');

  // AC-32: `expires_on += 10`.
  const { data: saved } = await admin().from('user_passes').select('expires_on').eq('id', pass.passId).single();
  expect(saved!.expires_on).toBe(isoDay(new Date(Date.parse(pass.expiresOn) + 10 * DAY)));

  // AC-34: wiersz listy (od–do, dni, przyczyna, kto, kiedy); bez edycji i usuwania.
  const row = page.getByRole('row').filter({ hasText: reason });
  await expect(row.getByRole('cell').nth(1)).toHaveText('10');
  await expect(row.getByRole('button')).toHaveCount(0);

  // AC-31: ten sam okres ponownie — nakładanie.
  await fillClosure(page, from, to, 'Powtórka');
  await expect(page.getByRole('alert')).toHaveText('Ten okres nakłada się na zapisane zamknięcie.');
});

test('AC-33: w /konto/ przy karnecie nowa data „Ważny do” i „Przedłużono o 10 dni (zamknięcie strzelnicy …)”', async ({ page }) => {
  const pass = await accountWithPass();
  const { from, to } = pastPeriod();
  const db = admin();
  // Zamknięcie jak po `add_range_closure` (funkcja wymaga sesji admina — tu klucz secret).
  const { data: closure, error } = await db
    .from('range_closures')
    .insert({ starts_on: from, ends_on: to, reason: 'Zamknięcie E2E', days: 10, passes_count: 1 })
    .select('id')
    .single();
  expect(error).toBeNull();
  const extended = isoDay(new Date(Date.parse(pass.expiresOn) + 10 * DAY));
  await db.from('range_closure_passes').insert({ closure_id: closure!.id, user_pass_id: pass.passId, expires_on_before: pass.expiresOn });
  await db.from('user_passes').update({ expires_on: extended }).eq('id', pass.passId);

  await signInAs(page, pass.email, PASSWORD);
  await page.goto('/konto/');
  const short = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return { d: String(Number(d)), m, y };
  };
  const a = short(from);
  const b = short(to);
  const period = a.y !== b.y ? `${a.d}.${a.m}.${a.y}–${b.d}.${b.m}.${b.y}` : a.m !== b.m ? `${a.d}.${a.m}–${b.d}.${b.m}.${b.y}` : `${a.d}–${b.d}.${b.m}.${b.y}`;
  const card = page.locator('.pass-item').filter({ hasText: 'Przedłużono' });
  await expect(card).toContainText(`Przedłużono o 10 dni (zamknięcie strzelnicy ${period}).`);
  const validTo = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${extended}T00:00:00Z`));
  await expect(card).toContainText(`Ważny do: ${validTo}`);
});
