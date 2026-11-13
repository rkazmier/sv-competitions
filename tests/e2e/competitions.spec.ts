import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-001 US-5: formularz zawodów, harmonogram, matchbook, usuwanie szkicu (AC-17…23). Wymaga lokalnego Supabase.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const NEW = '/panel/zawody/nowe/';
const editUrl = (id: string) => `/panel/zawody/edytuj/?id=${id}`;
const BUCKET = 'documents';
const pdfBuffer = (extra = '') => Buffer.from(`%PDF-1.4\n% matchbook${extra}\n%%EOF\n`);
const pdfFile = (extra = '') => ({ name: 'Matchbook.pdf', mimeType: 'application/pdf', buffer: pdfBuffer(extra) });

async function seedDiscipline(name = unique('Dyscyplina Z'), is_active = true): Promise<{ id: string; name: string }> {
  const { data, error } = await admin().from('disciplines').insert({ name, is_active }).select('id, name').single();
  expect(error).toBeNull();
  return data!;
}

async function seedCompetition(fields: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
  const discipline = fields.discipline_id ? null : await seedDiscipline();
  const name = unique('Zawody E2E');
  const { data, error } = await admin()
    .from('competitions')
    .insert({ name, discipline_id: discipline?.id, starts_on: '2031-06-14', ...fields })
    .select('id, name')
    .single();
  expect(error).toBeNull();
  return data!;
}

async function fileExists(path: string): Promise<boolean> {
  const { data } = await admin().storage.from(BUCKET).download(path);
  return data !== null;
}

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const scheduleRows = (page: Page) => page.locator('[data-schedule-body] tr');

async function addPoint(page: Page, day: string, time: string, description: string) {
  await page.getByLabel('Dzień', { exact: true }).fill(day);
  await page.getByLabel('Godzina (opcjonalnie)').fill(time);
  await page.getByLabel('Opis', { exact: true }).last().fill(description);
  await page.getByRole('button', { name: 'Dodaj punkt' }).click();
}

