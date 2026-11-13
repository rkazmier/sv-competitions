import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-001 US-2, US-3, US-10: logowanie, uprawnienia, lista wpisów, dyscypliny i kategorie.
// Wymaga lokalnego Supabase (zmienne — tests/e2e/support/supabase.ts); w CI zawsze uruchamiane.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PANEL_PAGES = ['/panel/', '/panel/dyscypliny/', '/panel/kategorie/'];

test.describe('niezalogowany', () => {
  test('AC-4: przycisk „Zaloguj się przez Google”, powrót do /panel/ po zalogowaniu', async ({ page }) => {
    let authorizeUrl: URL | undefined;
    await page.route('**/auth/v1/authorize**', (route) => {
      authorizeUrl = new URL(route.request().url());
      return route.fulfill({ status: 200, body: 'ok' });
    });
    await page.goto('/panel/dyscypliny/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Panel organizatora');
    await expect(page.getByRole('navigation', { name: 'Menu panelu' })).toBeHidden();
    await page.getByRole('button', { name: 'Zaloguj się przez Google' }).click();

    await expect.poll(() => authorizeUrl?.searchParams.get('provider')).toBe('google');
    expect(new URL(authorizeUrl!.searchParams.get('redirect_to')!).pathname).toBe('/panel/');
  });

  for (const path of PANEL_PAGES) {
    test(`AC-4: ${path} ma noindex`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    });
  }
});

test.describe('zalogowany bez roli organizatora', () => {
  test('AC-5: komunikat o braku uprawnień, „Wyloguj się”, bez pobierania danych', async ({ page }) => {
    await signIn(page, 'competitor');
    const dataRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/rest\/v1\/(competitions|calendar_events|disciplines|event_categories)/.test(request.url())) {
        dataRequests.push(request.url());
      }
    });
    await page.goto('/panel/');
    await expect(
      page.getByText('Nie masz uprawnień organizatora. Skontaktuj się z administratorem strzelnicy.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Nowe zawody' })).toBeHidden();
    expect(dataRequests).toEqual([]);

    await page.getByRole('main').getByRole('button', { name: 'Wyloguj się' }).click();
    await expect(page.getByRole('button', { name: 'Zaloguj się przez Google' })).toBeVisible();
  });
});

