import { expect, test } from '@playwright/test';

// SPEC-001 US-1: układ strony publicznej na telefonie i desktopie.
const WIDTHS = [320, 375, 1280, 1920];

for (const width of WIDTHS) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('AC-1: nagłówek, main i stopka, paleta stali, brak poziomego przewijania', async ({ page }) => {
      await page.goto('/');

      const header = page.getByRole('banner');
      await expect(header.getByRole('link', { name: 'Steel Valley Competitions' })).toBeVisible();
      await expect(header.getByRole('link', { name: 'Kalendarz' })).toHaveAttribute('href', '/');
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText('Kalendarz strzelnicy');
      await expect(page.getByRole('contentinfo').getByRole('link')).toHaveAttribute('href', 'https://steel-valley.pl');

      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        footerBg: getComputedStyle(document.querySelector('footer')!).backgroundColor,
        font: getComputedStyle(document.body).fontFamily,
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.bodyBg).toBe('rgb(243, 245, 247)'); // --color-bg #f3f5f7
      expect(layout.footerBg).toBe('rgb(37, 45, 52)'); // --color-dark #252d34
      expect(layout.font).toMatch(/^"?Inter"?,/);
    });

    test('AC-2: elementy dotykowe ≥ 44 × 44 px', async ({ page }) => {
      await page.goto('/');
      for (const link of await page.locator('header a, footer a').all()) {
        const box = await link.boundingBox();
        expect(box, await link.textContent() ?? '').not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }
    });
  });
}

test('AC-2: widoczny focus i link „Przejdź do treści”', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Przejdź do treści' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveText('Steel Valley Competitions');
  const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe('none');
});

test('AC-2: fonty lokalne, brak zasobów z zewnętrznych domen', async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/', { waitUntil: 'networkidle' });

  const origin = new URL(baseURL!).origin;
  expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
  expect(requests.some((url) => url.endsWith('/fonts/inter-400.woff2'))).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('16px Inter'))).toBe(true);
});
