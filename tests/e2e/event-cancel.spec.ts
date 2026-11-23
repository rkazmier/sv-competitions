import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-012 US-5 (AC-23, AC-24, AC-26, AC-29, AC-51): odwołanie wydarzenia w panelu.
// Stany zamówień, e-maile, `audit_log`, blokady sprzedaży i edycji sprawdza pgTAP: supabase/tests/038_event_cancel_test.sql;
// zwroty Tpay — testy Deno `event-cancel`. Lokalnie (i w CI) Edge Functions nie działają, więc `event-cancel` jest
// podmienione: przekazuje żądanie do `rpc/cancel_calendar_event` z JWT admina (jak krok 2 funkcji), bez Tpay.
// Karta „Odwołane” w kalendarzu (AC-25) — test strony: web/src/components/calendar-page.test.ts.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const inDays = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(Date.now() + days * 86_400_000));

async function seedEvent(): Promise<{ id: string; name: string; tpayOrder: string; onSiteOrder: string }> {
  const db = admin();
  const { data: category } = await db.from('event_categories').insert({ name: unique('Kategoria O') }).select('id').single();
  const name = unique('Piknik O');
  const { data: event, error } = await db
    .from('calendar_events')
    .insert({
      name, category_id: category!.id, starts_on: inDays(10), status: 'published', access_mode: 'paid', ticket_price: 5000,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  const { data: user } = await db.auth.admin.createUser({
    email: `${unique('odwolanie').replace(/\s/g, '-')}@example.test`,
    email_confirm: true,
  });
  await db.from('profiles').update({ full_name: unique('Anna Odwołana') }).eq('id', user.user!.id);
  const { data: orders, error: ordersError } = await db
    .from('orders')
    .insert([
      { user_id: user.user!.id, calendar_event_id: event!.id, item_name: `Wejściówka: ${name}`, amount: 5000, payment_method: 'tpay',
        tpay_transaction_id: unique('01TPAYO').replace(/\s/g, '') },
      { user_id: null, calendar_event_id: event!.id, item_name: `Wejściówka: ${name}`, amount: 5000, payment_method: 'on_site',
        on_site_method: 'cash' },
    ])
    .select('id, payment_method');
  expect(ordersError).toBeNull();
  for (const order of orders!) expect((await db.rpc('fulfil_order', { p_order_id: order.id })).error).toBeNull();
  const byMethod = (method: string) => orders!.find((o) => o.payment_method === method)!.id as string;
  return { id: event!.id as string, name, tpayOrder: byMethod('tpay'), onSiteOrder: byMethod('on_site') };
}

/** `event-cancel` bez Edge Runtime: odwołanie przez RPC z JWT admina (z przechwyconego żądania), bez zwrotów Tpay. */
async function routeEventCancel(page: Page): Promise<void> {
  await page.route('**/functions/v1/event-cancel', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { event_id: string; reason: string };
    const headers = await request.allHeaders();
    const response = await fetch(`${process.env.PUBLIC_SUPABASE_URL}/rest/v1/rpc/cancel_calendar_event`, {
      method: 'POST',
      headers: { apikey: headers.apikey, Authorization: headers.authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_event_id: body.event_id, p_reason: body.reason }),
    });
    const summary = await response.json();
    await route.fulfill({
      status: response.ok ? 200 : 409,
      json: response.ok ? { status: 'cancelled', summary, refunds: { requested: 0, failed: 0 } } : { error: summary.message },
    });
  });
}

