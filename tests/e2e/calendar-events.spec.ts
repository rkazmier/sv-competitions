import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-001 US-11: wydarzenia w kalendarzu strzelnicy (AC-48…53) i wyzwalacze przebudowy (AC-29).
// Edge Function `site-rebuild` jest zamockowana (page.route) — jej logikę sprawdzają testy Deno.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const NEW_URL = '/panel/wydarzenia/nowe/';
const editUrl = (id: string) => `/panel/wydarzenia/edytuj/?id=${id}`;
const STARTED = 'Strona publiczna odświeży się w ciągu kilku minut.';

async function mockRebuild(page: Page): Promise<{ count: number }> {
  const calls = { count: 0 };
  await page.route('**/functions/v1/site-rebuild', async (route) => {
    if (route.request().method() === 'POST') calls.count += 1;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      body: JSON.stringify({ ok: true }),
    });
  });
  return calls;
}

async function seedCategory(): Promise<{ id: string; name: string }> {
  const { data, error } = await admin().from('event_categories').insert({ name: unique('Kategoria W') }).select('id, name').single();
  expect(error).toBeNull();
  return data!;
}

async function seedEvent(fields: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const category = await seedCategory();
  const { data, error } = await admin()
    .from('calendar_events')
    .insert({ name: unique('Wydarzenie W'), category_id: category.id, starts_on: '2031-08-10', ...fields })
    .select('id, name')
    .single();
  expect(error).toBeNull();
  return data!;
}

const readEvent = async (id: string) =>
  (await admin().from('calendar_events').select('status, published_at, name, ends_on, external_url').eq('id', id).maybeSingle()).data;
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const preview = (page: Page) => page.locator('[data-preview] article.entry-card');