test.describe('organizator', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'organizer');
  });

  test('AC-17: nowe zawody z nazwą, aktywną dyscypliną i datą — szkic', async ({ page }) => {
    const active = await seedDiscipline();
    const hidden = await seedDiscipline(unique('Ukryta Z'), false);
    const name = unique('Puchar E2E');
    await page.goto(NEW);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
    const select = page.getByLabel('Dyscyplina *');
    await expect(select.locator('option', { hasText: hidden.name })).toHaveCount(0);

    await page.getByLabel('Nazwa *').fill(name);
    await select.selectOption({ label: active.name });
    await page.getByLabel('Data początku *').fill('2031-06-14');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();

    await expect(page).toHaveURL(/\/panel\/zawody\/edytuj\/\?id=[0-9a-f-]{36}$/);
    await expect(status(page, 'Zapisano.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Szkic');
    const { data } = await admin().from('competitions').select('status, ends_on, rulebook_id').eq('name', name).single();
    expect(data).toEqual({ status: 'draft', ends_on: null, rulebook_id: null });
  });

  test('AC-17: brak wymaganych pól — komunikaty, nic nie jest zapisywane', async ({ page }) => {
    await page.goto(NEW);
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByText('Podaj nazwę.')).toBeVisible();
    await expect(page.getByText('Wybierz dyscyplinę.')).toBeVisible();
    await expect(page.getByText('Podaj datę początku.')).toBeVisible();
    await expect(page).toHaveURL(NEW);
  });

  test('AC-18: data końca przed datą początku — komunikat, nic nie jest zapisywane', async ({ page }) => {
    const discipline = await seedDiscipline();
    const name = unique('Zła data');
    await page.goto(NEW);
    await page.getByLabel('Nazwa *').fill(name);
    await page.getByLabel('Dyscyplina *').selectOption({ label: discipline.name });
    await page.getByLabel('Data początku *').fill('2031-06-14');
    await page.getByLabel('Data końca (opcjonalnie)').fill('2031-06-13');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByText('Data końca nie może być wcześniejsza niż data początku.')).toBeVisible();
    const { data } = await admin().from('competitions').select('id').eq('name', name);
    expect(data).toEqual([]);
  });

  test('AC-19: regulaminy — tylko niezarchiwizowane, od najnowszych, z datą wczytania', async ({ page }) => {
    const db = admin();
    const titles = [unique('Reg starszy'), unique('Reg nowszy'), unique('Reg archiwum')];
    const rows = titles.map((title, i) => ({
      title,
      file_path: `rulebooks/${crypto.randomUUID()}.pdf`,
      file_size: 10,
      is_archived: i === 2,
      created_at: `2026-0${i + 1}-01T10:00:00Z`,
    }));
    for (const row of rows) expect((await db.from('rulebooks').insert(row)).error).toBeNull();
    await page.goto(NEW);
    const options = await page.getByLabel('Regulamin').locator('option').allTextContents();
    const ours = options.filter((text) => titles.some((title) => text.startsWith(title)));
    expect(ours).toHaveLength(2);
    expect(ours[0]).toMatch(new RegExp(`^${titles[1]} \\(wczytano \\d{1,2} \\p{L}+ \\d{4}\\)$`, 'u'));
    expect(ours[1]).toContain(titles[0]);
    expect(options[0]).toBe('— wybierz —');
  });

  test('AC-17 §7: ukryta dyscyplina zostaje w istniejących zawodach', async ({ page }) => {
    const hidden = await seedDiscipline(unique('Ukryta W'), false);
    const { id } = await seedCompetition({ discipline_id: hidden.id });
    await page.goto(editUrl(id));
    await expect(page.getByLabel('Dyscyplina *').locator('option:checked')).toHaveText(`${hidden.name} — ukryta`);
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(status(page, 'Zapisano.')).toBeVisible();
  });

  test('§7: dwa szkice o tej samej nazwie i dacie mają różne slug', async ({ page }) => {
    const { id, name } = await seedCompetition();
    const { data: first } = await admin().from('competitions').select('slug, discipline_id').eq('id', id).single();
    const { data: discipline } = await admin().from('disciplines').select('name').eq('id', first!.discipline_id).single();
    await page.goto(NEW);
    await page.getByLabel('Nazwa *').fill(name);
    await page.getByLabel('Dyscyplina *').selectOption({ label: discipline!.name });
    await page.getByLabel('Data początku *').fill('2031-06-14');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(status(page, 'Zapisano.')).toBeVisible();
    const { data } = await admin().from('competitions').select('slug').eq('name', name).order('created_at');
    expect(data!.map((row) => row.slug)).toEqual([first!.slug, `${first!.slug}-2`]);
  });

  test('AC-20: matchbook — wczytanie, podmiana (stary plik usunięty) i usunięcie', async ({ page }) => {
    const { id } = await seedCompetition();
    const db = admin();
    const path = async () => (await db.from('competitions').select('matchbook_path').eq('id', id).single()).data!.matchbook_path;
    await page.goto(editUrl(id));
    await expect(page.getByText('Brak matchbooka (opcjonalny).')).toBeVisible();

    await page.getByLabel('Plik PDF (maks. 20 MB)').setInputFiles(pdfFile('1'));
    await page.getByRole('button', { name: 'Wczytaj matchbook' }).click();
    await expect(page.getByRole('link', { name: 'Pobierz matchbook (PDF)' })).toBeVisible();
    const first = await path();
    expect(first).toMatch(new RegExp(`^matchbooks/${id}/[0-9a-f-]{36}\\.pdf$`));
    expect(await fileExists(first)).toBe(true);

    await page.getByLabel('Plik PDF (maks. 20 MB)').setInputFiles(pdfFile('2'));
    await page.getByRole('button', { name: 'Podmień matchbook' }).click();
    await expect.poll(path).not.toBe(first);
    const second = await path();
    expect(await fileExists(second)).toBe(true);
    await expect.poll(() => fileExists(first)).toBe(false);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Usuń matchbook' }).click();
    await expect(status(page, 'Usunięto matchbook.')).toBeVisible();
    expect(await path()).toBeNull();
    await expect.poll(() => fileExists(second)).toBe(false);
  });

  test('AC-20: matchbook nie-PDF — komunikat, nic nie jest wczytywane', async ({ page }) => {
    const { id } = await seedCompetition();
    await page.goto(editUrl(id));
    await page.getByLabel('Plik PDF (maks. 20 MB)').setInputFiles({
      name: 'zdjecie.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('jpeg'),
    });
    await page.getByRole('button', { name: 'Wczytaj matchbook' }).click();
    await expect(page.getByText('Dozwolony jest tylko plik PDF.')).toBeVisible();
    const { data } = await admin().from('competitions').select('matchbook_path').eq('id', id).single();
    expect(data!.matchbook_path).toBeNull();
  });

  test('AC-21: harmonogram — dodawanie, sortowanie, edycja i usuwanie', async ({ page }) => {
    const { id } = await seedCompetition({ ends_on: '2031-06-15' });
    await page.goto(editUrl(id));
    await expect(page.getByLabel('Dzień', { exact: true })).toHaveValue('2031-06-14');
    await addPoint(page, '2031-06-15', '09:00', 'Finał');
    await addPoint(page, '2031-06-14', '08:00', 'Odprawa');
    await addPoint(page, '2031-06-14', '', 'Rejestracja');
    await expect(scheduleRows(page)).toHaveCount(3);
    await expect(scheduleRows(page).locator('[data-description]')).toHaveText(['Rejestracja', 'Odprawa', 'Finał']);
    await expect(scheduleRows(page).nth(1).locator('[data-time]')).toHaveText('08:00');
    await expect(scheduleRows(page).first().locator('[data-day]')).toHaveText('14 czerwca 2031');

    await page.getByRole('button', { name: /^Edytuj.*Odprawa/ }).click();
    await page.getByLabel('Opis', { exact: true }).last().fill('Odprawa sędziów');
    await page.getByRole('button', { name: 'Zapisz punkt' }).click();
    await expect(scheduleRows(page).nth(1).locator('[data-description]')).toHaveText('Odprawa sędziów');

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /^Usuń.*Finał/ }).click();
    await expect(scheduleRows(page)).toHaveCount(2);
    const { data } = await admin().from('schedule_items').select('description').eq('competition_id', id);
    expect(data!.map((row) => row.description).sort()).toEqual(['Odprawa sędziów', 'Rejestracja']);
  });

  test('AC-22: dzień poza terminem i zmiana dat blokująca zapis', async ({ page }) => {
    const { id } = await seedCompetition({ ends_on: '2031-06-15' });
    await page.goto(editUrl(id));
    await addPoint(page, '2031-06-16', '', 'Poza terminem');
    await expect(page.locator('[data-item-error]')).toHaveText('Dzień musi mieścić się w terminie zawodów.');
    await expect(scheduleRows(page)).toHaveCount(0);

    await addPoint(page, '2031-06-15', '10:00', 'Drugi dzień');
    await expect(scheduleRows(page)).toHaveCount(1);
    await page.getByLabel('Data końca (opcjonalnie)').fill('');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(scheduleRows(page).first()).toContainText('Dzień musi mieścić się w terminie zawodów.');
    await expect(status(page, 'Dzień musi mieścić się w terminie zawodów.')).toBeVisible();
    const { data } = await admin().from('competitions').select('ends_on').eq('id', id).single();
    expect(data!.ends_on).toBe('2031-06-15');
  });

  test('AC-23: usunięcie szkicu usuwa zawody, harmonogram i plik matchbooka', async ({ page }) => {
    const { id, name } = await seedCompetition();
    const db = admin();
    const file = `matchbooks/${id}/${crypto.randomUUID()}.pdf`;
    expect((await db.storage.from(BUCKET).upload(file, pdfBuffer(), { contentType: 'application/pdf' })).error).toBeNull();
    await db.from('competitions').update({ matchbook_path: file }).eq('id', id);
    await db.from('schedule_items').insert({ competition_id: id, day: '2031-06-14', description: 'Start' });

    await page.goto(editUrl(id));
    let message = '';
    page.once('dialog', (dialog) => {
      message = dialog.message();
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Usuń zawody' }).click();
    await expect(page).toHaveURL('/panel/');
    expect(message).toBe(`Czy na pewno usunąć zawody „${name}”? Tej operacji nie można cofnąć.`);
    expect((await db.from('competitions').select('id').eq('id', id)).data).toEqual([]);
    expect((await db.from('schedule_items').select('id').eq('competition_id', id)).data).toEqual([]);
    await expect.poll(() => fileExists(file)).toBe(false);
  });

  test('AC-23: opublikowanych zawodów nie da się usunąć', async ({ page }) => {
    const { data: rulebook } = await admin()
      .from('rulebooks')
      .insert({ title: unique('Reg P'), file_path: `rulebooks/${crypto.randomUUID()}.pdf`, file_size: 10 })
      .select('id')
      .single();
    const { id } = await seedCompetition({ rulebook_id: rulebook!.id, status: 'published' });
    await page.goto(editUrl(id));
    await expect(page.getByText('Opublikowanych zawodów nie można usunąć — najpierw cofnij publikację.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Usuń zawody' })).toBeHidden();
  });

  test('Lista w /panel/ linkuje do edycji zawodów', async ({ page }) => {
    const { id, name } = await seedCompetition();
    await page.goto('/panel/');
    await page.getByRole('link', { name }).click();
    await expect(page).toHaveURL(editUrl(id));
    await expect(page.getByLabel('Nazwa *')).toHaveValue(name);
  });

  test('Harmonogram na telefonie (375 px) jako lista kart, bez poziomego przewijania', async ({ page }) => {
    const { id } = await seedCompetition({ ends_on: '2031-06-15' });
    const db = admin();
    await db.from('schedule_items').insert([
      { competition_id: id, day: '2031-06-14', time: '08:00', description: 'Rejestracja zawodników' },
      { competition_id: id, day: '2031-06-14', time: '09:00', description: 'Odprawa i bezpieczeństwo' },
      { competition_id: id, day: '2031-06-15', description: 'Ceremonia zakończenia z rozdaniem nagród' },
    ]);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(editUrl(id));
    await expect(scheduleRows(page)).toHaveCount(3);
    expect(await scheduleRows(page).first().evaluate((tr) => getComputedStyle(tr).display)).toBe('block');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const path = test.info().outputPath('schedule-375.png');
    await page.screenshot({ path, fullPage: true });
    await test.info().attach('harmonogram-375px', { path, contentType: 'image/png' });
  });
});
