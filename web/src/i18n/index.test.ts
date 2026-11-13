import { describe, expect, it } from 'vitest';
import { t, type MessageKey } from './index';

describe('t()', () => {
  it('AC-3: zwraca tekst z pliku i18n pl', () => {
    expect(t('nav.calendar')).toBe('Kalendarz');
    expect(t('site.name')).toBe('Steel Valley Competitions');
  });

  it('podstawia parametry', () => {
    expect(t('footer.copyright', { year: 2027 })).toBe('© 2027 Steel Valley');
  });

  it('zgłasza błąd dla nieistniejącego klucza', () => {
    expect(() => t('nav.missing' as MessageKey)).toThrow('Brak tekstu i18n: nav.missing');
  });
});
