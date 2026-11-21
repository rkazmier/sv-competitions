import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { rulesChapters } from './range-rules';

describe('regulamin strzelnicy (#39, SPEC-005 AC-13)', () => {
  it('dzieli tekst na wstęp i rozdziały z punktami', () => {
    expect(rulesChapters('Wstęp\n\n## R1\n\n1. a\n1) x\n\n2. b\n\n## R2\n\n1. c\n')).toEqual([
      { title: '', points: ['Wstęp'] },
      { title: 'R1', points: ['1. a\n1) x', '2. b'] },
      { title: 'R2', points: ['1. c'] },
    ]);
  });

  it('zawiera 4 rozdziały z pełną liczbą punktów i bez tekstu zastępczego', () => {
    const [intro, ...chapters] = rulesChapters(t('rangeSign.rulesBody'));
    expect(intro).toEqual({ title: '', points: ['Regulamin użytkowania strzelnicy w miejscowości Morawy Wielkie'] });
    expect(chapters.map((c) => c.title)).toEqual([
      'Rozdział 1. Warunki korzystania ze strzelnicy',
      'Rozdział 2. Sposób obchodzenia się z bronią',
      'Rozdział 3. Sposób zachowania się osób przebywających na strzelnicy',
      'Rozdział 4. Dodatkowe warunki bezpieczeństwa',
    ]);
    expect(chapters.map((c) => c.points.length)).toEqual([5, 8, 9, 6]);
    expect(t('rangeSign.rulesBody')).not.toContain('DO UZUPEŁNIENIA');
  });
});
