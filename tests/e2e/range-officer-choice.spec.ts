import { expect, test, type Page } from '@playwright/test';
import { admin, ensureRangeDuty, hasLocalSupabase, signIn, unique } from './support/supabase';

// SPEC-007 US-5 (AC-18…AC-21): wybór Prowadzącego w kroku podpisu wpisu do książki. Dyżurny się nie zmienia —
// testy używają wspólnego dyżurnego `ensureRangeDuty()`. Kolejność listy po stronie bazy: pgTAP
// supabase/tests/029_range_officer_choices_test.sql.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const ADDRESS = 'ul. Stalowa 1, Katowice';

/** Zatwierdzony prowadzący z konta z „Ukryj mnie dla innych”; `withPass` — karnet 5 wejść (osoba wpisywana). */
async function seedAccountOfficer(prefix: string, withPass = false): Promise<{ id: string; fullName: string }> {
  const db = admin();
  const { data, error } = await db.auth.admin.createUser({ email: `${unique('wybor').replace(/\s/g, '-')}@example.test`, email_confirm: true });
  expect(error).toBeNull();
  const id = data.user!.id;
  const fullName = unique(prefix);
  await db.from('profiles').update({ full_name: fullName, address: ADDRESS }).eq('id', id);
  const { error: officerError } = await db
    .from('range_officers')
    .insert({ full_name: fullName, profile_id: id, license_number: '1', institution: 'PZSS', hide_from_others: true, status: 'approved' });
  expect(officerError).toBeNull();
  if (withPass) {
    const passName = unique('Karnet wybór');
    const { data: product } = await db.from('products').insert({ kind: 'entries', name: passName, price: 1000, entries: 5 }).select('id').single();
    const { data: order } = await db
      .from('orders')
      .insert({ user_id: id, product_id: product!.id, item_name: passName, amount: 1000, payment_method: 'on_site', on_site_method: 'cash' })
      .select('id')
      .single();
    expect((await db.rpc('fulfil_order', { p_order_id: order!.id })).error).toBeNull();
  }
  return { id, fullName };
}

async function drawSignature(page: Page): Promise<void> {
  const pad = page.getByRole('img', { name: /Pole podpisu/ });
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 20, box.y + box.height - 40, { steps: 30 });
  await page.mouse.up();
}

async function dutyOfficerId(): Promise<string> {
  const db = admin();
  const { data: day } = await db.rpc('range_today');
  const { data } = await db.from('range_duty').select('range_officer_id').eq('day', day as string).eq('source', 'book').single();
  return data!.range_officer_id as string;
}

const sign = (page: Page) => page.locator('[data-sign]');
const entryOfficer = (page: Page) => sign(page).locator('[data-sign-field="officer"]');
const save = (page: Page) => page.getByRole('button', { name: 'Zapisz wpis' });

test.beforeEach(async ({ page }) => {
  await signIn(page, 'staff');
});

