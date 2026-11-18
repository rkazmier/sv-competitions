import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { admin, ensureUser, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-005 US-9 (AC-26…AC-29) i AC-21 (adnotacja admina z przeglądu): przegląd książki przez admina, miniatury podpisów, eksport PDF i CSV, `audit_log`.
// Filtry, kolumny i dziennik po stronie bazy: pgTAP 021; CSV i układ PDF: Vitest (range-review, range-pdf).
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');
test.describe.configure({ mode: 'serial' });

// PNG 1×1 — podpis zapisany jak z ekranu (prywatny bucket `signatures`).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
let guest: string;
let officer: string;

test.beforeAll(async () => {
  officer = unique('Prowadzący przegląd');
  const { data: officerRow } = await admin().from('range_officers').insert({ full_name: officer }).select('id').single();
  // Wpis zapisuje obsługa (funkcja `create_range_log_entry` wymaga `is_staff()`): osoba bez konta jako towarzysząca.
  const staff = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await staff.auth.signInWithPassword({ email: await ensureUser('staff'), password: 'local-e2e-only-password' });
  guest = unique('Ewa Przegląd');
  const id = crypto.randomUUID();
  const now = new Date();
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.png`;
  expect((await staff.storage.from('signatures').upload(path, PNG, { contentType: 'image/png' })).error).toBeNull();
  const created = await staff.rpc('create_range_log_entry', {
    p_id: id,
    p_signature_path: path,
    p_range_officer_id: officerRow!.id,
    p_is_companion: true,
    p_full_name: guest,
    p_address: 'ul. Stalowa 1, Katowice',
  });
  expect(created.error).toBeNull();
  expect((await staff.from('range_log_annotations').insert({ entry_id: id, body: 'Literówka w adresie' })).error).toBeNull();
});

const exportCount = async () =>
  (await admin().from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'range_log_export')).count ?? 0;

test('AC-26, AC-29: admin filtruje książkę i widzi kolumny, miniaturę podpisu i adnotację', async ({ page }) => {
  await signIn(page, 'admin');
  const before = await exportCount();
  await page.goto('/panel/ksiazka/przeglad/');
  await expect(page.getByRole('heading', { name: 'Przegląd książki rejestru pobytu' })).toBeVisible();
  await page.getByLabel('Imię i nazwisko').fill(guest);
  await page.getByLabel('Prowadzący strzelanie').selectOption({ label: officer });
  await page.getByRole('button', { name: 'Pokaż' }).click();
  await expect(page.getByText('Wpisów: 1')).toBeVisible();

  const headers = page.getByRole('columnheader');
  await expect(headers).toHaveText([
    'Data i godzina', 'Imię i nazwisko', 'Nr decyzji i organ wydający / Adres zamieszkania', 'Prowadzący strzelanie', 'Podpis',
  ]);
  const row = page.getByRole('row').filter({ hasText: guest, has: page.getByRole('img') });
  await expect(row.getByRole('cell')).toHaveText([/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/, guest, 'ul. Stalowa 1, Katowice', officer, '']);
  const signature = row.getByRole('img', { name: `Podpis: ${guest}` });
  await expect(signature).toHaveAttribute('src', /\/storage\/v1\/object\/sign\/signatures\/.+token=/);
  await expect.poll(() => signature.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('list', { name: 'Adnotacje' }).getByText(/: Literówka w adresie$/)).toBeVisible();
  // Wejście na stronę (dzisiejszy dzień) i filtrowanie — dwa wyświetlenia podpisów.
  expect(await exportCount()).toBe(before + 2);

  // AC-21: admin dodaje adnotację do dowolnego wpisu z przeglądu.
  await page.getByRole('button', { name: new RegExp(`Dodaj adnotację do wpisu: ${guest}`) }).click();
  await page.getByLabel('Treść adnotacji (5–500 znaków)').fill('Sprawdzono z dowodem');
  await page.getByRole('button', { name: 'Zapisz adnotację' }).click();
  await expect(page.getByRole('list', { name: 'Adnotacje' }).getByText(/: Sprawdzono z dowodem$/)).toBeVisible();
});

test('AC-27, AC-28, AC-29: eksport CSV i PDF z bieżących filtrów, każdy w dzienniku', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/panel/ksiazka/przeglad/');
  await page.getByLabel('Imię i nazwisko').fill(guest);
  await page.getByRole('button', { name: 'Pokaż' }).click();
  await expect(page.getByText('Wpisów: 1')).toBeVisible();
  const before = await exportCount();

  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Eksport CSV' }).click()]);
  expect(csv.suggestedFilename()).toMatch(/^ksiazka-\d{4}-\d{2}-\d{2}\.csv$/);
  const content = readFileSync(await csv.path(), 'utf8');
  expect(content.startsWith('﻿"Data i godzina";"Imię i nazwisko";')).toBe(true);
  expect(content).toMatch(new RegExp(`"\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}";"${guest}";"ul\\. Stalowa 1, Katowice";"[^"]+";"tak";"[^"]*Literówka w adresie[^"]*"`));

  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Eksport PDF' }).click()]);
  expect(pdf.suggestedFilename()).toMatch(/^ksiazka-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(readFileSync(await pdf.path()).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.getByRole('alert')).toBeHidden();

  const { data: logged } = await admin()
    .from('audit_log').select('changes').eq('action', 'range_log_export').order('id', { ascending: false }).limit(2);
  expect(logged!.map((row) => row.changes.format)).toEqual(['pdf', 'csv']);
  expect(await exportCount()).toBe(before + 2);

  await page.getByLabel('Data od').fill('');
  await page.getByRole('button', { name: 'Eksport PDF' }).click();
  await expect(page.getByText('Do eksportu wybierz dzień lub zakres dat (od nie później niż do).')).toBeVisible();
});
