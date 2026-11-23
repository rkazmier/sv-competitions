import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { salesTermsEffectiveFrom, salesTermsPdfPath } from './sales-terms';
import { buildSalesTermsPdf } from './sales-terms-pdf';

// PDF wersji regulaminu (#154, SPEC-012 AC-4, AC-10). `npm run pdf:sales-terms` zapisuje plik w public/,
// zwykłe uruchomienie testów sprawdza, że plik w repo powstał z bieżącej treści `salesTerms.body`.
const UPDATE = process.env.UPDATE_SALES_TERMS_PDF === '1';
const publicDir = (path: string) => fileURLToPath(new URL(`../../public${path}`, import.meta.url));

async function build(): Promise<Uint8Array> {
  return buildSalesTermsPdf({
    body: t('salesTerms.body'),
    heading: (date) => t('salesTerms.pdfHeading', { date }),
    pageLabel: (page, pages) => t('salesTerms.pdfPage', { page, pages }),
    fonts: {
      regular: readFileSync(publicDir('/fonts/inter-400.otf')),
      bold: readFileSync(publicDir('/fonts/inter-600.otf')),
    },
  });
}

describe('PDF regulaminu sprzedaży (#154)', () => {
  const { iso } = salesTermsEffectiveFrom(t('salesTerms.body'));
  const file = publicDir(salesTermsPdfPath(iso));

  it('A4, nagłówek z datą obowiązywania, kilka stron, wynik powtarzalny', async () => {
    const bytes = await build();
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe('Regulamin sprzedaży — obowiązuje od 1 stycznia 2027 r.');
    expect(doc.getPageCount()).toBeGreaterThan(2);
    for (const page of doc.getPages()) {
      expect(Math.round(page.getWidth())).toBe(595);
      expect(Math.round(page.getHeight())).toBe(842);
    }
    expect(Buffer.from(await build()).equals(Buffer.from(bytes))).toBe(true);
    if (UPDATE) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, bytes);
    }
  });

  it('plik w public/ odpowiada bieżącej treści (gdy różni się — npm run pdf:sales-terms)', async () => {
    expect(existsSync(file)).toBe(true);
    expect(Buffer.from(readFileSync(file)).equals(Buffer.from(await build()))).toBe(true);
  });
});
