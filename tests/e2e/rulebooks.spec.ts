import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-001 US-4: biblioteka regulaminów PDF (AC-12…16). Wymaga lokalnego Supabase; w CI zawsze uruchamiane.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PATH = '/panel/regulaminy/';
const BUCKET = 'documents';
const pdfBuffer = (extra = '') => Buffer.from(`%PDF-1.4\n% test${extra}\n%%EOF\n`);

const itemFor = (page: Page, title: string) =>
  page.getByRole('main').getByRole('listitem').filter({ has: page.getByText(title, { exact: true }) });

/** Regulamin wstawiony bezpośrednio (plik + wiersz) kluczem lokalnej instancji. */
async function seedRulebook(title: string, extra: Partial<{ is_archived: boolean }> = {}) {
  const db = admin();
  const id = crypto.randomUUID();
  const file_path = `rulebooks/${id}.pdf`;
  const body = pdfBuffer(id);
  const upload = await db.storage.from(BUCKET).upload(file_path, body, { contentType: 'application/pdf' });
  expect(upload.error).toBeNull();
  const { error } = await db.from('rulebooks').insert({ id, title, file_path, file_size: body.length, ...extra });
  expect(error).toBeNull();
  return { id, file_path };
}

async function fileExists(path: string): Promise<boolean> {
  const { data } = await admin().storage.from(BUCKET).download(path);
  return data !== null;
}

test.describe('niezalogowany', () => {
  test('AC-12: /panel/regulaminy/ ma noindex i wymaga logowania', async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    await expect(page.getByRole('button', { name: 'Zaloguj się przez Google' })).toBeVisible();
  });
});

