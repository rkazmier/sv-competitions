import { expect, test } from '@playwright/test';

// #154: regulamin sprzedaży na /regulamin-sprzedazy/ (SPEC-003 decyzja 12-A). Strona statyczna — bez Supabase.
test.describe('regulamin sprzedaży', () => {
  test('#154: tytuł, data obowiązywania, § 13 i załącznik', async ({ page }) => {
    await page.goto('/regulamin-sprzedazy/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Regulamin sprzedaży');
    await expect(main.getByText('Obowiązuje od: 1 stycznia 2027 r.')).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: '§ 13. Postanowienia końcowe' })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2 })).toHaveCount(14);
    await expect(
      main.getByRole('heading', { level: 2, name: 'Załącznik nr 1 — Wzór formularza odstąpienia od umowy' }),
    ).toBeVisible();
    await expect(main.getByText('Regulamin obowiązuje od 1 stycznia 2027 r.')).toBeVisible();
    await expect(main.getByText(/zostanie tu opublikowana wkrótce/)).toHaveCount(0);
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
