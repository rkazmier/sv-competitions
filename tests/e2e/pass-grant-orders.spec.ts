import { expect, test, type Page } from '@playwright/test';
import { admin, ensureUser, hasLocalSupabase, signIn, signInAs, unique } from './support/supabase';

// SPEC-010 US-2…US-4 (AC-12…AC-21, warstwa UI): prezent w `/konto/`, w `/panel/zamowienia/` (filtr, powód, CSV,
// „Anuluj przyznanie”) i w profilu osoby. Reguły bazy (`cancel_pass_grant`, `cancel_order` → `order_is_gift`,
// `set_order_invoice_details` → `invoice_not_available`) sprawdza pgTAP: supabase/tests/033_pass_grant_test.sql.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PASSWORD = 'haslo-e2e-123';
const REASON = 'Nagroda — zawody E2E';

async function userId(email: string): Promise<string> {
  const { data, error } = await admin().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)!.id;
}

/** Konto obdarowanej osoby (z potwierdzoną klauzulą); `page` — zalogowanie w jej imieniu. */
async function seedPerson(page?: Page): Promise<{ id: string; fullName: string }> {
  const db = admin();
  const fullName = unique('Ola Obdarowana');
  const email = `${unique('prezent-ui').replace(/\s/g, '-')}@example.test`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  if (error) throw error;
  expect((await db.from('profiles').update({ full_name: fullName }).eq('id', data.user.id)).error).toBeNull();
  if (page) await signInAs(page, email, PASSWORD);
  return { id: data.user.id, fullName };
}

/**
 * Przyznanie jak `grant_pass` (ta funkcja wymaga sesji admina): zamówienie `gift` 0,00 zł, powód w `order_grants`,
 * uprawnienie przez `fulfil_order`, wpis `pass_grant` w dzienniku. Zwraca numer zamówienia.
 */
async function seedGift(personId: string): Promise<{ orderId: string; orderNumber: string; item: string }> {
  const db = admin();
  const item = unique('Karnet prezent UI');
  const { data: product, error: productError } = await db
    .from('products')
    .insert({ kind: 'entries', name: item, price: 12000, entries: 10 })
    .select('id')
    .single();
  if (productError) throw productError;
  const adminId = await userId(await ensureUser('admin'));
  const { data: order, error } = await db
    .from('orders')
    .insert({ user_id: personId, product_id: product.id, item_name: item, amount: 0, payment_method: 'gift', created_by: adminId })
    .select('id, order_number')
    .single();
  if (error) throw error;
  expect((await db.from('order_grants').insert({ order_id: order.id, reason: REASON })).error).toBeNull();
  expect((await db.rpc('fulfil_order', { p_order_id: order.id })).error).toBeNull();
  const changes = { order_id: order.id, order_number: order.order_number, item_name: item, reason: REASON };
  expect(
    (await db.from('audit_log').insert({ actor_id: adminId, target_user_id: personId, action: 'pass_grant', changes })).error,
  ).toBeNull();
  return { orderId: order.id as string, orderNumber: order.order_number as string, item };
}

test('AC-12, AC-13: klient widzi karnet i „Prezent — 0,00 zł” bez powodu i bez statusu faktury', async ({ page }) => {
  const person = await seedPerson(page);
  const gift = await seedGift(person.id);

  await page.goto('/konto/');
  const passes = page.getByRole('region', { name: 'Twoje karnety' });
  await expect(passes.getByRole('listitem').filter({ hasText: gift.item })).toContainText('Pozostałe wejścia: 10 z 10');
  const row = page.getByRole('region', { name: 'Historia płatności' }).getByRole('row').filter({ hasText: gift.item });
  await expect(row).toContainText('0,00 zł');
  await expect(row).toContainText('Prezent');
  await expect(row).toContainText('Opłacone');
  await expect(row).not.toContainText('Faktura');
  await expect(page.getByText(REASON)).toHaveCount(0);
});

test.describe('admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-14, AC-17…AC-19, AC-21: prezent w zamówieniach — powód, CSV, brak zwrotu i faktury, „Anuluj przyznanie”', async ({ page }) => {
    const person = await seedPerson();
    const gift = await seedGift(person.id);

    await page.goto('/panel/zamowienia/');
    await expect(page.getByLabel('Metoda').locator('option')).toHaveText(['Wszystkie', 'Online', 'Na miejscu', 'Prezent']);
    await page.getByLabel('Metoda').selectOption({ label: 'Prezent' });
    await page.getByLabel('Osoba lub nr zamówienia').fill(person.fullName);
    await page.getByRole('button', { name: 'Pokaż' }).click();

    const row = page.getByRole('row').filter({ hasText: gift.orderNumber });
    await expect(row).toContainText('0,00 zł');
    await expect(row).toContainText('Prezent');
    await expect(row).toContainText(`Powód: ${REASON}`);
    // AC-17: bez zwrotu i faktury
    await expect(row.getByRole('button', { name: /Anuluj i zwróć/ })).toHaveCount(0);
    await expect(row.getByRole('button', { name: /Dodaj dane do faktury/ })).toHaveCount(0);

    // AC-14: CSV — metoda „Prezent” i kolumna „Powód przyznania”
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Eksportuj CSV' }).click();
    const csv = await (await (await download).createReadStream()).toArray();
    const text = Buffer.concat(csv).toString('utf8');
    expect(text).toContain('"Powód przyznania"');
    expect(text).toContain(`"Prezent";"Opłacone";"${person.fullName}"`);
    expect(text).toContain(`"${REASON}"`);

    // AC-18: okno potwierdzenia
    await row.getByRole('button', { name: `Anuluj przyznanie: ${gift.item}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Anuluj przyznanie' });
    await expect(dialog).toContainText(
      'Karnet zostanie anulowany. Niewykorzystane wejścia i dni przepadają, historia wejść zostaje. Tej operacji nie można cofnąć.',
    );
    await dialog.getByLabel('Notatka').fill('Pomyłka w osobie');
    // AC-19: anulowanie
    await dialog.getByRole('button', { name: 'Anuluj przyznanie' }).click();
    await expect(page.getByText('Przyznanie anulowane.')).toBeVisible();
    await expect(row).toContainText('Anulowane');
    await expect(row).toContainText('Notatka anulowania: Pomyłka w osobie');
    // AC-21: anulowanego nie da się anulować ponownie
    await expect(row.getByRole('button', { name: /Anuluj przyznanie/ })).toHaveCount(0);

    const { data } = await admin().from('orders').select('status, user_passes(status), order_grants(cancel_note)').eq('id', gift.orderId).single();
    expect(data).toMatchObject({ status: 'cancelled', user_passes: { status: 'cancelled' }, order_grants: { cancel_note: 'Pomyłka w osobie' } });

    // AC-16: profil osoby — „Prezent: <powód>” i wpisy w „Historia zmian”
    await page.goto(`/panel/uzytkownicy/profil/?id=${person.id}`);
    await expect(page.locator('[data-pass-usages]').getByRole('listitem').filter({ hasText: gift.item })).toContainText(
      `Prezent: ${REASON}`,
    );
    await expect(page.getByText(`Przyznano karnet: ${gift.item}`)).toBeVisible();
    await expect(page.getByText(`Anulowano przyznanie: ${gift.item}`)).toBeVisible();
  });
});