test.describe('organizator', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'organizer');
  });

  test('AC-12: wczytanie PDF — plik w Storage, regulamin na liście z datą, linkiem i liczbą zawodów', async ({
    page,
  }) => {
    const title = unique('Regulamin E2E');
    await page.goto(PATH);
    await expect(page.getByText('Nie wczytuj plików z danymi osobowymi zawodników.')).toBeVisible();
    await page.getByLabel('Tytuł', { exact: true }).fill(`  ${title} `);
    await page.getByLabel('Plik PDF (maks. 20 MB)').setInputFiles({
      name: 'Regulamin Jan Kowalski.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer(),
    });
    await page.getByRole('button', { name: 'Wczytaj' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();

    const item = itemFor(page, title);
    await expect(item).toContainText(/Wczytano \d{1,2} \p{L}+ \d{4}/u);
    await expect(item).toContainText('Liczba zawodów: 0');

    const { data } = await admin().from('rulebooks').select('file_path, file_size').eq('title', title).single();
    expect(data?.file_path).toMatch(/^rulebooks\/[0-9a-f-]{36}\.pdf$/);
    expect(data?.file_size).toBe(pdfBuffer().length);
    expect(await fileExists(data!.file_path)).toBe(true);

    const href = await item.getByRole('link', { name: /Pobierz PDF/ }).getAttribute('href');
    expect(href).toContain(data!.file_path);
    const response = await page.request.get(href!);
    expect(response.ok()).toBe(true);
  });

  test('AC-12: liczba zawodów, które używają regulaminu', async ({ page }) => {
    const title = unique('Regulamin używany');
    const { id } = await seedRulebook(title);
    const db = admin();
    const { data: d } = await db.from('disciplines').insert({ name: unique('Dyscyplina R') }).select('id').single();
    const inserted = await db.from('competitions').insert([
      { name: unique('Zawody R1'), discipline_id: d!.id, starts_on: '2031-05-01', rulebook_id: id, status: 'draft' },
      { name: unique('Zawody R2'), discipline_id: d!.id, starts_on: '2031-05-02', rulebook_id: id, status: 'published' },
    ]);
    expect(inserted.error).toBeNull();

    await page.goto(PATH);
    await expect(itemFor(page, title)).toContainText('Liczba zawodów: 2');
  });

  const invalidFiles = [
    {
      label: 'nie-PDF',
      file: { name: 'zdjecie.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpeg') },
      message: 'Dozwolony jest tylko plik PDF.',
    },
    {
      label: 'plik ponad 20 MB',
      file: {
        name: 'duzy.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.concat([pdfBuffer(), Buffer.alloc(20 * 1024 * 1024)]),
      },
      message: 'Plik jest za duży (maks. 20 MB).',
    },
  ];

  for (const { label, file, message } of invalidFiles) {
    test(`AC-13: ${label} — komunikat i nic nie jest zapisywane`, async ({ page }) => {
      const title = unique('Odrzucony');
      const uploads: string[] = [];
      page.on('request', (request) => {
        if (/\/storage\/v1\/object\//.test(request.url()) && request.method() === 'POST') uploads.push(request.url());
      });
      await page.goto(PATH);
      await page.getByLabel('Tytuł', { exact: true }).fill(title);
      await page.getByLabel('Plik PDF (maks. 20 MB)').setInputFiles(file);
      await page.getByRole('button', { name: 'Wczytaj' }).click();
      await expect(page.getByText(message)).toBeVisible();
      await expect(page.getByLabel('Plik PDF (maks. 20 MB)')).toHaveAttribute('aria-invalid', 'true');

      const { data } = await admin().from('rulebooks').select('id').eq('title', title);
      expect(data).toEqual([]);
      expect(uploads).toEqual([]);
    });
  }

  test('AC-14: „Archiwizuj” i „Przywróć”; link do pliku nadal działa', async ({ page }) => {
    const title = unique('Do archiwum');
    const { id } = await seedRulebook(title);
    await page.goto(PATH);
    const item = itemFor(page, title);

    await item.getByRole('button', { name: /^Archiwizuj/ }).click();
    await expect(item).toContainText('Zarchiwizowany');
    const { data: archived } = await admin().from('rulebooks').select('is_archived').eq('id', id).single();
    expect(archived?.is_archived).toBe(true);
    const href = await item.getByRole('link', { name: /Pobierz PDF/ }).getAttribute('href');
    expect((await page.request.get(href!)).ok()).toBe(true);

    await item.getByRole('button', { name: /^Przywróć/ }).click();
    await expect(item.getByText('Zarchiwizowany')).toBeHidden();
    const { data: restored } = await admin().from('rulebooks').select('is_archived').eq('id', id).single();
    expect(restored?.is_archived).toBe(false);
  });

  test('AC-15: nieużywany — „Usuń” z potwierdzeniem usuwa wiersz i plik', async ({ page }) => {
    const title = unique('Do usunięcia');
    const { id, file_path } = await seedRulebook(title);
    await page.goto(PATH);
    const item = itemFor(page, title);

    let confirmText = '';
    page.once('dialog', (dialog) => {
      confirmText = dialog.message();
      void dialog.accept();
    });
    await item.getByRole('button', { name: /^Usuń/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Usunięto.' })).toBeVisible();
    expect(confirmText).toBe(`Czy na pewno usunąć regulamin „${title}”? Tej operacji nie można cofnąć.`);
    await expect(itemFor(page, title)).toHaveCount(0);

    const { data } = await admin().from('rulebooks').select('id').eq('id', id);
    expect(data).toEqual([]);
    await expect.poll(() => fileExists(file_path)).toBe(false);
  });

  test('AC-15: anulowanie potwierdzenia nic nie usuwa', async ({ page }) => {
    const title = unique('Zostaje');
    const { id } = await seedRulebook(title);
    await page.goto(PATH);
    page.once('dialog', (dialog) => void dialog.dismiss());
    await itemFor(page, title).getByRole('button', { name: /^Usuń/ }).click();
    await expect(itemFor(page, title)).toBeVisible();
    const { data } = await admin().from('rulebooks').select('id').eq('id', id);
    expect(data).toHaveLength(1);
  });

  test('AC-15: używany przez zawody — brak „Usuń”, jest „Archiwizuj”', async ({ page }) => {
    const title = unique('Używany');
    const { id } = await seedRulebook(title);
    const db = admin();
    const { data: d } = await db.from('disciplines').insert({ name: unique('Dyscyplina U') }).select('id').single();
    const inserted = await db
      .from('competitions')
      .insert({ name: unique('Zawody U'), discipline_id: d!.id, starts_on: '2031-05-03', rulebook_id: id });
    expect(inserted.error).toBeNull();

    await page.goto(PATH);
    const item = itemFor(page, title);
    await expect(item.getByRole('button', { name: /^Archiwizuj/ })).toBeVisible();
    await expect(item.getByRole('button', { name: /^Usuń/ })).toHaveCount(0);
  });

  test('AC-16: tytuł można poprawić, pliku nie można podmienić', async ({ page }) => {
    const title = unique('Stary tytuł');
    const renamed = unique('Nowy tytuł');
    const { id, file_path } = await seedRulebook(title);
    await page.goto(PATH);
    const item = itemFor(page, title);
    await expect(item.locator('input[type="file"]')).toHaveCount(0);
    await expect(item.getByRole('button', { name: /podmień|zmień plik/i })).toHaveCount(0);

    await item.getByRole('button', { name: /^Zmień tytuł/ }).click();
    await item.getByLabel('Nowy tytuł').fill(renamed);
    await item.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toBeVisible();
    await expect(itemFor(page, renamed)).toBeVisible();

    const { data } = await admin().from('rulebooks').select('title, file_path').eq('id', id).single();
    expect(data).toEqual({ title: renamed, file_path });
  });

  test('AC-12: biblioteka na telefonie (320 px) bez poziomego przewijania', async ({ page }) => {
    await seedRulebook(unique('Regulamin o bardzo długim tytule, który musi się zawinąć na wąskim ekranie'));
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(PATH);
    await expect(page.getByRole('button', { name: 'Wczytaj' })).toBeVisible();
    await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
