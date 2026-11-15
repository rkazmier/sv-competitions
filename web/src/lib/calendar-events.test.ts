import { describe, expect, it } from 'vitest';
import {
  eventCheckError,
  isValidExternalUrl,
  needsExternalUrl,
  previewEntry,
  toEventRow,
  validateCalendarEvent,
  type CalendarEventInput,
} from './calendar-events';

const input: CalendarEventInput = {
  name: 'Dzień otwarty',
  category_id: 'k1',
  starts_on: '2027-06-14',
  ends_on: '',
  description: '',
  external_url: '',
};

describe('wydarzenie — formularz', () => {
  it('AC-48: szkic wymaga tylko nazwy, kategorii i daty początku', () => {
    expect(validateCalendarEvent(input)).toEqual({});
    expect(toEventRow({ ...input, name: '  Dzień otwarty  ' })).toEqual({
      name: 'Dzień otwarty',
      category_id: 'k1',
      starts_on: '2027-06-14',
      ends_on: null,
      description: null,
      external_url: null,
    });
  });

  it('AC-48: brak nazwy, kategorii, daty początku', () => {
    expect(validateCalendarEvent({ ...input, name: '   ', category_id: '', starts_on: '' })).toEqual({
      name: 'required',
      category_id: 'required',
      starts_on: 'required',
    });
  });

  it('AC-48: nazwa 1–150 znaków, opis maks. 2000 znaków (liczone jako znaki, nie bajty)', () => {
    expect(validateCalendarEvent({ ...input, name: 'ż'.repeat(150), description: 'ą'.repeat(2000) })).toEqual({});
    expect(validateCalendarEvent({ ...input, name: 'ż'.repeat(151), description: 'ą'.repeat(2001) })).toEqual({
      name: 'tooLong',
      description: 'tooLong',
    });
  });

  it('AC-49: data końca nie może być wcześniejsza niż data początku', () => {
    expect(validateCalendarEvent({ ...input, ends_on: '2027-06-13' })).toEqual({ ends_on: 'endBeforeStart' });
    expect(validateCalendarEvent({ ...input, ends_on: '2027-06-14' })).toEqual({});
    expect(validateCalendarEvent({ ...input, ends_on: '2027-06-15' })).toEqual({});
  });

  it('AC-50: link musi zaczynać się od http:// lub https:// i mieć maks. 2000 znaków', () => {
    expect(isValidExternalUrl('https://facebook.com/events/1')).toBe(true);
    expect(isValidExternalUrl('http://example.com')).toBe(true);
    expect(isValidExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isValidExternalUrl('www.example.com')).toBe(false);
    expect(isValidExternalUrl('ftp://example.com')).toBe(false);
    expect(isValidExternalUrl('HTTPS://example.com')).toBe(false); // jak `check` w bazie (`~`)
    expect(isValidExternalUrl('https://')).toBe(false);
    const prefix = 'https://example.com/';
    expect(isValidExternalUrl(prefix + 'a'.repeat(2000 - prefix.length))).toBe(true);
    expect(isValidExternalUrl(prefix + 'a'.repeat(2001 - prefix.length))).toBe(false);
    expect(validateCalendarEvent({ ...input, external_url: 'example.com' })).toEqual({ external_url: 'invalidUrl' });
    expect(validateCalendarEvent({ ...input, external_url: ' https://example.com ' })).toEqual({});
    expect(toEventRow({ ...input, external_url: ' https://example.com ' }).external_url).toBe('https://example.com');
  });

  it('AC-51: publikacja wymaga linku; szkic nie', () => {
    expect(needsExternalUrl('published', '  ')).toBe(true);
    expect(needsExternalUrl('draft', '')).toBe(false);
    expect(validateCalendarEvent(input, 'published')).toEqual({ external_url: 'urlRequired' });
    expect(validateCalendarEvent({ ...input, external_url: 'https://example.com' }, 'published')).toEqual({});
    expect(validateCalendarEvent({ ...input, external_url: 'example.com' }, 'published')).toEqual({ external_url: 'invalidUrl' });
  });

  it('AC-49 AC-50 AC-51: rozpoznaje błędy `check` z bazy', () => {
    const check = (constraint: string) => ({
      code: '23514',
      message: `new row for relation "calendar_events" violates check constraint "${constraint}"`,
    });
    expect(eventCheckError(check('calendar_events_published_needs_url'))).toEqual({ field: 'external_url', code: 'urlRequired' });
    expect(eventCheckError(check('calendar_events_external_url_check'))).toEqual({ field: 'external_url', code: 'invalidUrl' });
    expect(eventCheckError(check('calendar_events_ends_on_check'))).toEqual({ field: 'ends_on', code: 'endBeforeStart' });
    expect(eventCheckError(check('calendar_events_name_check'))).toBeNull();
    expect(eventCheckError({ code: '42501', message: 'rls' })).toBeNull();
    expect(eventCheckError(null)).toBeNull();
  });
});

describe('wydarzenie — podgląd karty', () => {
  it('AC-53: karta z wartości formularza; link tylko poprawny', () => {
    expect(
      previewEntry({ ...input, ends_on: '2027-06-15', description: 'Opis', external_url: 'https://example.com' }, 'Szkolenie'),
    ).toMatchObject({
      kind: 'event',
      name: 'Dzień otwarty',
      label: 'Szkolenie',
      startsOn: '2027-06-14',
      endsOn: '2027-06-15',
      description: 'Opis',
      externalUrl: 'https://example.com',
    });
    expect(previewEntry({ ...input, external_url: 'javascript:alert(1)' }, 'Szkolenie')?.externalUrl).toBeNull();
    expect(previewEntry({ ...input, ends_on: '2027-06-01' }, 'Szkolenie')?.endsOn).toBeNull();
  });

  it('AC-53: bez nazwy, kategorii lub daty początku — brak karty', () => {
    expect(previewEntry({ ...input, name: ' ' }, 'Szkolenie')).toBeNull();
    expect(previewEntry(input, undefined)).toBeNull();
    expect(previewEntry({ ...input, starts_on: '' }, 'Szkolenie')).toBeNull();
  });
});
