import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import PrivacyNotice from '../components/PrivacyNotice.astro';
import PrivacyNoticeText from '../components/PrivacyNoticeText.astro';
import SiteFooter from '../components/SiteFooter.astro';
import PrivacyPolicyPage from '../pages/polityka-prywatnosci/index.astro';
import { linkParts, privacyPolicyBlocks } from './privacy-policy';
import { spansText } from './sales-terms';

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create();
});

const HEADINGS = [
  '1. Kto jest administratorem danych',
  '2. Jakie dane przetwarzamy',
  '3. W jakich celach i na jakiej podstawie',
  '4. Czy musisz podać dane',
  '5. Komu przekazujemy dane',
  '6. Przekazywanie danych poza EOG',
  '7. Jak długo przechowujemy dane',
  '8. Twoje prawa',
  '9. Pliki cookies i pamięć przeglądarki',
  '10. Zautomatyzowane decyzje',
  '11. Zmiany polityki',
];

const POLICY_LINKS = {
  github: 'https://docs.github.com/pl/site-policy/privacy-policies/github-general-privacy-statement',
  tpay: 'https://tpay.com/polityka-prywatnosci',
  google: 'https://policies.google.com/privacy?hl=pl',
};

describe('linkParts', () => {
  it('zamienia [tekst](https:…) i [tekst](mailto:…) na linki, reszta to tekst', () => {
    expect(linkParts('Pisz na [a@b.pl](mailto:a@b.pl). [Polityka](https://x.pl/p?a=1);')).toEqual([
      { text: 'Pisz na ' },
      { text: 'a@b.pl', href: 'mailto:a@b.pl', external: false },
      { text: '. ' },
      { text: 'Polityka', href: 'https://x.pl/p?a=1', external: true },
      { text: ';' },
    ]);
  });

  it('nie tworzy linków z innych schematów (np. javascript:)', () => {
    expect(linkParts('[x](javascript:alert(1))')).toEqual([{ text: '[x](javascript:alert(1))' }]);
  });
});

describe('polityka prywatności (SPEC-011)', () => {
  it('AC-1: punkty 1–11 jako nagłówki h2 w tej kolejności', () => {
    const headings = privacyPolicyBlocks(t('privacyPolicy.sections'))
      .filter((block) => block.kind === 'h2')
      .map((block) => ('spans' in block ? spansText(block.spans) : ''));
    expect(headings).toEqual(HEADINGS);
  });

  it('AC-1: treść z §12.1 — administrator, GitHub, Tpay, Google, cookies, okresy', () => {
    const text = t('privacyPolicy.sections');
    for (const fragment of [
      'Administratorem Twoich danych osobowych jest Rafał Kaźmierowski, ul. Lęborska 22E/39, 80-387 Gdańsk, NIP 9581488219',
      'Nie wyznaczyliśmy inspektora ochrony danych.',
      'GitHub — hosting stron serwisu; przy każdym wyświetleniu strony otrzymuje adres IP i informacje o przeglądarce.',
      'Tpay (Krajowy Integrator Płatności S.A.) — w zakresie obsługi płatności i zwrotów',
      'Odrębni administratorzy, którzy przetwarzają dane na podstawie własnych zasad:',
      'Serwis nie używa plików cookies ani narzędzi analitycznych i reklamowych.',
      'Dane techniczne w logach serwera hostingu stron — według zasad GitHub.',
      'zaktualizujemy tę politykę i datę „Obowiązuje od”.',
    ]) {
      expect(text).toContain(fragment);
    }
  });

  it('AC-1, AC-3, AC-4: strona — h1, „Obowiązuje od: <data>”, bez noindex', async () => {
    expect(t('privacyPolicy.effectiveDate')).toMatch(/^\d{1,2} \p{L}+ \d{4}$/u);
    const html = await container.renderToString(PrivacyPolicyPage);
    expect(html).toMatch(/<h1[^>]*>Polityka prywatności<\/h1>/);
    expect(html).toContain(`Obowiązuje od: ${t('privacyPolicy.effectiveDate')}`);
    expect(html.match(/<h2[^>]*>/g)).toHaveLength(11);
    expect(html).not.toContain('noindex');
    expect(html).not.toMatch(/\[[^\]]+\]\(/); // znaczniki linków zamienione na <a>
  });

  it('AC-2: polityki Tpay, Google, GitHub w nowej karcie, e-mail jako mailto:', async () => {
    const html = await container.renderToString(PrivacyPolicyPage);
    for (const [name, href] of [
      ['GitHub', POLICY_LINKS.github],
      ['Tpay', POLICY_LINKS.tpay],
      ['Google', POLICY_LINKS.google],
    ]) {
      const escaped = href.replace(/[.?*+^$()[\]\\/|{}]/g, '\\$&').replace(/&/g, '&(?:amp;)?');
      expect(html).toMatch(
        new RegExp(`<a href="${escaped}" target="_blank" rel="noopener noreferrer"[^>]*>Polityka prywatności ${name}</a>`),
      );
    }
    expect(html).toMatch(/<a href="mailto:rkazmierowski@gmail\.com"[^>]*>rkazmierowski@gmail\.com<\/a>/);
    expect(html).not.toMatch(/href="mailto:[^"]*" target/);
  });

  it('AC-5: stopka ma link „Polityka prywatności” → /polityka-prywatnosci/', async () => {
    const html = await container.renderToString(SiteFooter);
    expect(html).toMatch(/<a href="\/polityka-prywatnosci\/"[^>]*>Polityka prywatności<\/a>/);
    expect(html).toContain('href="https://steel-valley.pl"');
  });

  it('AC-7: pod klauzulą link do polityki w nowej karcie', async () => {
    const html = await container.renderToString(PrivacyNotice, { props: { headingId: 'h' } });
    expect(html).toMatch(/<a href="\/polityka-prywatnosci\/" target="_blank" rel="noopener"[^>]*>Polityka prywatności<\/a>/);
    expect(html.indexOf('Polityka prywatności</a>')).toBeGreaterThan(html.indexOf('Odbiorcy danych:'));
  });

  it('AC-9: tekst klauzuli dla /panel/ksiazka/ — nowy akapit, bez linku do polityki', async () => {
    const html = await container.renderToString(PrivacyNoticeText);
    expect(html).toContain('hosting stron serwisu (GitHub');
    expect(html).not.toContain('href="/polityka-prywatnosci/"');
  });
});
