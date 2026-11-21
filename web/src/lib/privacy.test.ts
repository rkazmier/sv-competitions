import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { privacyParagraphs } from './privacy';

describe('klauzula informacyjna RODO (#39)', () => {
  it('dzieli tekst na akapity po pustej linii', () => {
    expect(privacyParagraphs(' A \n\nB\n \nC\n')).toEqual(['A', 'B', 'C']);
  });

  it('zawiera administratora, cele, okresy przechowywania, prawa i UODO', () => {
    const paragraphs = privacyParagraphs(t('privacy.body'));
    expect(paragraphs.length).toBeGreaterThanOrEqual(6);
    const text = paragraphs.join(' ');
    for (const fragment of ['Administratorem', 'art. 6 ust. 1 lit. c RODO', '1 rok od dnia wpisu', '5 lat', 'Prezesa Urzędu Ochrony Danych Osobowych']) {
      expect(text).toContain(fragment);
    }
  });

  it('opisuje przekazywanie danych poza EOG (decyzja 3A w #39)', () => {
    const text = t('privacy.body');
    expect(text).toContain('spoza Europejskiego Obszaru Gospodarczego');
    expect(text).toContain('standardowych klauzul umownych');
    expect(text).not.toContain('patrz pytanie w #39');
  });
});
