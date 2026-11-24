import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import {
  completeErrorKey,
  entryReturnUrl,
  entryTime,
  entryUrlFor,
  missingInputs,
  passEffect,
  personIdFromSearch,
  qrTokenFromScan,
  saleUrlFor,
  validateCompletion,
  type EntryPass,
} from './range-entry';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function pass(fields: Partial<EntryPass>): EntryPass {
  return {
    priority: 0,
    id: ID,
    kind: 'entries',
    item_name: 'Karnet',
    entries_left: null,
    valid_until: null,
    expires_on: '2027-12-31',
    ...fields,
  };
}

const effectText = (p: EntryPass) => {
  const { key, params } = passEffect(p);
  return t(key, params);
};

describe('AC-5: kod QR → qr_token', () => {
  it('przyjmuje token konta (base64url), obcina spacje', () => {
    expect(qrTokenFromScan('  aB3_-x9QwErTyUiOpAsDfGhJkLzXcVbN \n')).toBe('aB3_-x9QwErTyUiOpAsDfGhJkLzXcVbN');
  });

  it('obcy kod (adres strony, tekst) → null — „Nie znaleziono konta dla tego kodu.”', () => {
    expect(qrTokenFromScan('https://example.com/?a=1')).toBeNull();
    expect(qrTokenFromScan('krótki')).toBeNull();
    expect(qrTokenFromScan('')).toBeNull();
    expect(t('rangeEntry.qrNotFound')).toBe('Nie znaleziono konta dla tego kodu.');
  });
});

describe('AC-8, AC-12: adresy przebiegu', () => {
  it('karta użytkownika → /panel/ksiazka/?osoba=', () => {
    expect(entryUrlFor(ID)).toBe(`/panel/ksiazka/?osoba=${ID}`);
    expect(personIdFromSearch(`?osoba=${ID.toUpperCase()}`)).toBe(ID);
    expect(personIdFromSearch('?osoba=abc')).toBeNull();
    expect(personIdFromSearch('')).toBeNull();
  });

  it('„Sprzedaj na miejscu” → sprzedaż z powrotem do wpisu tej osoby', () => {
    const url = saleUrlFor(ID);
    expect(url).toBe(`/panel/sprzedaz/?osoba=${ID}&powrot=ksiazka`);
    expect(entryReturnUrl(url.slice(url.indexOf('?')))).toBe(entryUrlFor(ID));
    expect(entryReturnUrl(`?osoba=${ID}`)).toBeNull();
  });
});

describe('AC-9: dzisiejszy wpis', () => {
  it('ostrzeżenie z godziną w Europe/Warsaw', () => {
    // 09:32 UTC = 10:32 czasu zimowego w Polsce.
    expect(t('rangeEntry.todayWarning', { time: entryTime('2027-03-10T09:32:00Z') })).toBe(
      'Ta osoba ma dziś wpis o 10:32. Kontynuować?',
    );
  });
});

describe('AC-11: opis skutku wyboru', () => {
  it('karnet ilościowy — zostanie o jedno wejście mniej', () => {
    expect(effectText(pass({ item_name: 'Karnet 10 wejść', entries_left: 7 }))).toBe('Karnet 10 wejść — zostanie 6');
  });

  it('wejście jednorazowe — zostanie wykorzystane', () => {
    expect(effectText(pass({ kind: 'single_entry', item_name: 'Wejście weekendowe' }))).toBe(
      'Wejście weekendowe — zostanie wykorzystane',
    );
  });

  it('wejściówka — obejmuje dziś, bez zmian', () => {
    expect(effectText(pass({ kind: 'event_ticket', item_name: 'Wejściówka: Puchar SV' }))).toBe(
      'Wejściówka: Puchar SV — obejmuje dziś (bez zmian)',
    );
  });
});

describe('AC-7: uzupełnienie danych', () => {
  it('pola formularza tylko dla braków', () => {
    expect(missingInputs(['full_name'])).toEqual(['full_name']);
    expect(missingInputs(['permit_or_address'])).toEqual(['permit_number', 'permit_authority', 'address']);
    expect(missingInputs([])).toEqual([]);
  });

  it('bez kompletu danych — niekompletne (przycisk „Dalej” nieaktywny)', () => {
    const missing = ['full_name', 'permit_or_address'];
    expect(validateCompletion(missing, { full_name: 'Jan Nowak' }).complete).toBe(false);
    expect(validateCompletion(missing, { full_name: '', address: 'ul. Stalowa 1' }).errors).toEqual({ full_name: 'length' });
  });

  it('walidacja SPEC-002: numer decyzji tylko z organem (AC-8), długości (AC-11)', () => {
    const result = validateCompletion(['permit_or_address'], { permit_number: 'AB 1' });
    expect(result.errors).toEqual({ permit_authority: 'permitPair' });
    expect(validateCompletion(['permit_or_address'], { address: 'ul.' }).errors).toEqual({ address: 'length' });
  });

  it('komplet — wartości po trim, pusty → null, tylko brakujące pola', () => {
    const result = validateCompletion(['permit_or_address'], {
      full_name: 'Nie wysyłaj',
      permit_number: ' AB 123 ',
      permit_authority: 'KWP Katowice',
      address: ' ',
    });
    expect(result.complete).toBe(true);
    expect(result.values).toEqual({ permit_number: 'AB 123', permit_authority: 'KWP Katowice', address: null });
  });

  it('błędy zapisu → komunikaty', () => {
    expect(completeErrorKey({ message: 'permit_pair' })).toBe('profile.errorPermitPair');
    expect(completeErrorKey({ message: 'person_not_found' })).toBe('rangeEntry.errorPerson');
    expect(completeErrorKey({ message: 'x' })).toBe('profile.saveError');
  });
});

describe('AC-10, AC-12: teksty listy uprawnień', () => {
  it('brak uprawnienia — komunikat i przyciski', () => {
    expect(t('rangeEntry.noPass')).toBe('Brak ważnego karnetu lub wejścia na dziś.');
    expect(t('rangeEntry.sell')).toBe('Sprzedaj na miejscu');
    expect(t('rangeEntry.companion')).toBe('Wpisz jako osobę towarzyszącą');
  });
});
