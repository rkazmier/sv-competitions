import { expect, test, type Browser, type Page } from '@playwright/test';
import { admin, ensureUser, hasLocalSupabase, signIn, signInAs, unique } from './support/supabase';

// SPEC-007 US-2: zatwierdzanie zgłoszeń prowadzących z kont w /panel/prowadzacy/ (AC-7…AC-10).
// Strona bazy (`review_range_officer`, `audit_log`, uprawnienia) — pgTAP: supabase/tests/027_range_officer_account_test.sql.
test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (supabase start + zmienne środowiskowe)');

const PASSWORD = 'haslo-e2e-123';

interface Submission {
  name: string;
  email: string;
  profileId: string;
  officerId: string;
}

/** Konto z imieniem i nazwiskiem i zgłoszeniem `pending` (jak po „Wyślij do zatwierdzenia”, AC-4). */
async function submission(hidden = true): Promise<Submission> {
  const name = unique('Zgłoszony');
  const email = `zgloszenie-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@example.test`;
  const db = admin();
  const { data: user, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { privacy_notice_ack: true },
  });
  if (error) throw error;
  const profileId = user.user.id;
  await db.from('profiles').update({ full_name: name }).eq('id', profileId);
  const { data, error: insertError } = await db
    .from('range_officers')
    .insert({
      profile_id: profileId,
      full_name: name,
      license_number: '55/2026',
      institution: 'LOK',
      status: 'pending',
      hide_from_others: hidden,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insertError || !data) throw insertError ?? new Error('Brak zgłoszenia');
  return { name, email, profileId, officerId: data.id as string };
}

async function officer(id: string) {
  const { data } = await admin()
    .from('range_officers')
    .select('status, reviewed_by, reviewed_at')
    .eq('id', id)
    .single();
  return data;
}

async function auditFor(profileId: string) {
  const { data } = await admin()
    .from('audit_log')
    .select('action, changes, actor_id')
    .eq('target_user_id', profileId)
    .eq('action', 'range_officer_review');
  return data ?? [];
}

async function userId(email: string): Promise<string> {
  const { data: users } = await admin().auth.admin.listUsers({ perPage: 1000 });
  return users.users.find((user) => user.email === email)?.id ?? '';
}

const review = (page: Page) => page.getByRole('region', { name: /^Do zatwierdzenia \(\d+\)$/ });
const reviewItem = (page: Page, name: string) =>
  review(page).getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
const listItem = (page: Page, name: string) =>
  page.locator('[data-list] [data-item]').filter({ has: page.getByText(name, { exact: true }) });

/** „Twoje dane” zgłaszającego w osobnej karcie (AC-8, AC-9). */
async function accountStatus(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAs(page, email, PASSWORD);
  await page.goto('/konto/');
  return page;
}

