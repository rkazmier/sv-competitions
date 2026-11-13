import { expect, test, type Page } from '@playwright/test';
import { formatDateRange, formatMonthHeading } from '../../web/src/lib/dates';
import { todayInWarsaw } from '../../web/src/lib/calendar';
import { admin, hasLocalSupabase, signIn } from './support/supabase';

// SPEC-001 US-8, US-9, AC-24: strony publiczne zbudowane z danych supabase/seed.sql (fikcyjne nazwy). Wymaga lokalnego Supabase.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const SEED = {
  competitionA: '5eed0000-0000-4000-8000-0000000000c1',
  competitionB: '5eed0000-0000-4000-8000-0000000000c2',
  competitionPast: '5eed0000-0000-4000-8000-0000000000c3',
  competitionDraft: '5eed0000-0000-4000-8000-0000000000c4',
  eventA: '5eed0000-0000-4000-8000-0000000000e1',
  eventOngoing: '5eed0000-0000-4000-8000-0000000000e2',
};
const PRODUCTION = 'https://competitions.steel-valley.pl';

async function competition(id: string) {
  const { data, error } = await admin().from('competitions').select('slug, name, starts_on, ends_on').eq('id', id).single();
  expect(error).toBeNull();
  return data!;
}

async function calendarEvent(id: string) {
  const { data, error } = await admin().from('calendar_events').select('name, starts_on, ends_on').eq('id', id).single();
  expect(error).toBeNull();
  return data!;
}

const card = (page: Page, name: string) => page.locator('article.entry-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

test.describe('kalendarz /', () => {
  test('AC-35: nadchodzące wpisy po miesiącach; trwające w bieżącym miesiącu; zawody przed wydarzeniami tego dnia', async ({ page }) => {
    const a = await competition(SEED.competitionA);
    const ongoing = await calendarEvent(SEED.eventOngoing);
    await page.goto('/');

    const currentMonth = page.locator('section.calendar-month').first();
    await expect(currentMonth.getByRole('heading', { level: 2 })).toHaveText(formatMonthHeading(todayInWarsaw()));
    await expect(currentMonth.locator('article').first()).toContainText(ongoing.name);

    const monthOfA = page.locator(`section[data-month="${a.starts_on.slice(0, 7)}"]`);
    await expect(monthOfA.getByRole('heading', { level: 2 })).toHaveText(formatMonthHeading(a.starts_on));
    const names = await monthOfA.locator('.entry-name').allTextContents();
    expect(names.indexOf('Zawody przykładowe A')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('Zawody przykładowe A')).toBeLessThan(names.indexOf('Wydarzenie przykładowe A'));

    await expect(page.getByText('Zawody przykładowe minione')).toHaveCount(0);
    await expect(page.getByText('Wydarzenie przykładowe minione')).toHaveCount(0);
  });

  test('AC-37: szkice niewidoczne w kalendarzu, strona szkicu zawodów nie istnieje', async ({ page }) => {
    const draft = await competition(SEED.competitionDraft);
    await page.goto('/');
    await expect(page.getByText('Zawody przykładowe szkic')).toHaveCount(0);
    await expect(page.getByText('Wydarzenie przykładowe szkic')).toHaveCount(0);
    const response = await page.goto(`/zawody/${draft.slug}/`);
    expect(response?.status()).toBe(404);
  });

  test('AC-42, AC-44: karta zawodów — etykieta, termin, nazwa, dyscyplina, link, wyróżnienie', async ({ page }) => {
    const a = await competition(SEED.competitionA);
    await page.goto('/');
    const item = card(page, a.name);
    await expect(item.locator('.entry-kind')).toHaveText('Zawody Steel Valley');
    await expect(item).toContainText(formatDateRange(a.starts_on, a.ends_on));
    await expect(item).toContainText('Dyscyplina przykładowa');
    await expect(item.getByRole('link', { name: /Szczegóły zawodów/ })).toHaveAttribute('href', `/zawody/${a.slug}/`);
    const border = await item.evaluate((el) => getComputedStyle(el).borderLeftColor);
    expect(border).toBe('rgb(165, 122, 44)'); // --color-highlight
  });

  test('AC-43, AC-44: karta wydarzenia — kategoria, opis w akapitach, link zewnętrzny w nowej karcie', async ({ page }) => {
    const event = await calendarEvent(SEED.eventA);
    await page.goto('/');
    const item = card(page, event.name);
    await expect(item.locator('.entry-kind')).toHaveText('Kategoria przykładowa');
    await expect(item).toContainText(formatDateRange(event.starts_on, event.ends_on));
    await expect(item.locator('.entry-description')).toHaveText(['Opis wydarzenia przykładowego.', 'Drugi akapit opisu.']);
    const link = item.getByRole('link', { name: /Szczegóły u organizatora.*\(otwiera się w nowej karcie\)/ });
    await expect(link).toHaveAttribute('href', 'https://example.com/wydarzenie');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('AC-41: meta i Open Graph kalendarza', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Steel Valley Competitions');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Kalendarz zawodów i wydarzeń na strzelnicy Steel Valley.');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${PRODUCTION}/`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${PRODUCTION}/`);
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', `${PRODUCTION}/og-default.png`);
    const image = await page.request.get('/og-default.png');
    expect(image.headers()['content-type']).toBe('image/png');
  });
});