test.describe('organizator', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'organizer');
  });

  test('AC-6: lista wpisów kalendarza (zawody i wydarzenia, szkice i opublikowane), przyciski i menu', async ({
    page,
  }) => {
    const db = admin();
    const discipline = unique('Dyscyplina E2E');
    const category = unique('Kategoria E2E');
    const { data: d } = await db.from('disciplines').insert({ name: discipline }).select('id').single();
    const { data: c } = await db.from('event_categories').insert({ name: category }).select('id').single();
    const competition = unique('Zawody E2E');
    const event = unique('Wydarzenie E2E');
    const inserts = await Promise.all([
      db.from('competitions').insert({ name: competition, discipline_id: d!.id, starts_on: '2031-06-14', ends_on: '2031-06-15' }),
      db.from('calendar_events').insert({
        name: event,
        category_id: c!.id,
        starts_on: '2031-06-14',
        external_url: 'https://example.com/wydarzenie',
        status: 'published',
      }),
    ]);
    expect(inserts.map((r) => r.error)).toEqual([null, null]);

    await page.goto('/panel/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Kalendarz');
    await expect(main.getByRole('link', { name: 'Nowe zawody' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Nowe wydarzenie' })).toBeVisible();

    const competitionItem = main.getByRole('listitem').filter({ hasText: competition });
    await expect(competitionItem).toContainText('Zawody');
    await expect(competitionItem).toContainText('Szkic');
    await expect(competitionItem).toContainText('14–15 czerwca 2031');
    await expect(competitionItem).toContainText(discipline);

    const eventItem = main.getByRole('listitem').filter({ hasText: event });
    await expect(eventItem).toContainText('Wydarzenie');
    await expect(eventItem).toContainText('Opublikowane');
    await expect(eventItem).toContainText('14 czerwca 2031');
    await expect(eventItem).toContainText(category);

    // Ten sam dzień: zawody przed wydarzeniem
    const names = await main.getByRole('listitem').allTextContents();
    expect(names.findIndex((text) => text.includes(competition))).toBeLessThan(
      names.findIndex((text) => text.includes(event)),
    );

    const menu = page.getByRole('navigation', { name: 'Menu panelu' });
    for (const [name, href] of [
      ['Kalendarz', '/panel/'],
      ['Regulaminy', '/panel/regulaminy/'],
      ['Dyscypliny', '/panel/dyscypliny/'],
      ['Kategorie', '/panel/kategorie/'],
    ]) {
      await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
    }
    await menu.getByRole('button', { name: 'Wyloguj się' }).click();
    await expect(page.getByRole('button', { name: 'Zaloguj się przez Google' })).toBeVisible();
  });

  const dictionaries = [
    { path: '/panel/dyscypliny/', table: 'disciplines', existing: 'Long Range', typed: 'long range ', duplicate: 'Taka dyscyplina już istnieje.', ac: ['AC-8', 'AC-9', 'AC-10', 'AC-11'] },
    { path: '/panel/kategorie/', table: 'event_categories', existing: 'Szkolenie', typed: 'szkolenie ', duplicate: 'Taka kategoria już istnieje.', ac: ['AC-45', 'AC-46', 'AC-47', 'AC-47'] },
  ] as const;

  for (const dict of dictionaries) {
    const [acAdd, acDuplicate, acRename, acHide] = dict.ac;

    const itemFor = (page: Page, name: string) =>
      page.getByRole('main').getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });

    test(`${acAdd}: ${dict.path} — dodanie nowej nazwy pojawia się jako aktywna`, async ({ page }) => {
      const name = unique('Nowa');
      await page.goto(dict.path);
      await page.getByLabel('Nazwa', { exact: true }).fill(`  ${name}  `);
      await page.getByRole('button', { name: 'Dodaj' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();
      await expect(itemFor(page, name)).toContainText('Aktywna');
    });

    test(`${acDuplicate}: ${dict.path} — duplikat „${dict.typed}” jest odrzucany`, async ({ page }) => {
      const db = admin();
      await db.from(dict.table).insert({ name: dict.existing }); // może już istnieć (23505) — to w porządku
      const before = await db.from(dict.table).select('id', { count: 'exact', head: true });

      await page.goto(dict.path);
      await expect(itemFor(page, dict.existing)).toBeVisible();
      await page.getByLabel('Nazwa', { exact: true }).fill(dict.typed);
      await page.getByRole('button', { name: 'Dodaj' }).click();
      await expect(page.getByText(dict.duplicate)).toBeVisible();
      await expect(page.getByLabel('Nazwa', { exact: true })).toHaveAttribute('aria-invalid', 'true');

      const after = await db.from(dict.table).select('id', { count: 'exact', head: true });
      expect(after.count).toBe(before.count);
    });

    test(`${acRename}: ${dict.path} — zmiana nazwy`, async ({ page }) => {
      const name = unique('Stara');
      const renamed = unique('Nowa nazwa');
      await admin().from(dict.table).insert({ name });
      await page.goto(dict.path);
      const item = itemFor(page, name);
      await item.getByRole('button', { name: 'Zmień nazwę' }).click();
      await item.getByLabel('Nowa nazwa').fill(renamed);
      await item.getByRole('button', { name: 'Zapisz' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();
      await expect(itemFor(page, renamed)).toBeVisible();
      await expect(itemFor(page, name)).toHaveCount(0);

      const { data } = await admin().from(dict.table).select('name').eq('name', renamed);
      expect(data).toHaveLength(1);
    });

    test(`${acHide}: ${dict.path} — „Ukryj” / „Przywróć”, bez usuwania`, async ({ page }) => {
      const name = unique('Do ukrycia');
      await admin().from(dict.table).insert({ name });
      await page.goto(dict.path);
      const item = itemFor(page, name);
      await expect(item.getByRole('button', { name: /usuń/i })).toHaveCount(0);

      await item.getByRole('button', { name: 'Ukryj' }).click();
      await expect(item).toContainText('Ukryta');
      const { data: hidden } = await admin().from(dict.table).select('is_active').eq('name', name).single();
      expect(hidden?.is_active).toBe(false);

      await item.getByRole('button', { name: 'Przywróć' }).click();
      await expect(item).toContainText('Aktywna');
    });
  }

  test('AC-8: lista słownikowa na telefonie (320 px) bez poziomego przewijania', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/panel/dyscypliny/');
    await expect(page.getByRole('button', { name: 'Dodaj' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
