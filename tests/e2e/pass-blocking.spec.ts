import { expect, test, type Page } from '@playwright/test';
import { admin, ensureRangeDuty, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-012 US-8 (AC-40, AC-42, AC-43): blokada karnetów w dniach wydarzeń i zawodów.
// Ważność uprawnień, `range_blocked_on` i `range_blocked` sprawdza pgTAP: supabase/tests/037_pass_blocking_test.sql.
// Prawdziwa blokada dziś zmieniłaby wyniki równoległych testów książki — tu lista blokad z `range_blocked_on`
// jest podmieniona (page.route), a dzisiejsze wydarzenie w bazie ma `blocks_passes = false`.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
const todayType = () => {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', weekday: 'short' }).format(new Date());
  return day === 'Sat' || day === 'Sun' ? 'weekend' : 'weekday';
};

async function seedCategory(): Promise<string> {
  const { data, error } = await admin().from('event_categories').insert({ name: unique('Kategoria B') }).select('id').single();
  expect(error).toBeNull();
  return data!.id as string;
}

async function seedProduct(fields: Record<string, unknown>): Promise<string> {
  const name = unique(String(fields.name));
  const db = admin();
  const { data, error } = await db.from('products').insert({ price: 4000, ...fields, name }).select('id').single();
  expect(error).toBeNull();
  expect((await db.from('products').update({ is_active: true }).eq('id', data!.id)).error).toBeNull();
  return name;
}

async function mockBlocks(page: Page, blocks: { kind: string; id: string; name: string }[]): Promise<void> {
  await page.route('**/rest/v1/rpc/range_blocked_on', (route) => route.fulfill({ json: blocks }));
}

test.describe('admin — formularze (AC-40)', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-40: checkbox domyślnie zaznaczony w zawodach i wydarzeniach; odznaczenie zapisuje blocks_passes = false', async ({ page }) => {
    const label = 'Karnety i wejścia jednorazowe nie obowiązują w dniach tego wpisu';
    await page.goto('/panel/zawody/nowe/');
    await expect(page.getByLabel(label)).toBeChecked();
    await page.goto('/panel/wydarzenia/nowe/');
    await expect(page.getByLabel(label)).toBeChecked();
    await expect(page.getByText('Odznacz tylko, gdy wpis nie zajmuje strzelnicy (np. wydarzenie poza strzelnicą).')).toBeVisible();

    const { data: event } = await admin()
      .from('calendar_events')
      .insert({ name: unique('Wyjazd B'), category_id: await seedCategory(), starts_on: '2031-09-10' })
      .select('id')
      .single();
    await page.goto(`/panel/wydarzenia/edytuj/?id=${event!.id}`);
    await expect(page.getByLabel(label)).toBeChecked();
    await page.getByLabel(label).uncheck();
    await page.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano' })).toBeVisible();
    const read = async () =>
      (await admin().from('calendar_events').select('blocks_passes').eq('id', event!.id).single()).data?.blocks_passes;
    expect(await read()).toBe(false);
    await page.reload();
    await expect(page.getByLabel(label)).not.toBeChecked();
  });
});

test.describe('obsługa — dzień blokady', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'staff');
  });

  test('AC-42: książka — komunikat „Dziś: <nazwa> — karnety i wejścia jednorazowe nie obowiązują…”', async ({ page }) => {
    const db = admin();
    const { data: user } = await db.auth.admin.createUser({ email: `${unique('blokada').replace(/\s/g, '-')}@example.test`, email_confirm: true });
    await db.from('profiles').update({ full_name: unique('Jan Blokada'), address: 'ul. Stalowa 1, Katowice' }).eq('id', user.user!.id);
    await mockBlocks(page, [{ kind: 'competition', id: crypto.randomUUID(), name: 'Puchar Blokady' }]);

    const officer = await ensureRangeDuty();
    await page.goto(`/panel/ksiazka/?osoba=${user.user!.id}`);
    await expect(page.getByRole('main').locator('p.shift-officer', { hasText: 'Prowadzący strzelanie:' })).toContainText(officer);
    await expect(
      page.getByText('Dziś: Puchar Blokady — karnety i wejścia jednorazowe nie obowiązują. Wejście na zasadach wydarzenia (wejściówka).'),
    ).toBeVisible();
  });

  test('AC-42, AC-43: sprzedaż — bez konta tylko wejściówka (proponowana), karnet z kontem z ostrzeżeniem', async ({ page }) => {
    const single = await seedProduct({ kind: 'single_entry', name: 'Wejście B', day_type: todayType() });
    const pass = await seedProduct({ kind: 'entries', name: 'Karnet B', entries: 5 });
    const name = unique('Piknik B');
    const { data: event, error } = await admin()
      .from('calendar_events')
      .insert({
        name, category_id: await seedCategory(), starts_on: today(), status: 'published',
        access_mode: 'paid', ticket_price: 3000, blocks_passes: false,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    await mockBlocks(page, [{ kind: 'event', id: event!.id as string, name }]);

    await page.goto('/panel/sprzedaz/');
    const item = page.getByLabel('Produkt lub wejściówka *');
    await page.getByLabel('Osoba bez konta').check();
    await expect(item.locator('option', { hasText: single })).toHaveCount(0);
    await expect(item.locator('option:checked')).toHaveText(`Wejściówka: ${name} — 30,00 zł`);

    await page.getByLabel('Osoba z kontem').check();
    await item.selectOption({ label: `${pass} — 40,00 zł` });
    await expect(page.getByText(`Karnet nie obowiązuje dziś (${name}).`)).toBeVisible();
  });
});
