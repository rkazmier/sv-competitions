import { expect, test } from '@playwright/test';

// SPEC-011: polityka prywatności na /polityka-prywatnosci/. Strona statyczna — bez Supabase.
test.describe('polityka prywatności', () => {
  test('AC-1, AC-3: bez logowania — h1, „Obowiązuje od”, punkty 1–11 w kolejności, bez noindex', async ({ page }) => {
    await page.goto('/polityka-prywatnosci/');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText('Polityka prywatności');
    await expect(main.getByText(/^Obowiązuje od: \d{1,2} \p{L}+ \d{4}$/u)).toBeVisible();
    const headings = await main.getByRole('heading', { level: 2 }).allTextContents();
    expect(headings.map((h) => h.trim().split('.')[0])).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });

  test('AC-2: polityki Tpay, Google, GitHub w nowej karcie, e-mail jako mailto:', async ({ page }) => {
    await page.goto('/polityka-prywatnosci/');
    const main = page.getByRole('main');
    for (const name of ['Polityka prywatności Tpay', 'Polityka prywatności Google', 'Polityka prywatności GitHub']) {
      const link = main.getByRole('link', { name });
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveAttribute('href', /^https:\/\//);
    }
    await expect(main.getByRole('link', { name: 'rkazmierowski@gmail.com' })).toHaveAttribute(
      'href',
      'mailto:rkazmierowski@gmail.com',
    );
  });

  for (const path of ['/', '/oferta/', '/rejestracja/', '/regulamin-sprzedazy/']) {
    test(`AC-5: stopka na ${path} ma link do polityki prywatności`, async ({ page }) => {
      await page.goto(path);
      await page.getByRole('contentinfo').getByRole('link', { name: 'Polityka prywatności' }).click();
      await expect(page).toHaveURL(/\/polityka-prywatnosci\/$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Polityka prywatności');
    });
  }

  test('AC-6: stopka na 360 px — linki zawijają się, bez poziomego przewijania, obszar dotyku ≥ 44 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/polityka-prywatnosci/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const link of await page.getByRole('contentinfo').getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('AC-7: w oknie klauzuli na /rejestracji/ link do polityki otwiera nową kartę, formularz zostaje', async ({ page, context }) => {
    await page.goto('/rejestracja/');
    await page.getByLabel('E-mail').fill('ktos@example.com');
    await page.getByRole('link', { name: 'Informacja o przetwarzaniu danych' }).click();
    const dialog = page.getByRole('dialog', { name: 'Informacja o przetwarzaniu danych osobowych' });
    await expect(dialog).toContainText('hosting stron serwisu (GitHub');
    const link = dialog.getByRole('link', { name: 'Polityka prywatności' });
    await expect(link).toHaveAttribute('target', '_blank');
    const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
    await expect(popup).toHaveURL(/\/polityka-prywatnosci\/$/);
    await expect(page).toHaveURL(/\/rejestracja\//);
    await expect(page.getByLabel('E-mail')).toHaveValue('ktos@example.com');
  });
});
