import { describe, expect, it } from 'vitest';
import { missingForRangeEntry, normalizeProfile, validateProfile, type ProfileData } from './profile';

const empty: ProfileData = { full_name: null, phone: null, permit_number: null, permit_authority: null, address: null };
const data = (patch: Partial<ProfileData>): ProfileData => ({ ...empty, ...patch });

describe('normalizeProfile', () => {
  it('AC-7: trim, pusty ciąg → null (jak profiles_normalize)', () => {
    expect(normalizeProfile({ full_name: '  Jan Kowalski ', phone: '   ', address: '' })).toEqual(
      data({ full_name: 'Jan Kowalski' }),
    );
  });
});

describe('validateProfile', () => {
  it('AC-7: poprawne dane i puste pola opcjonalne przechodzą', () => {
    expect(validateProfile(empty)).toEqual({});
    expect(
      validateProfile(
        data({
          full_name: 'Jan Kowalski',
          phone: '+48 600 100 200',
          permit_number: 'SA-123/2020',
          permit_authority: 'KWP w Katowicach',
          address: 'ul. Stalowa 1, 40-001 Katowice',
        }),
      ),
    ).toEqual({});
  });

  it('AC-8: numer decyzji bez organu wydającego (lub odwrotnie) — błąd przy brakującym polu', () => {
    expect(validateProfile(data({ permit_number: 'SA-1' }))).toEqual({ permit_authority: 'permitPair' });
    expect(validateProfile(data({ permit_authority: 'KWP Katowice' }))).toEqual({ permit_number: 'permitPair' });
  });

  it('AC-11: limity długości z sekcji 5 (po trim, w znakach)', () => {
    expect(validateProfile(data({ full_name: 'J' }))).toEqual({ full_name: 'length' });
    expect(validateProfile(data({ full_name: 'x'.repeat(151) }))).toEqual({ full_name: 'length' });
    expect(validateProfile(data({ full_name: 'Ż'.repeat(150) }))).toEqual({});
    expect(validateProfile(data({ permit_number: 'x'.repeat(51), permit_authority: 'KWP' }))).toEqual({
      permit_number: 'length',
    });
    expect(validateProfile(data({ permit_number: '1', permit_authority: 'K' }))).toEqual({ permit_authority: 'length' });
    expect(validateProfile(data({ address: 'ul.' }))).toEqual({ address: 'length' });
    expect(validateProfile(data({ address: 'x'.repeat(301) }))).toEqual({ address: 'length' });
  });

  it.each(['600100200', '+48 600 100 200', '+48600100200', '600 100 200', '1'.repeat(20)])(
    'AC-11: telefon „%s” pasuje do wzorca',
    (phone) => expect(validateProfile(data({ phone }))).toEqual({}),
  );

  it.each(['60010020', '600-100-200', '+48 (600) 100 200', '++48600100200', 'tel. 600100200', '1'.repeat(21)])(
    'AC-11: telefon „%s” odrzucony',
    (phone) => expect(validateProfile(data({ phone }))).toEqual({ phone: 'phone' }),
  );
});

describe('missingForRangeEntry', () => {
  it('AC-9: puste konto — brakuje imienia i nazwiska oraz decyzji z organem albo adresu', () => {
    expect(missingForRangeEntry(empty)).toEqual(['fullName', 'permitOrAddress']);
  });

  it('AC-9: samo imię i nazwisko — brakuje decyzji z organem albo adresu', () => {
    expect(missingForRangeEntry(data({ full_name: 'Jan Kowalski' }))).toEqual(['permitOrAddress']);
  });

  it('AC-9: adres bez imienia i nazwiska — brakuje imienia i nazwiska', () => {
    expect(missingForRangeEntry(data({ address: 'ul. Stalowa 1, Katowice' }))).toEqual(['fullName']);
  });

  it('AC-10: imię i nazwisko + adres albo decyzja z organem — bez braków (jak is_range_ready)', () => {
    expect(missingForRangeEntry(data({ full_name: 'Jan Kowalski', address: 'ul. Stalowa 1, Katowice' }))).toEqual([]);
    expect(
      missingForRangeEntry(data({ full_name: 'Jan Kowalski', permit_number: 'SA-1', permit_authority: 'KWP Katowice' })),
    ).toEqual([]);
  });
});
