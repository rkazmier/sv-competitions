import { describe, expect, it } from 'vitest';
import { excerpt, safeExternalUrl, toParagraphs } from './text';

describe('opis jako zwykły tekst', () => {
  it('AC-38: puste linie rozdzielają akapity, pojedyncze złamania zostają w akapicie', () => {
    expect(toParagraphs('Pierwszy\ndruga linia\n\n\nDrugi\r\n  \r\nTrzeci  ')).toEqual([
      'Pierwszy\ndruga linia',
      'Drugi',
      'Trzeci',
    ]);
  });

  it('AC-38: brak opisu — brak akapitów', () => {
    expect(toParagraphs(null)).toEqual([]);
    expect(toParagraphs('  \n\n ')).toEqual([]);
  });

  it('AC-38: HTML zostaje tekstem (escapuje go szablon, nie usuwamy treści)', () => {
    expect(toParagraphs('<b>Uwaga</b>')).toEqual(['<b>Uwaga</b>']);
  });
});

describe('meta description', () => {
  it('AC-41: krótki opis bez zmian, w jednej linii', () => {
    expect(excerpt('Puchar\n\nSteel Valley')).toBe('Puchar Steel Valley');
  });

  it('AC-41: długi opis przycięty na granicy słowa do maks. 160 znaków', () => {
    const text = `${'słowo '.repeat(40)}koniec`;
    const result = excerpt(text);
    expect([...result].length).toBeLessThanOrEqual(160);
    expect(result.endsWith('słowo…')).toBe(true);
  });

  it('AC-41: brak opisu — pusty tekst', () => {
    expect(excerpt(null)).toBe('');
  });
});

describe('link zewnętrzny', () => {
  it('§7: tylko http(s), inne schematy odrzucone', () => {
    expect(safeExternalUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});
