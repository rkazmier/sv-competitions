import { expect, test } from '@playwright/test';
import { hasLocalSupabase } from './support/supabase';

// #154: regulamin sprzedaży na /regulamin-sprzedazy/ (SPEC-003 decyzja 12-A). Strona statyczna — treść bez Supabase;
// lista wersji (SPEC-012 AC-4) pobierana w przeglądarce.
test.describe('regulamin sprzedaży', () => {
  test('#154: tytuł, data obowiązywania, § 13 i załącznik', async ({ page }) => {
    await page.goto('/regulamin-sprzedazy/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Regulamin sprzedaży');
    await expect(main.getByText('Obowiązuje od: 1 stycznia 2027 r.')).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: '§ 13. Postanowienia końcowe' })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2 }).filter({ hasNotText: 'Wersje regulaminu' })).toHaveCount(14);
    await expect(
      main.getByRole('heading', { level: 2, name: 'Załącznik nr 1 — Wzór formularza odstąpienia od umowy' }),
    ).toBeVisible();
    await expect(main.getByText('Regulamin obowiązuje od 1 stycznia 2027 r.')).toBeVisible();
    await expect(main.getByText(/zostanie tu opublikowana wkrótce/)).toHaveCount(0);
  });

  test('SPEC-012 AC-4: „Wersje regulaminu” pod treścią — „Obowiązuje od 1.01.2027 — PDF”', async ({ page }) => {
    test.skip(!hasLocalSupabase && !process.env.CI, 'Brak lokalnego Supabase (wersje z `sales_terms_versions`)');
    await page.goto('/regulamin-sprzedazy/');
    const versions = page.getByRole('region', { name: 'Wersje regulaminu' });
    await expect(versions.getByRole('listitem').first()).toHaveText('Obowiązuje od 1.01.2027 — PDF');
    await expect(versions.getByRole('link', { name: 'Regulamin sprzedaży obowiązujący od 1.01.2027 (PDF)' })).toHaveAttribute(
      'href',
      '/regulamin-sprzedazy/regulamin-sprzedazy-2027-01-01.pdf',
    );
  });

  test('AC-10 (SPEC-011): w § 12 ust. 1 „Polityka prywatności” prowadzi do strony polityki', async ({ page }) => {
    await page.goto('/regulamin-sprzedazy/');
    const main = page.getByRole('main');
    const item = main.getByRole('heading', { level: 2, name: '§ 12. Dane osobowe' }).locator('xpath=following-sibling::ol[1]/li[1]');
    await expect(item).toContainText(
      'Szczegółowe zasady przetwarzania danych opisuje Polityka prywatności dostępna pod adresem events.steel-valley.pl/polityka-prywatnosci/.',
    );
    const link = item.getByRole('link', { name: 'Polityka prywatności' });
    await expect(link).toHaveAttribute('href', '/polityka-prywatnosci/');
    await expect(link).not.toHaveAttribute('target', /.+/);
    await link.click();
    await expect(page).toHaveURL(/\/polityka-prywatnosci\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Polityka prywatności');
  });

  test('#154: na telefonie (320 px) bez poziomego przewijania', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/regulamin-sprzedazy/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('#154: PDF wersji 2027-01-01 jest dostępny', async ({ request }) => {
    const response = await request.get('/regulamin-sprzedazy/regulamin-sprzedazy-2027-01-01.pdf');
    expect(response.status()).toBe(200);
    expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