test.describe('admin — odwołanie wydarzenia', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-23, AC-24, AC-26, AC-29: okno z liczbami, odwołanie, lista zwrotów, edycja tylko opisu i powodu', async ({ page }) => {
    const event = await seedEvent();
    await routeEventCancel(page);
    await page.goto(`/panel/wydarzenia/edytuj/?id=${event.id}`);

    await page.getByRole('button', { name: 'Odwołaj wydarzenie' }).click();
    const dialog = page.getByRole('dialog', { name: 'Odwołanie wydarzenia' });
    await expect(dialog).toContainText('online — automatycznie przez Tpay (1), na miejscu — lista do zwrotu (1)');
    await expect(dialog).toContainText('Tej operacji nie można cofnąć.');
    await expect(dialog.getByText('Nie wpisuj danych osobowych.')).toBeVisible();

    // AC-23: powód wymagany (3–200 znaków) — okno zostaje otwarte.
    await dialog.getByLabel('Powód odwołania (widoczny publicznie) *').fill('ab');
    await dialog.getByRole('button', { name: 'Odwołaj wydarzenie' }).click();
    await expect(dialog.getByText('Powód odwołania musi mieć od 3 do 200 znaków.')).toBeVisible();
    await dialog.getByLabel('Powód odwołania (widoczny publicznie) *').fill('Awaria kulochwytu');
    await dialog.getByRole('button', { name: 'Odwołaj wydarzenie' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Wydarzenie odwołane.' })).toBeVisible();

    // AC-24: stan w bazie.
    const { data: saved } = await admin().from('calendar_events').select('cancelled_at, cancel_reason').eq('id', event.id).single();
    expect(saved!.cancelled_at).not.toBeNull();
    expect(saved!.cancel_reason).toBe('Awaria kulochwytu');

    // AC-26: lista zwrotów.
    const refunds = page.getByRole('region', { name: 'Zwroty po odwołaniu' });
    await expect(refunds.getByRole('row').filter({ hasText: 'Online (Tpay)' })).toContainText('Zwrot w toku');
    await expect(refunds.getByRole('row').filter({ hasText: 'Osoba bez konta' })).toContainText('Do zwrotu na miejscu');

    // AC-29: tylko opis i powód; bez „Odwołaj wydarzenie”, publikacji i usuwania.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Odwołane');
    await expect(page.getByText('Wydarzenie odwołane. Zmienić można tylko opis i powód odwołania.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Odwołaj wydarzenie' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Usuń wydarzenie' })).toHaveCount(0);
    await expect(page.locator('#e-name')).toBeDisabled();
    await page.locator('#e-cancel-reason').fill('Awaria osłon kulochwytu');
    await page.locator('#e-description').fill('Nowy termin podamy wkrótce.');
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano' })).toBeVisible();
    const { data: edited } = await admin().from('calendar_events').select('cancel_reason, description').eq('id', event.id).single();
    expect(edited).toEqual({ cancel_reason: 'Awaria osłon kulochwytu', description: 'Nowy termin podamy wkrótce.' });
  });

  test('AC-51: nieudany zwrot Tpay — „Zwrot Tpay nieudany” i „Ponów zwrot” (payments-refund, pełna kwota)', async ({ page }) => {
    const event = await seedEvent();
    await routeEventCancel(page);
    await page.goto(`/panel/wydarzenia/edytuj/?id=${event.id}`);
    await page.getByRole('button', { name: 'Odwołaj wydarzenie' }).click();
    const dialog = page.getByRole('dialog', { name: 'Odwołanie wydarzenia' });
    await dialog.getByLabel('Powód odwołania (widoczny publicznie) *').fill('Brak prądu');
    await dialog.getByRole('button', { name: 'Odwołaj wydarzenie' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Wydarzenie odwołane.' })).toBeVisible();

    // Tpay odrzucił zwrot (jak `event-cancel` po błędzie Tpay).
    expect((await admin().rpc('revert_order_refund', { p_order_id: event.tpayOrder, p_actor_id: null })).data).toBe(true);
    let body: unknown = null;
    await page.route('**/functions/v1/payments-refund', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ status: 200, json: { status: 'refund_pending' } });
    });
    await page.reload();
    const row = page.getByRole('region', { name: 'Zwroty po odwołaniu' }).getByRole('row').filter({ hasText: 'Online (Tpay)' });
    await expect(row).toContainText('Zwrot Tpay nieudany');
    await row.getByRole('button', { name: 'Ponów zwrot' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zwrot zlecony w Tpay.' })).toBeVisible();
    expect(body).toEqual({ order_id: event.tpayOrder });
    const { data: pass } = await admin().from('user_passes').select('status').eq('order_id', event.tpayOrder).single();
    expect(pass!.status).toBe('cancelled');
  });
});
