import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  linkPrivacyPolicy,
  parseSpans,
  PRIVACY_POLICY_PATH,
  salesTermsBlocks,
  salesTermsEffectiveFrom,
  salesTermsPdfPath,
  spansText,
  type LinkedSpan,
} from './sales-terms';

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

  it('AC-10 (SPEC-011): w § 12 ust. 1 „Polityka prywatności” jest linkiem, reszta treści bez zmian', () => {
    const linked = linkPrivacyPolicy(blocks);
    const index = blocks.findIndex((b) => b.kind === 'h2' && spansText(b.spans).startsWith('§ 12.'));
    const before = blocks[index + 1];
    const after = linked[index + 1];
    if (before.kind !== 'ol' || after.kind !== 'ol') throw new Error('lista');
    const links = linked
      .flatMap((b): LinkedSpan[] => ('items' in b ? b.items.flatMap((i) => i.spans) : b.spans))
      .filter((s) => s.href !== undefined);
    expect(links).toEqual([
      { text: 'Polityka prywatności', bold: false, italic: false, href: PRIVACY_POLICY_PATH },
    ]);
    expect(PRIVACY_POLICY_PATH).toBe('/polityka-prywatnosci/');
    expect(spansText(after.items[0].spans)).toBe(spansText(before.items[0].spans));
    expect(linked.filter((_, i) => i !== index + 1)).toEqual(blocks.filter((_, i) => i !== index + 1));
    expect(after.items.slice(1)).toEqual(before.items.slice(1));
  });

  it('AC-10 (SPEC-011): bez słów „polityka prywatności” w § 12 ust. 1 — błąd zamiast cichego braku linku', () => {
    expect(() => linkPrivacyPolicy(salesTermsBlocks('## § 12. Dane osobowe\n\n1. Inny tekst.'))).toThrow();
    expect(() => linkPrivacyPolicy(salesTermsBlocks('## § 11. X\n\n1. Polityka prywatności.'))).toThrow();
    const odmiana = linkPrivacyPolicy(salesTermsBlocks('## § 12. D\n\n1. Zob. **politykę prywatności** tutaj.'));
    if (odmiana[1].kind !== 'ol') throw new Error('lista');
    expect(odmiana[1].items[0].spans).toEqual([
      { text: 'Zob. ', bold: false, italic: false },
      { text: 'politykę prywatności', bold: true, italic: false, href: PRIVACY_POLICY_PATH },
      { text: ' tutaj.', bold: false, italic: false },
    ]);
  });

  it('obowiązuje od 1 stycznia 2027 r. i nie zawiera tekstu zastępczego', () => {
    expect(salesTermsEffectiveFrom(t('salesTerms.body')).iso).toBe('2027-01-01');
    expect(t('salesTerms.body')).not.toMatch(/wkrótce|DO UZUPEŁNIENIA|karnet czasow/i);
  });

  it('AC-2 (SPEC-012): § 5 ust. 1 pkt 5 nazywa przycisk „Zamawiam i płacę”, jak widzi go klient — bez „Zapłać”', () => {
    const index = blocks.findIndex((b) => b.kind === 'h2' && spansText(b.spans).startsWith('§ 5.'));
    const list = blocks[index + 1];
    if (list.kind !== 'ol') throw new Error('lista');
    const steps = list.items[0].children.map((i) => spansText(i.spans));
    expect(steps[4]).toMatch(/^klika przycisk „Zamawiam i płacę” z podaną kwotą/);
    const section = blocks.slice(index, blocks.findIndex((b, i) => i > index && b.kind === 'h2'));
    const text = section
      .flatMap((b) => ('items' in b ? b.items.flatMap((i) => [i, ...i.children]) : [b]))
      .map((b) => spansText(b.spans))
      .join('\n');
    expect(text).toContain('Zamawiam i płacę');
    expect(text).not.toContain('Zapłać');
    expect(t('offer.pay', { amount: '' }).trim()).toBe('Zamawiam i płacę');
  });
});
