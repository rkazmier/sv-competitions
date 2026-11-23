import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-012 US-3 (AC-11, AC-14): stan e-maila z potwierdzeniem i „Wyślij ponownie” w `/panel/zamowienia/`.
// Kolejkę i ponowienia sprawdza też pgTAP (supabase/tests/035_email_outbox_test.sql), wysyłkę — testy Deno `mail-send`.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

/** Zamówienie Tpay z wersją regulaminu opłacone przez `fulfil_order` → wpis `order_paid` w `email_outbox` (AC-9). */
async function seedPaidOrder(): Promise<{ item: string; orderId: string; orderNumber: string }> {
  const db = admin();
  const item = unique('Karnet e-mail E2E');
  const { data: user, error: userError } = await db.auth.admin.createUser({
    email: `${unique('mail').replace(/\s/g, '-')}@example.test`,
    email_confirm: true,
  });
  expect(userError).toBeNull();
  const { data: product } = await db.from('products').insert({ kind: 'entries', name: item, price: 12000, entries: 5 })
    .select('id').single();
  const { data: order, error } = await db.from('orders').insert({
    user_id: user.user!.id,
    product_id: product!.id,
    item_name: item,
    amount: 12000,
    payment_method: 'tpay',
    tpay_transaction_id: unique('TX').replace(/\s/g, ''),
    terms_version: '2027-01-01',
  }).select('id, order_number').single();
  expect(error).toBeNull();
  expect((await db.rpc('fulfil_order', { p_order_id: order!.id })).error).toBeNull();
  return { item, orderId: order!.id, orderNumber: order!.order_number };
}

async function showOrder(page: Page, orderNumber: string): Promise<void> {
  await page.goto('/panel/zamowienia/');
  await page.getByLabel('Osoba lub nr zamówienia').fill(orderNumber);
  await page.getByRole('button', { name: 'Pokaż' }).click();
}

test.describe('admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-14, AC-11: „w kolejce” → „nie wysłano” + „Wyślij ponownie” → „w kolejce”; „wysłano <data>”', async ({ page }) => {
    const seeded = await seedPaidOrder();
    const db = admin();
    const row = page.getByRole('row').filter({ hasText: seeded.item });

    await showOrder(page, seeded.orderNumber);
    await expect(row).toContainText('E-mail z potwierdzeniem: w kolejce');
    await expect(row.getByRole('button', { name: /Wyślij ponownie/ })).toHaveCount(0);

    // 5 nieudanych prób (AC-11).
    expect((await db.from('email_outbox').update({ status: 'failed', attempts: 5, next_attempt_at: null, last_error: 'smtp_error' })
      .eq('order_id', seeded.orderId)).error).toBeNull();
    await showOrder(page, seeded.orderNumber);
    await expect(row).toContainText('E-mail z potwierdzeniem: nie wysłano');
    await row.getByRole('button', { name: `Wyślij ponownie e-mail z potwierdzeniem zamówienia ${seeded.orderNumber}` }).click();
    await expect(page.getByText('E-mail jest w kolejce do wysłania.')).toBeVisible();
    await expect(row).toContainText('E-mail z potwierdzeniem: w kolejce');

    const { data: entry } = await db.from('email_outbox').select('status, attempts').eq('order_id', seeded.orderId).single();
    expect(entry).toEqual({ status: 'pending', attempts: 0 });
    const { data: audit } = await db.from('audit_log').select('action').eq('action', 'email_resend')
      .eq('changes->>order_id', seeded.orderId);
    expect(audit).toHaveLength(1);

    expect((await db.from('email_outbox').update({ status: 'sent', sent_at: '2027-01-02T13:06:00Z', next_attempt_at: null })
      .eq('order_id', seeded.orderId)).error).toBeNull();
    await showOrder(page, seeded.orderNumber);
    await expect(row).toContainText('E-mail z potwierdzeniem: wysłano 2.01.2027 14:06');
  });
});