test.describe('strona zawodów', () => {
  test('AC-38: nazwa, termin, dyscyplina, opis, harmonogram po dniach, regulamin i matchbook', async ({ page }) => {
    const a = await competition(SEED.competitionA);
    await page.goto(`/zawody/${a.slug}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(a.name);
    await expect(page.getByRole('main')).toContainText(formatDateRange(a.starts_on, a.ends_on));
    await expect(page.getByRole('main')).toContainText('Dyscyplina przykładowa');
    await expect(page.locator('.competition-description p')).toHaveCount(2);
    await expect(page.getByText('Drugi akapit z <b>HTML</b>, który ma się wyświetlić jako tekst.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Regulamin (PDF)' })).toHaveAttribute('href', /\/storage\/v1\/object\/public\/documents\/rulebooks\/.+\.pdf$/);
    await expect(page.getByRole('link', { name: 'Matchbook (PDF)' })).toHaveAttribute('href', /\/documents\/matchbooks\/.+\.pdf$/);

    const days = page.locator('table.schedule-day');
    await expect(days).toHaveCount(2);
    await expect(days.first().locator('tbody tr')).toHaveText([/^\s*Rejestracja zawodników/, /09:00\s*Odprawa/]);
  });

  test('AC-39: bez matchbooka i harmonogramu — „Matchbook wkrótce”, „Harmonogram wkrótce”', async ({ page }) => {
    const b = await competition(SEED.competitionB);
    await page.goto(`/zawody/${b.slug}/`);
    await expect(page.getByText('Matchbook wkrótce')).toBeVisible();
    await expect(page.getByText('Harmonogram wkrótce')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Matchbook (PDF)' })).toHaveCount(0);
  });

  test('AC-40: minione opublikowane zawody mają działającą stronę', async ({ page }) => {
    const past = await competition(SEED.competitionPast);
    const response = await page.goto(`/zawody/${past.slug}/`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(past.name);
  });

  test('AC-41: title, description (początek opisu ≤ 160 znaków), Open Graph, canonical na produkcję', async ({ page }) => {
    const a = await competition(SEED.competitionA);
    await page.goto(`/zawody/${a.slug}/`);
    await expect(page).toHaveTitle(`${a.name} — Steel Valley Competitions`);
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description!.startsWith('Pierwszy akapit opisu zawodów przykładowych.')).toBe(true);
    expect([...description!].length).toBeLessThanOrEqual(160);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', a.name);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description!);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${PRODUCTION}/zawody/${a.slug}/`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${PRODUCTION}/zawody/${a.slug}/`);
  });
});

test.describe('podgląd w panelu', () => {
  test('AC-24: „Podgląd” szkicu pokazuje stronę zawodów z paskiem podglądu', async ({ page }) => {
    await signIn(page, 'organizer');
    const draft = await competition(SEED.competitionDraft);
    await page.goto(`/panel/zawody/edytuj/?id=${SEED.competitionDraft}`);
    await page.getByRole('link', { name: 'Podgląd' }).click();

    await expect(page).toHaveURL(`/panel/zawody/podglad/?id=${SEED.competitionDraft}`);
    await expect(page.getByText('Podgląd — zawody nie są opublikowane')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(draft.name);
    await expect(page.getByRole('main')).toContainText(formatDateRange(draft.starts_on, draft.ends_on));
    await expect(page.getByText('Matchbook wkrótce')).toBeVisible();
    await expect(page.getByText('Harmonogram wkrótce')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  });

  test('AC-24: podgląd opublikowanych zawodów — bez paska, z harmonogramem', async ({ page }) => {
    await signIn(page, 'organizer');
    await page.goto(`/panel/zawody/podglad/?id=${SEED.competitionA}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Zawody przykładowe A');
    await expect(page.locator('table.schedule-day')).toHaveCount(2);
    await expect(page.getByText('Podgląd — zawody nie są opublikowane')).toBeHidden();
  });
});
