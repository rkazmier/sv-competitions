import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { PAGE_SIZE, buildRangeLogPdf } from './range-pdf';
import type { ReviewEntry } from './range-review';

const font = (name: string) => readFileSync(fileURLToPath(new URL(`../../public/fonts/${name}`, import.meta.url)));
const fonts = { regular: font('inter-400.otf'), bold: font('inter-600.otf') };
// PNG 1×1, białe tło — jak podpis z ekranu (AC-15).
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='),
  (char) => char.charCodeAt(0),
);

function entry(n: number): ReviewEntry {
  return {
    id: `e${n}`,
    entered_at: '2026-03-10T09:00:00Z',
    full_name: `Zażółć Gęślą Jaźń ${n}`,
    permit_number: null,
    permit_authority: null,
    address: 'ul. Łódzka 1, Świętochłowice',
    range_officer_name: 'Piotr Prowadzący',
    signature_path: `2026/03/e${n}.png`,
    annotations: n % 2 ? [{ body: 'Cofnięto zużycie karnetu', created_at: '2026-03-10T10:00:00Z', author: null }] : [],
  };
}

const filters = { from: '2026-03-10', to: '2026-03-12' };

describe('PDF książki (SPEC-005 AC-27)', () => {
  it('AC-27: A4 poziomo, tytuł z zakresem dat, podpis każdego wpisu, kolejne strony', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(i + 1));
    const signatures = new Map(entries.map((e) => [e.signature_path, PNG]));
    const bytes = await buildRangeLogPdf({ entries, filters, fonts, text: t, signatures });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe('Książka rejestru pobytu na strzelnicy Steel Valley 10.03.2026 – 12.03.2026');
    expect(doc.getPageCount()).toBeGreaterThan(1);
    for (const page of doc.getPages()) expect([page.getWidth(), page.getHeight()]).toEqual(PAGE_SIZE);
  });

  it('AC-27: pusty zakres — jedna strona; brak podpisu przerywa eksport', async () => {
    const empty = await PDFDocument.load(await buildRangeLogPdf({ entries: [], filters, fonts, text: t, signatures: new Map() }));
    expect(empty.getPageCount()).toBe(1);
    await expect(
      buildRangeLogPdf({ entries: [entry(1)], filters, fonts, text: t, signatures: new Map() }),
    ).rejects.toThrow('signature_missing');
  });
});