test.describe('admin', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin');
  });

  test('AC-7: „Do zatwierdzenia (n)” ze zgłoszeniem i „Prowadzący (n)” w menu', async ({ page }) => {
    const sub = await submission();
    await page.goto('/panel/prowadzacy/');
    const item = reviewItem(page, sub.name);
    await expect(item).toContainText('Nr legitymacji: 55/2026 · LOK · zgłoszono');
    // Nazwa dostępna przycisku zawiera imię i nazwisko (kilka zgłoszeń na liście).
    await expect(item.getByRole('button', { name: /^Zatwierdź.*Zgłoszony/ })).toBeVisible();
    await expect(item.getByRole('button', { name: /^Odrzuć.*Zgłoszony/ })).toContainText(sub.name);

    const menu = page.getByRole('navigation', { name: 'Menu panelu' });
    await expect(menu.getByRole('link', { name: /^Prowadzący, do zatwierdzenia: \d+$/ })).toHaveAttribute(
      'href',
      '/panel/prowadzacy/',
    );
  });

  test('AC-8, AC-10: „Zatwierdź” → approved, reviewed_by, audit_log; użytkownik widzi „zatwierdzone”', async ({
    page,
    browser,
  }) => {
    const sub = await submission();
    await page.goto('/panel/prowadzacy/');
    await reviewItem(page, sub.name).getByRole('button', { name: /^Zatwierdź/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zatwierdzono.' })).toBeVisible();
    await expect(reviewItem(page, sub.name)).toHaveCount(0);

    const row = await officer(sub.officerId);
    expect(row?.status).toBe('approved');
    expect(row?.reviewed_by).toBe(await userId(await ensureUser('admin')));
    expect(row?.reviewed_at).not.toBeNull();
    const audit = await auditFor(sub.profileId);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.changes).toMatchObject({ range_officer_id: sub.officerId, decision: 'approved' });

    // AC-10: na liście „Z konta”, „Ukryty dla innych”; admin bez „Edytuj”, z „Ukryj”.
    const item = listItem(page, sub.name);
    await expect(item).toContainText('Z konta');
    await expect(item).toContainText('Ukryty dla innych');
    await expect(item.getByRole('button', { name: /^Edytuj/ })).toHaveCount(0);
    await expect(item.getByRole('button', { name: /^Ukryj/ })).toBeVisible();

    const account = await accountStatus(browser, sub.email);
    await expect(account.getByText('Uprawnienia prowadzącego: zatwierdzone')).toBeVisible();
    await account.context().close();
  });

  test('AC-9: „Odrzuć” po potwierdzeniu → rejected, audit_log; użytkownik widzi „odrzucone…”', async ({
    page,
    browser,
  }) => {
    const sub = await submission(false);
    await page.goto('/panel/prowadzacy/');
    let question = '';
    page.once('dialog', (dialog) => {
      question = dialog.message();
      void dialog.dismiss();
    });
    await reviewItem(page, sub.name).getByRole('button', { name: /^Odrzuć/ }).click();
    expect(question).toBe(`Odrzucić zgłoszenie ${sub.name}?`);
    expect((await officer(sub.officerId))?.status).toBe('pending');

    page.once('dialog', (dialog) => void dialog.accept());
    await reviewItem(page, sub.name).getByRole('button', { name: /^Odrzuć/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Odrzucono.' })).toBeVisible();
    expect((await officer(sub.officerId))?.status).toBe('rejected');
    expect((await auditFor(sub.profileId))[0]?.changes).toMatchObject({ decision: 'rejected' });
    await expect(listItem(page, sub.name)).toContainText('Odrzucony');
    await expect(listItem(page, sub.name)).not.toContainText('Ukryty dla innych');

    const account = await accountStatus(browser, sub.email);
    await expect(
      account.getByText(
        'Uprawnienia prowadzącego: odrzucone. Popraw dane i wyślij ponownie albo skontaktuj się z obsługą strzelnicy.',
      ),
    ).toBeVisible();
    await expect(account.getByRole('button', { name: 'Edytuj', exact: true })).toBeVisible();
    await account.context().close();
  });
});

test.describe('obsługa', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'staff');
  });

  test('AC-10, AC-7, AC-8: Obsługa zatwierdza; lista tylko do odczytu; „Prowadzący (n)” w menu obsługi', async ({
    page,
  }) => {
    const sub = await submission();
    await page.goto('/panel/prowadzacy/');
    await expect(page.getByText('Listę prowadzących zmienia admin.', { exact: false })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Dodaj prowadzącego' })).toBeHidden();
    const menu = page.getByRole('navigation', { name: 'Menu panelu' });
    await expect(menu.getByRole('link', { name: /^Prowadzący, do zatwierdzenia: \d+$/ })).toBeVisible();

    await reviewItem(page, sub.name).getByRole('button', { name: /^Zatwierdź/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Zatwierdzono.' })).toBeVisible();
    expect((await officer(sub.officerId))?.status).toBe('approved');
    const item = listItem(page, sub.name);
    await expect(item).toContainText('Z konta');
    await expect(item.getByRole('button')).toHaveCount(0);
  });

  test('AC-7: telefon (320 px) — sekcja „Do zatwierdzenia” bez poziomego przewijania', async ({ page }) => {
    await submission();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/panel/prowadzacy/');
    await expect(review(page)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
