import { expect, test } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-003 US-4: wejściówki na wydarzenia (AC-16…AC-20). Kalendarz jest statyczny (wydarzenia z bazy
// po buildzie się w nim nie pojawią) — kartę sprawdzają testy Vitest, tu: formularz, podsumowanie `?event=` i blokady.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function seedEvent(fields: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const db = admin();
  const { data: category, error: categoryError } = await db
    .from('event_categories')
    .insert({ name: unique('Kategoria T') })
    .select('id')
    .single();
  expect(categoryError).toBeNull();
  const { data, error } = await db
    .from('calendar_events')
    .insert({ name: unique('Szkolenie T'), category_id: category!.id, starts_on: day(30), ...fields })
    .select('id, name')
    .single();
  expect(error).toBeNull();
  return data!;
}

const paidEvent = (fields: Record<string, unknown> = {}) =>
  seedEvent({ status: 'published', access_mode: 'paid', ticket_price: 5000, ...fields });

async function soldTicket(event: { id: string; name: string }): Promise<void> {
  const { error } = await admin().from('orders').insert({
    calendar_event_id: event.id,
    item_name: `Wejściówka: ${event.name}`,
    amount: 5000,
    payment_method: 'tpay',
    status: 'paid',
    paid_at: new Date().toISOString(),
  });
  expect(error).toBeNull();
}

const readEvent = async (id: string) =>
  (await admin().from('calendar_events').select('status, access_mode, ticket_price, capacity').eq('id', id).maybeSingle()).data;

test.describe('admin — formularz wydarzenia', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/functions/v1/site-rebuild', (route) =>
      route.fulfill({ status: 202, json: { ok: true }, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }),
    );
    await signIn(page, 'admin');
  });

  test('AC-16: bezpłatne publikuje się bez linku; płatne wymaga ceny, limit opcjonalny', async ({ page }) => {
    const free = await seedEvent();
    await page.goto(`/panel/wydarzenia/edytuj/?id=${free.id}`);
    await expect(page.getByLabel('Cena wejściówki (zł) *')).toBeHidden();
    await page.getByLabel('Otwarte, bezpłatne').check();
    await page.getByRole('button', { name: 'Opublikuj' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Opublikowane');
    expect(await readEvent(free.id)).toMatchObject({ status: 'published', access_mode: 'free', ticket_price: null });

    const paid = await seedEvent();
    await page.goto(`/panel/wydarzenia/edytuj/?id=${paid.id}`);
    await page.getByLabel('Płatne przez Ofertę').check();
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.locator('[data-error-for="ticket_price"]')).toHaveText('Podaj cenę wejściówki.');
    await page.getByLabel('Cena wejściówki (zł) *').fill('50');
    await page.getByLabel('Limit miejsc (opcjonalnie)').fill('1001');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.locator('[data-error-for="capacity"]')).toHaveText('Limit miejsc to liczba od 1 do 1000.');
    await page.getByLabel('Limit miejsc (opcjonalnie)').fill('12');
    await expect(page.locator('[data-preview] [data-card-price]')).toHaveText('Wejściówka: 50,00 zł');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();
    expect(await readEvent(paid.id)).toMatchObject({ access_mode: 'paid', ticket_price: 5000, capacity: 12 });
  });

  test('AC-20: sprzedane wejściówki blokują zmianę ceny i usunięcie; limit można zmienić', async ({ page }) => {
    const event = await paidEvent({ capacity: 10 });
    await soldTicket(event);
    await page.goto(`/panel/wydarzenia/edytuj/?id=${event.id}`);
    const blocked = 'Wydarzenie ma sprzedane wejściówki — zmiana niedostępna.';

    await page.getByLabel('Cena wejściówki (zł) *').fill('60');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: blocked })).toBeVisible();
    expect((await readEvent(event.id))!.ticket_price).toBe(5000);

    await page.getByLabel('Cena wejściówki (zł) *').fill('50,00');
    await page.getByLabel('Limit miejsc (opcjonalnie)').fill('20');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();
    expect((await readEvent(event.id))!.capacity).toBe(20);

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Usuń wydarzenie' }).click();
    await expect(page.getByRole('status').filter({ hasText: blocked })).toBeVisible();
    expect(await readEvent(event.id)).not.toBeNull();
  });
});

test('AC-17: gość kupujący wejściówkę trafia do logowania z powrotem do podsumowania', async ({ page }) => {
  const event = await paidEvent();
  await page.goto(`/oferta/zamowienie/?event=${event.id}`);
  await expect(page).toHaveURL(/\/logowanie\/\?next=/);
  expect(new URL(page.url()).searchParams.get('next')).toBe(`/oferta/zamowienie/?event=${event.id}`);
});

test.describe('zalogowany — podsumowanie wejściówki', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'user');
  });

  test('AC-17, SPEC-012 AC-6: „Wejściówka: <nazwa>”, bez zgody 14 dni, „Zamawiam i płacę 50,00 zł” → payments-create z event_id', async ({ page }) => {
    const event = await paidEvent({ capacity: 5 });
    let body: Record<string, unknown> = {};
    await page.route('**/functions/v1/payments-create', async (route) => {
      body = route.request().postDataJSON();
      await route.fulfill({ status: 409, json: { error: 'sold_out' } });
    });
    await page.goto(`/oferta/zamowienie/?event=${event.id}`);
    await expect(page.getByText(`Wejściówka: ${event.name}`, { exact: true })).toBeVisible();
    // SPEC-012 AC-6: wejściówka — bez checkboxa zgody, z informacją o braku odstąpienia.
    await expect(page.getByLabel(/Chcę korzystać z karnetu/)).toBeHidden();
    await expect(page.getByText('Wejściówki na wydarzenia nie podlegają odstąpieniu od umowy.')).toBeVisible();
    await page.getByLabel(/Akceptuję regulamin sprzedaży/).check();
    await page.getByRole('button', { name: 'Zamawiam i płacę 50,00 zł' }).click();
    // AC-18: payments-create odrzuca, gdy limit osiągnięto w międzyczasie
    await expect(page.getByText('Wejściówki zostały wyprzedane.')).toBeVisible();
    expect(body).toMatchObject({ event_id: event.id, consent: false });
    expect(body).not.toHaveProperty('product_id');
  });

  test('AC-18: limit osiągnięty → „Wejściówki zostały wyprzedane.”', async ({ page }) => {
    const event = await paidEvent({ capacity: 1 });
    await soldTicket(event);
    await page.goto(`/oferta/zamowienie/?event=${event.id}`);
    await expect(page.getByText('Wejściówki zostały wyprzedane.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Zamawiam i płacę/ })).toBeHidden();
  });

  test('AC-19: po ostatnim dniu wydarzenia → „Sprzedaż zakończona.”', async ({ page }) => {
    const event = await paidEvent({ starts_on: day(-5), ends_on: day(-2) });
    await page.goto(`/oferta/zamowienie/?event=${event.id}`);
    await expect(page.getByText('Sprzedaż zakończona.')).toBeVisible();
  });
});
