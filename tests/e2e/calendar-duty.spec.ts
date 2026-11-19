import { expect, test, type Page } from '@playwright/test';
import { admin, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-007 US-7 (AC-26, AC-28, AC-29, AC-30): pole „Dyżurny Prowadzący (opcjonalnie)” w formularzach zawodów
// i wydarzeń. Kolejność źródeł, szkice, konflikt przy zmianie dat i brak `select` kolumny — pgTAP:
// supabase/tests/031_calendar_range_duty_test.sql. Terminy w 2034 r. — poza grafikiem (dziś + 90), bez wpływu
// na dzisiejszego dyżurnego; konflikt terminów jest globalny, więc testy szeregowo, każdy w innym miesiącu.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');
test.describe.configure({ mode: 'serial' });

const HINT = 'Obowiązuje we wszystkie dni zawodów lub wydarzenia. Możesz uzupełnić później. Bez dyżurnego obowiązuje grafik dyżurów.';
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

async function addOfficer(name: string): Promise<string> {
  const { data, error } = await admin().from('range_officers').insert({ full_name: name }).select('id').single();
  if (error || !data) throw error ?? new Error('Brak prowadzącego');
  return data.id as string;
}

async function seedEvent(fields: Record<string, unknown>): Promise<{ id: string; name: string }> {
  const db = admin();
  const { data: category } = await db.from('event_categories').insert({ name: unique('Kategoria D') }).select('id').single();
  const { data, error } = await db
    .from('calendar_events')
    .insert({ name: unique('Wydarzenie D'), category_id: category!.id, ...fields })
    .select('id, name')
    .single();
  expect(error).toBeNull();
  return data!;
}

async function seedCompetition(fields: Record<string, unknown>): Promise<{ id: string; name: string }> {
  const db = admin();
  const { data: discipline } = await db.from('disciplines').insert({ name: unique('Dyscyplina D') }).select('id').single();
  const { data, error } = await db
    .from('competitions')
    .insert({ name: unique('Zawody D'), discipline_id: discipline!.id, ...fields })
    .select('id, name')
    .single();
  expect(error).toBeNull();
  return data!;
}

const dutyOf = async (table: 'competitions' | 'calendar_events', id: string) =>
  (await admin().from(table).select('duty_range_officer_id').eq('id', id).single()).data?.duty_range_officer_id ?? null;

const dutyField = (page: Page) => page.getByRole('group', { name: 'Dyżurny Prowadzący (opcjonalnie)' });

async function chooseBySearch(page: Page, name: string): Promise<void> {
  const field = dutyField(page);
  await field.getByRole('button', { name: /^(Wybierz|Zmień) dyżurnego prowadzącego$/ }).click();
  await field.getByLabel('Szukaj prowadzącego').fill(name);
  await field.getByRole('button', { name: 'Szukaj', exact: true }).click();
  await field.locator('[data-officer-results]').getByRole('button', { name, exact: true }).click();
}

test.afterAll(async () => {
  const db = admin();
  await db.from('competitions').update({ duty_range_officer_id: null }).gte('starts_on', '2034-01-01').lt('starts_on', '2035-01-01');
  await db.from('calendar_events').update({ duty_range_officer_id: null }).gte('starts_on', '2034-01-01').lt('starts_on', '2035-01-01');
});

test('AC-26 AC-30: dyżurny wydarzenia — wybór, zapis i zmiana bez przebudowy strony', async ({ page }) => {
  await signIn(page, 'admin');
  const rebuild = await mockRebuild(page);
  const officer = unique('Dyżurny Wydarzenia');
  const officerId = await addOfficer(officer);
  const { id } = await seedEvent({ starts_on: '2034-01-10', external_url: 'https://example.com/d', status: 'published' });
  await page.goto(`/panel/wydarzenia/edytuj/?id=${id}`);

  const field = dutyField(page);
  await expect(field).toContainText('Nie wskazano');
  await expect(field).toContainText(HINT);

  await chooseBySearch(page, officer);
  await expect(field.locator('[data-duty-current]')).toHaveText(officer);
  await expect(field).toContainText('Zmiana zacznie obowiązywać po zapisaniu formularza.');
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toHaveText('Zapisano.');
  expect(await dutyOf('calendar_events', id)).toBe(officerId);
  expect(rebuild.count).toBe(0);

  await page.reload();
  await expect(dutyField(page).locator('[data-duty-current]')).toHaveText(officer);
  await dutyField(page).getByRole('button', { name: 'Nie wskazuj' }).click();
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toHaveText('Zapisano.');
  expect(await dutyOf('calendar_events', id)).toBeNull();
  expect(rebuild.count).toBe(0);

  // Zmiana pola publicznego opublikowanego wydarzenia nadal przebudowuje stronę (SPEC-001 AC-29).
  await page.getByLabel('Opis').fill('Nowy opis.');
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: STARTED })).toBeVisible();
  expect(rebuild.count).toBe(1);
});

test('AC-26 AC-29: dyżurny zawodów — konflikt z wydarzeniem o innym dyżurnym, ta sama osoba dozwolona', async ({ page }) => {
  await signIn(page, 'admin');
  await mockRebuild(page);
  const first = unique('Dyżurny Pierwszy');
  const firstId = await addOfficer(first);
  const second = unique('Dyżurny Drugi');
  await addOfficer(second);
  const event = await seedEvent({ starts_on: '2034-02-12', ends_on: '2034-02-14', duty_range_officer_id: firstId });
  const { id } = await seedCompetition({ starts_on: '2034-02-10', ends_on: '2034-02-12' });
  await page.goto(`/panel/zawody/edytuj/?id=${id}`);

  await chooseBySearch(page, second);
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  const conflict = `W dniu 12 lutego 2034 dyżurnego wskazuje już „${event.name}”. Usuń tam dyżurnego albo wskaż tę samą osobę.`;
  await expect(dutyField(page).getByRole('alert')).toHaveText(conflict);
  expect(await dutyOf('competitions', id)).toBeNull();

  await chooseBySearch(page, first);
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toHaveText('Zapisano.');
  await expect(dutyField(page).getByRole('alert')).toBeHidden();
  expect(await dutyOf('competitions', id)).toBe(firstId);
});

test('AC-28: dyżurny ukryty po zapisie — komunikat w formularzu, zapis innych pól działa', async ({ page }) => {
  await signIn(page, 'admin');
  await mockRebuild(page);
  const officer = unique('Dyżurny Ukryty');
  const officerId = await addOfficer(officer);
  const { id } = await seedEvent({ starts_on: '2034-03-10', duty_range_officer_id: officerId });
  await admin().from('range_officers').update({ is_active: false }).eq('id', officerId);
  await page.goto(`/panel/wydarzenia/edytuj/?id=${id}`);

  const field = dutyField(page);
  await expect(field.locator('[data-duty-current]')).toHaveText(officer);
  await expect(field).toContainText('Wskazany dyżurny nie jest już dostępny — wybierz innego.');
  await page.getByLabel('Opis').fill('Opis po ukryciu.');
  await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zapisano.' })).toHaveText('Zapisano.');
  expect(await dutyOf('calendar_events', id)).toBe(officerId);
});
