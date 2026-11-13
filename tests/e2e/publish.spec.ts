import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-001 US-6, US-7: publikacja zawodów i wyzwalacze przebudowy (AC-25…29, AC-34, §7).
// Edge Function `site-rebuild` jest zamockowana (page.route) — jej logikę sprawdzają testy Deno.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const editUrl = (id: string) => `/panel/zawody/edytuj/?id=${id}`;
const STARTED = 'Strona publiczna odświeży się w ciągu kilku minut.';
const FAILED = 'Nie udało się uruchomić odświeżenia strony. Spróbuj „Odśwież stronę publiczną” za chwilę.';

/** Mock funkcji `site-rebuild`; zwraca licznik wywołań. */
async function mockRebuild(page: Page, status = 202): Promise<{ count: number }> {
  const calls = { count: 0 };
  await page.route('**/functions/v1/site-rebuild', async (route) => {
    if (route.request().method() === 'POST') calls.count += 1;
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' },
      body: JSON.stringify(status < 300 ? { ok: true } : { error: 'dispatch_failed' }),
    });
  });
  return calls;
}

async function seedRulebook(): Promise<string> {
  const { data, error } = await admin()
    .from('rulebooks')
    .insert({ title: unique('Regulamin P'), file_path: `rulebooks/${crypto.randomUUID()}.pdf`, file_size: 10 })
    .select('id')
    .single();
  expect(error).toBeNull();
  return data!.id;
}

async function seedCompetition(fields: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const db = admin();
  const { data: discipline } = await db.from('disciplines').insert({ name: unique('Dyscyplina P') }).select('id').single();
  const { data, error } = await db
    .from('competitions')
    .insert({ name: unique('Zawody P'), discipline_id: discipline!.id, starts_on: '2031-07-10', ...fields })
    .select('id, name')
    .single();
  expect(error).toBeNull();
  return data!;
}

const readCompetition = async (id: string) =>
  (await admin().from('competitions').select('status, published_at, slug, name').eq('id', id).single()).data!;
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test.describe('organizator', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'organizer');
  });

  test('AC-25 AC-29: „Opublikuj” — stan, published_at, komunikat i przebudowa', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { id } = await seedCompetition({ rulebook_id: await seedRulebook() });
    await page.goto(editUrl(id));
    await page.getByRole('button', { name: 'Opublikuj' }).click();
    await expect(status(page, `Opublikowano. ${STARTED}`)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Opublikowane');
    await expect(page.getByRole('button', { name: 'Cofnij publikację' })).toBeVisible();
    const row = await readCompetition(id);
    expect(row.status).toBe('published');
    expect(row.published_at).not.toBeNull();
    expect(rebuild.count).toBe(1);
  });

  test('AC-26: szkic bez regulaminu — komunikat, stan bez zmian, bez przebudowy', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { id } = await seedCompetition();
    await page.goto(editUrl(id));
    await page.getByRole('button', { name: 'Opublikuj' }).click();
    await expect(page.locator('[data-rulebook-error]')).toHaveText('Aby opublikować zawody, wybierz regulamin.');
    await expect(page.getByLabel('Regulamin')).toBeFocused();
    expect((await readCompetition(id)).status).toBe('draft');
    expect(rebuild.count).toBe(0);
  });

  test('AC-27: „Cofnij publikację” z potwierdzeniem — szkic i przebudowa', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { id, name } = await seedCompetition({ rulebook_id: await seedRulebook(), status: 'published' });
    await page.goto(editUrl(id));
    let message = '';
    page.once('dialog', (dialog) => {
      message = dialog.message();
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Cofnij publikację' }).click();
    await expect(status(page, `Cofnięto publikację. ${STARTED}`)).toBeVisible();
    expect(message).toContain(name);
    expect((await readCompetition(id)).status).toBe('draft');
    await expect(page.getByRole('button', { name: 'Opublikuj' })).toBeVisible();
    expect(rebuild.count).toBe(1);
  });

  test('AC-28: zapis opublikowanych zawodów — przebudowa, slug bez zmian', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { id } = await seedCompetition({ rulebook_id: await seedRulebook(), status: 'published' });
    const before = await readCompetition(id);
    await page.goto(editUrl(id));
    await page.getByLabel('Nazwa *').fill(unique('Nowa nazwa'));
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(status(page, `Zapisano. ${STARTED}`)).toBeVisible();
    const after = await readCompetition(id);
    expect(after.name).not.toBe(before.name);
    expect(after.slug).toBe(before.slug);
    expect(rebuild.count).toBe(1);
  });

  test('AC-29: zapis szkicu nie uruchamia przebudowy', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { id } = await seedCompetition();
    await page.goto(editUrl(id));
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(status(page, 'Zapisano.')).toHaveText('Zapisano.');
    expect(rebuild.count).toBe(0);
  });

  test('AC-29: zmiana nazwy dyscypliny uruchamia przebudowę', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    const { data: discipline } = await admin().from('disciplines').insert({ name: unique('Dysc R') }).select('name').single();
    await page.goto('/panel/dyscypliny/');
    const item = page.getByRole('main').getByRole('listitem').filter({ hasText: discipline!.name });
    await item.getByRole('button', { name: /Zmień nazwę/ }).click();
    await item.getByLabel('Nowa nazwa').fill(unique('Dysc R2'));
    await item.getByRole('button', { name: 'Zapisz' }).click();
    await expect(status(page, `Zapisano. ${STARTED}`)).toBeVisible();
    expect(rebuild.count).toBe(1);
  });

  test('AC-34: „Odśwież stronę publiczną” uruchamia przebudowę', async ({ page }) => {
    const rebuild = await mockRebuild(page);
    await page.goto('/panel/');
    await page.getByRole('button', { name: 'Odśwież stronę publiczną' }).click();
    await expect(status(page, STARTED)).toBeVisible();
    expect(rebuild.count).toBe(1);
  });

  test('§7: nieudane uruchomienie przebudowy — dane zapisane, komunikat o błędzie', async ({ page }) => {
    await mockRebuild(page, 502);
    const { id } = await seedCompetition({ rulebook_id: await seedRulebook() });
    await page.goto(editUrl(id));
    await page.getByRole('button', { name: 'Opublikuj' }).click();
    await expect(status(page, `Opublikowano. ${FAILED}`)).toBeVisible();
    expect((await readCompetition(id)).status).toBe('published');
  });
});