test('AC-18, AC-20, AC-21: osoba wpisywana pierwsza na liście; wybór zapisuje się we wpisie, dyżurny bez zmian', async ({ page }) => {
  const duty = await ensureRangeDuty();
  const dutyId = await dutyOfficerId();
  const person = await seedAccountOfficer('Ola Prowadząca', true);
  const other = await seedAccountOfficer('Ukryty Inny');

  await page.goto(`/panel/ksiazka/?osoba=${person.id}`);
  await expect(page.getByRole('main').locator('p.shift-officer', { hasText: 'Prowadzący strzelanie:' })).toContainText(duty);
  await page.getByRole('button', { name: 'Dalej' }).click();

  // AC-18, AC-21: nad danymi wpisu „Prowadzący: <dyżurny>” — osoba wpisywana nie jest wybierana automatycznie.
  await expect(sign(page).getByText('Prowadzący:')).toBeVisible();
  await expect(entryOfficer(page)).toHaveText(duty);
  await sign(page).getByRole('button', { name: /^Zmień/ }).click();
  const list = sign(page).locator('[data-officers] button');
  await expect(list.first()).toHaveText(`${person.fullName} (osoba wpisywana)`);
  await expect(sign(page).getByRole('button', { name: duty, exact: true })).toBeVisible();
  await expect(sign(page).getByRole('button', { name: other.fullName, exact: true })).toHaveCount(0);

  // AC-20: wybór innego niż dyżurny — wpis ma wybranego (kopia nazwiska), dyżurny bez zmian.
  await list.first().click();
  await expect(entryOfficer(page)).toHaveText(person.fullName);
  await drawSignature(page);
  await save(page).click();
  await expect(page.getByText(new RegExp(`^Wpisano do książki: ${person.fullName}, `))).toBeVisible();
  const { data: entry } = await admin().from('range_log').select('range_officer_name').eq('profile_id', person.id).single();
  expect(entry!.range_officer_name).toBe(person.fullName);
  expect(await dutyOfficerId()).toBe(dutyId);
  await expect(page.getByRole('main').locator('p.shift-officer', { hasText: 'Prowadzący strzelanie:' })).toContainText(duty);

  // AC-20, AC-18: kolejny wpis (osoba towarzysząca bez konta) znów domyślnie z dyżurnym; bez osoby wpisywanej na liście.
  await page.getByRole('button', { name: 'Dodaj osobę towarzyszącą' }).click();
  await page.getByRole('button', { name: 'Osoba bez konta' }).click();
  const guest = page.locator('[data-guest]');
  await guest.getByLabel('Imię i nazwisko *').fill(unique('Ewa Towarzysząca'));
  await guest.getByLabel('Adres zamieszkania').fill(ADDRESS);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(entryOfficer(page)).toHaveText(duty);
  await sign(page).getByRole('button', { name: /^Zmień/ }).click();
  await expect(sign(page).getByRole('button', { name: duty, exact: true })).toBeVisible();
  await expect(sign(page).getByRole('button', { name: /\(osoba wpisywana\)$/ })).toHaveCount(0);
  await expect(sign(page).getByRole('button', { name: person.fullName, exact: true })).toHaveCount(0);
  await sign(page).getByRole('button', { name: 'Anuluj', exact: true }).click();
  await expect(entryOfficer(page)).toHaveText(duty);
});

test('AC-19, AC-20: wyszukanie ukrytego prowadzącego; prowadzący niedostępny przy zapisie — komunikat, podpis zostaje', async ({ page }) => {
  const duty = await ensureRangeDuty();
  const person = await seedAccountOfficer('Piotr Wpisywany', true);
  const hidden = await seedAccountOfficer('Szukany Ukryty');

  await page.goto(`/panel/ksiazka/?osoba=${person.id}`);
  await expect(page.getByRole('main').locator('p.shift-officer', { hasText: 'Prowadzący strzelanie:' })).toContainText(duty);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await sign(page).getByRole('button', { name: /^Zmień/ }).click();

  // AC-19: ukrytego dla innych nie ma na liście, ale wyszukiwarka go znajduje.
  await expect(sign(page).getByRole('button', { name: hidden.fullName, exact: true })).toHaveCount(0);
  const search = sign(page).getByLabel('Szukaj prowadzącego');
  await search.fill('zzzz-brak');
  await search.press('Enter');
  await expect(sign(page).getByRole('status').filter({ hasText: 'Nie znaleziono prowadzącego.' })).toBeVisible();
  await search.fill(hidden.fullName);
  await sign(page).getByRole('button', { name: 'Szukaj', exact: true }).click();
  await sign(page).getByRole('button', { name: hidden.fullName, exact: true }).click();
  await expect(entryOfficer(page)).toHaveText(hidden.fullName);
  await drawSignature(page);

  // §7: wybrany prowadzący w międzyczasie ukryty — zapis odrzucony, komunikat, lista wyboru; podpis zostaje.
  await admin().from('range_officers').update({ hide_from_others: true, is_active: false }).eq('profile_id', hidden.id);
  await save(page).click();
  await expect(sign(page).getByText('Ten prowadzący nie jest już dostępny — wybierz innego.')).toBeVisible();
  await expect(entryOfficer(page)).toHaveText(duty);
  await expect(sign(page).getByLabel('Szukaj prowadzącego')).toBeVisible();
  await expect(save(page)).toBeEnabled();
  expect((await admin().from('range_log').select('id').eq('profile_id', person.id)).data).toHaveLength(0);

  // Wybór dyżurnego z listy i ponowny zapis tym samym podpisem.
  await sign(page).getByRole('button', { name: duty, exact: true }).click();
  await save(page).click();
  await expect(page.getByText(new RegExp(`^Wpisano do książki: ${person.fullName}, `))).toBeVisible();
  const { data: entry } = await admin().from('range_log').select('range_officer_name').eq('profile_id', person.id).single();
  expect(entry!.range_officer_name).toBe(duty);
});
