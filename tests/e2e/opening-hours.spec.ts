import { expect, test } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-012 US-7 (AC-35…AC-39): godziny otwarcia w panelu, `/oferta/#godziny` i link w stopce.
// RLS, walidacja w bazie, nocne czyszczenie i `range_blocked_between` sprawdza pgTAP: supabase/tests/040_opening_hours_test.sql.
// Lista dni blokady jest podmieniona (page.route) — prawdziwe wydarzenie z blokadą zmieniłoby wyniki testów książki w kolejnych dniach.
// Godziny są wspólne dla całej bazy — jeden test od początku do końca.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const DAY = 86_400_000;
const warsawDay = (offset: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date(Date.now() + offset * DAY));

test('AC-35…AC-39: panel godzin, wyjątek, sekcja w Ofercie i link w stopce', async ({ page }) => {
  const db = admin();
  expect((await db.from('opening_hours').delete().gte('weekday', 1)).error).toBeNull();
  const exceptionDay = warsawDay(2);
  await db.from('opening_hours_exceptions').delete().eq('day', exceptionDay);
  await page.route('**/rest/v1/rpc/range_blocked_between', (route) =>
    route.fulfill({ json: [{ kind: 'event', id: 'e1', name: 'Piknik E2E', starts_on: warsawDay(5), ends_on: warsawDay(5) }] }),
  );

  // AC-38: link w stopce; brak ustawionych godzin → „Godziny otwarcia wkrótce.”
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Godziny otwarcia' }).click();
  await expect(page).toHaveURL(/\/oferta\/#godziny$/);
  const section = page.locator('#godziny');
  await expect(section.getByText('Godziny otwarcia wkrótce.')).toBeVisible();

  // AC-37: dni blokady na 30 dni; nazwa wydarzenia jest linkiem do kalendarza.
  await expect(section.getByText('Dni wydarzeń i zawodów — karnety i wejścia jednorazowe nie obowiązują:')).toBeVisible();
  await expect(section.getByRole('link', { name: 'Piknik E2E', exact: true }))
    .toHaveAttribute('href', `/#miesiac-${warsawDay(5).slice(0, 7)}`);

  // AC-35, AC-39: tydzień w panelu; „Do” nie wcześniej niż „Od”.
  await signIn(page, 'admin');
  await page.goto('/panel/');
  await page.getByRole('navigation').getByRole('link', { name: 'Godziny otwarcia' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Godziny otwarcia' })).toBeVisible();
  for (const day of ['Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Niedziela']) {
    await page.getByLabel(day, { exact: true }).selectOption('Zamknięte');
  }
  await page.getByLabel('Sobota', { exact: true }).selectOption('Otwarte');
  await page.getByLabel('Sobota — Od').fill('16:00');
  await page.getByLabel('Sobota — Do').fill('09:00');
  await page.getByRole('button', { name: 'Zapisz godziny' }).click();
  await expect(page.getByRole('alert')).toHaveText('Sobota: Godzina zamknięcia musi być późniejsza niż otwarcia.');
  await page.getByLabel('Sobota — Od').fill('09:00');
  await page.getByLabel('Sobota — Do').fill('16:00');
  await page.getByRole('button', { name: 'Zapisz godziny' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();

  // AC-36: wyjątek z opisem zastępuje godziny dnia.
  const note = unique('Wigilia');
  await page.getByLabel('Data *').fill(exceptionDay);
  await page.getByLabel('Stan').selectOption('Zamknięte');
  await page.getByLabel('Opis (publiczny)').fill(note);
  await page.getByRole('button', { name: 'Zapisz wyjątek' }).click();
  await expect(page.getByRole('cell', { name: note })).toBeVisible();

  // AC-35, AC-37: zapis działa od razu na stronie.
  await page.goto('/oferta/#godziny');
  await expect(section.locator('dt', { hasText: 'Sobota' }).locator('+ dd')).toHaveText('09:00–16:00');
  await expect(section.locator('dt', { hasText: 'Poniedziałek' }).locator('+ dd')).toHaveText('Zamknięte');
  await expect(section.getByText(`(${note}): Zamknięte`)).toBeVisible();
  await expect(section.getByText('Godziny otwarcia wkrótce.')).toBeHidden();

  // Sprzątanie: usunięcie wyjątku w panelu.
  await page.goto('/panel/godziny/');
  await page.getByRole('row', { name: note }).getByRole('button', { name: /^Usuń wyjątek/ }).click();
  await expect(page.getByRole('cell', { name: note })).toBeHidden();
});
