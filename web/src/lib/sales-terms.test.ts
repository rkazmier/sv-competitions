import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { parseSpans, salesTermsBlocks, salesTermsEffectiveFrom, salesTermsPdfPath, spansText } from './sales-terms';

describe('regulamin sprzedaży — format treści (#154)', () => {
  it('rozpoznaje pogrubienie, kursywę i dosłowną gwiazdkę', () => {
    expect(parseSpans('**Klient** — osoba')).toEqual([
      { text: 'Klient', bold: true, italic: false },
      { text: ' — osoba', bold: false, italic: false },
    ]);
    expect(parseSpans('*(uwaga)*')).toEqual([{ text: '(uwaga)', bold: false, italic: true }]);
    expect(parseSpans(String.raw`Ja/My (\*) niniejszym (\*)`)).toEqual([
      { text: 'Ja/My (*) niniejszym (*)', bold: false, italic: false },
    ]);
  });

  it('dzieli treść na nagłówki, listy z podpunktami i akapity', () => {
    const blocks = salesTermsBlocks('# T\n\n## § 1. A\n\n1. a\n   1. x\n   2. y\n2. b\n\nTekst\n\n- p\n- q\n');
    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'h2', 'ol', 'p', 'ul']);
    const list = blocks[2];
    if (list.kind !== 'ol') throw new Error('lista');
    expect(list.items.map((i) => spansText(i.spans))).toEqual(['a', 'b']);
    expect(list.items[0].children.map((i) => spansText(i.spans))).toEqual(['x', 'y']);
  });

  it('czyta datę obowiązywania z treści i podaje ścieżkę PDF wersji', () => {
    expect(salesTermsEffectiveFrom('6. Regulamin obowiązuje od 1 stycznia 2027 r.')).toEqual({
      label: '1 stycznia 2027 r.',
      iso: '2027-01-01',
    });
    expect(() => salesTermsEffectiveFrom('bez daty')).toThrow();
    expect(salesTermsPdfPath('2027-01-01')).toBe('/regulamin-sprzedazy/regulamin-sprzedazy-2027-01-01.pdf');
  });
});

describe('regulamin sprzedaży — treść od właściciela (#154)', () => {
  const blocks = salesTermsBlocks(t('salesTerms.body'));

  it('ma tytuł, § 1–13 i Załącznik nr 1, z pełną liczbą ustępów', () => {
    expect(blocks[0]).toEqual({ kind: 'h1', spans: [{ text: 'Regulamin sprzedaży', bold: false, italic: false }] });
    const headings = blocks.flatMap((b) => (b.kind === 'h2' ? [spansText(b.spans)] : []));
    expect(headings).toHaveLength(14);
    expect(headings.slice(0, 13).map((h) => h.split('.')[0])).toEqual(
      Array.from({ length: 13 }, (_, i) => `§ ${i + 1}`),
    );
    expect(headings[12]).toBe('§ 13. Postanowienia końcowe');
    expect(headings[13]).toBe('Załącznik nr 1 — Wzór formularza odstąpienia od umowy');
    const counts = blocks.flatMap((b) => (b.kind === 'ol' ? [b.items.length] : []));
    expect(counts).toEqual([6, 10, 5, 10, 7, 5, 5, 7, 4, 4, 3, 3, 6]);
  });

  it('obowiązuje od 1 stycznia 2027 r. i nie zawiera tekstu zastępczego', () => {
    expect(salesTermsEffectiveFrom(t('salesTerms.body')).iso).toBe('2027-01-01');
    expect(t('salesTerms.body')).not.toMatch(/wkrótce|DO UZUPEŁNIENIA|karnet czasow/i);
  });
});
