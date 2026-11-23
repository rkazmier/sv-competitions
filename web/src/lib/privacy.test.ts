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

  it('SPEC-011 AC-8: akapit „Odbiorcy danych” ma treść §12.2, pozostałe akapity bez zmian', () => {
    const paragraphs = privacyParagraphs(t('privacy.body'));
    const recipients = paragraphs.filter((p) => p.startsWith('Odbiorcy danych:'));
    expect(recipients).toEqual([
      'Odbiorcy danych: dostawcy usług, z których korzystamy w naszym imieniu — hosting bazy danych, logowania i plików oraz wysyłka wiadomości e-mail (Supabase, serwery w Unii Europejskiej, Frankfurt) i hosting stron serwisu (GitHub — otrzymuje adres IP i informacje o przeglądarce przy wyświetlaniu stron). Odrębnymi administratorami danych są: Tpay (Krajowy Integrator Płatności S.A.) w zakresie obsługi płatności — otrzymuje imię i nazwisko oraz e-mail płatnika, oraz Google w zakresie konta Google, jeśli logujesz się przez Google. Dane mogą też otrzymać uprawnione organy państwowe, gdy wynika to z przepisów. Dostawcy mogą mieć dostęp do danych z państw spoza Europejskiego Obszaru Gospodarczego (EOG); odbywa się to na podstawie standardowych klauzul umownych lub decyzji Komisji Europejskiej o adekwatności (EU–US Data Privacy Framework). Szczegóły: polityka prywatności na events.steel-valley.pl/polityka-prywatnosci/.',
    ]);
    // Akapit przed i po odbiorcach — bez zmian (kolejność i liczba akapitów jak w #39).
    expect(paragraphs).toHaveLength(8);
    expect(paragraphs[4]).toBe(recipients[0]);
    expect(paragraphs[3]).toMatch(/^Podanie imienia i nazwiska/);
    expect(paragraphs[5]).toMatch(/^Okres przechowywania:/);
    expect(t('privacy.body')).not.toContain('obsługa płatności (Tpay');
  });

  it('podaje dane administratora: imię i nazwisko, adres, NIP i e-mail (#39)', () => {
    const text = t('privacy.body');
    expect(text).toContain('Administratorem Twoich danych osobowych jest Rafał Kaźmierowski, ul. Lęborska 22E/39, 80-387 Gdańsk, NIP 9581488219');
    expect(text).toContain('Kontakt w sprawach danych osobowych: rkazmierowski@gmail.com');
    expect(text).not.toContain('DO UZUPEŁNIENIA');
  });
});