test.describe('organizator', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-48 AC-53: nowy szkic z formularza, podpowiedzi i podgląd karty', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const category = await seedCategory();
    const name = unique('Dzień otwarty');
    await page.goto(NEW_URL);
    await expect(page.getByText('Strona organizatora wydarzenia ze szczegółami, np. wydarzenie na Facebooku.')).toBeVisible();
    await expect(page.getByText('Nie wpisuj danych kontaktowych osób prywatnych; szczegóły podaje strona organizatora.')).toBeVisible();
    await expect(preview(page)).toBeHidden();

    await page.getByLabel('Nazwa *').fill(name);
    await page.getByLabel('Kategoria *').selectOption({ label: category.name });
    await page.getByLabel('Data początku *').fill('2031-06-14');
    await page.getByLabel('Data końca (opcjonalnie)').fill('2031-06-15');
    await page.getByLabel('Opis').fill('Pierwszy akapit.\n\nDrugi <b>akapit</b>.');
    await page.getByLabel('Link do szczegółów').fill('https://example.com/wydarzenie');

    const card = preview(page);
    await expect(card).toBeVisible();
    await expect(card.locator('.entry-kind')).toHaveText(category.name);
    await expect(card.getByRole('heading', { name })).toBeVisible();
    await expect(card).toContainText('14–15 czerwca 2031');
    await expect(card.locator('.entry-description')).toHaveText(['Pierwszy akapit.', 'Drugi <b>akapit</b>.']);
    const link = card.getByRole('link', { name: /Szczegóły u organizatora/ });
    await expect(link).toHaveAttribute('href', 'https://example.com/wydarzenie');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page).toHaveURL(/\/panel\/wydarzenia\/edytuj\/\?id=/);
    await expect(status(page, 'Zapisano.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Szkic');
    const id = new URL(page.url()).searchParams.get('id')!;
    const row = await readEvent(id);
    expect(row).toMatchObject({ status: 'draft', name, ends_on: '2031-06-15', external_url: 'https://example.com/wydarzenie' });
    expect(row!.published_at).toBeNull();
    expect(rebuild.count).toBe(0);

    // Gość nie widzi szkicu (RLS).
    const anon = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!);
    expect((await anon.from('calendar_events').select('id').eq('id', id)).data).toEqual([]);
  });

  test('AC-49: data końca przed początkiem — komunikat, nic nie jest zapisywane', async ({ page }) => {
    const { id, name } = await seedEvent();
    await page.goto(editUrl(id));
    await page.getByLabel('Nazwa *').fill(unique('Zmiana'));
    await page.getByLabel('Data końca (opcjonalnie)').fill('2031-08-01');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByText('Data końca nie może być wcześniejsza niż data początku.')).toBeVisible();
    expect((await readEvent(id))!.name).toBe(name);
  });

  test('AC-50: link bez http(s):// — komunikat, nic nie jest zapisywane', async ({ page }) => {
    const { id } = await seedEvent();
    await page.goto(editUrl(id));
    await page.getByLabel('Link do szczegółów').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.locator('[data-error-for="external_url"]')).toHaveText('Podaj pełny adres strony, np. https://…');
    await expect(page.getByLabel('Link do szczegółów')).toBeFocused();
    expect((await readEvent(id))!.external_url).toBeNull();
  });

  test('AC-51: szkic bez linku — „Opublikuj” pokazuje komunikat, stan bez zmian', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { id } = await seedEvent();
    await page.goto(editUrl(id));
    await page.getByRole('button', { name: 'Opublikuj' }).click();
    await expect(page.locator('[data-error-for="external_url"]')).toHaveText('Aby opublikować wydarzenie, podaj link do szczegółów.');
    expect((await readEvent(id))!.status).toBe('draft');
    expect(rebuild.count).toBe(0);
  });

  test('AC-51 AC-52 AC-29: szkic → publikacja → zapis → cofnięcie → usunięcie, z przebudowami', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { id, name } = await seedEvent({ external_url: 'https://example.com/e' });
    await page.goto(editUrl(id));

    await page.getByRole('button', { name: 'Opublikuj' }).click();
    await expect(status(page, `Opublikowano. ${STARTED}`)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Opublikowane');
    const published = await readEvent(id);
    expect(published!.status).toBe('published');
    expect(published!.published_at).not.toBeNull();
    expect(rebuild.count).toBe(1);

    await page.getByLabel('Opis').fill('Nowy opis.');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(status(page, `Zapisano. ${STARTED}`)).toBeVisible();
    expect(rebuild.count).toBe(2);

    let unpublishMessage = '';
    page.once('dialog', (dialog) => {
      unpublishMessage = dialog.message();
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Cofnij publikację' }).click();
    await expect(status(page, `Cofnięto publikację. ${STARTED}`)).toBeVisible();
    expect(unpublishMessage).toContain(name);
    expect((await readEvent(id))!.status).toBe('draft');
    expect(rebuild.count).toBe(3);

    // Republikacja, potem usunięcie opublikowanego → przebudowa.
    await page.getByRole('button', { name: 'Opublikuj' }).click();
    await expect(status(page, `Opublikowano. ${STARTED}`)).toBeVisible();
    expect(rebuild.count).toBe(4);
    let deleteMessage = '';
    page.once('dialog', (dialog) => {
      deleteMessage = dialog.message();
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Usuń wydarzenie' }).click();
    await expect(status(page, `Usunięto wydarzenie. ${STARTED}`)).toBeVisible();
    expect(deleteMessage).toBe(`Czy na pewno usunąć wydarzenie „${name}”? Tej operacji nie można cofnąć.`);
    expect(await readEvent(id)).toBeNull();
    expect(rebuild.count).toBe(5);
  });

  test('AC-52: usunięcie szkicu bez przebudowy; anulowanie potwierdzenia nic nie usuwa', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { id } = await seedEvent();
    await page.goto(editUrl(id));
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Usuń wydarzenie' }).click();
    expect(await readEvent(id)).not.toBeNull();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Usuń wydarzenie' }).click();
    await expect(status(page, 'Usunięto wydarzenie.')).toHaveText('Usunięto wydarzenie.');
    expect(await readEvent(id)).toBeNull();
    expect(rebuild.count).toBe(0);
  });

  test('AC-48: kategoria ukryta nie jest do wyboru przy nowym, ale zostaje w istniejącym', async ({ page }) => {
    const { id } = await seedEvent();
    const { data } = await admin().from('calendar_events').select('category_id').eq('id', id).single();
    const { data: category } = await admin()
      .from('event_categories')
      .update({ is_active: false })
      .eq('id', data!.category_id)
      .select('name')
      .single();
    await page.goto(NEW_URL);
    await expect(page.getByLabel('Kategoria *').locator('option', { hasText: category!.name })).toHaveCount(0);
    await page.goto(editUrl(id));
    await expect(page.getByLabel('Kategoria *')).toHaveValue(data!.category_id);
    await expect(page.getByLabel('Kategoria *').locator('option:checked')).toHaveText(`${category!.name} — ukryta`);
  });

  test('AC-6: nazwa wydarzenia na liście panelu prowadzi do edycji', async ({ page }) => {
    const { id, name } = await seedEvent();
    await page.goto('/panel/');
    await page.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(editUrl(id));
    await expect(page.getByLabel('Nazwa *')).toHaveValue(name);
  });
});
