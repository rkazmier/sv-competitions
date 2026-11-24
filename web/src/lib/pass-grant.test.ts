import { describe, expect, it } from 'vitest';
import {
  addYears,
  expiresRange,
  grantErrorKey,
  grantGroups,
  grantPersonFromSearch,
  grantUrlFor,
  orderNumberFromSearch,
  orderSearchUrl,
  validateGrant,
  type GrantEvent,
  type GrantProduct,
} from './pass-grant';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (n: number, fields: Partial<GrantProduct>): GrantProduct => ({
  id: ID(n),
  name: `p${n}`,
  price: 12000,
  kind: 'entries',
  is_active: true,
  ...fields,
});
const E = (n: number, fields: Partial<GrantEvent>): GrantEvent => ({
  id: ID(100 + n),
  name: `e${n}`,
  starts_on: '2026-11-25',
  ends_on: null,
  ticket_price: 5000,
  capacity: null,
  seats_left: null,
  ...fields,
});
const ticket = (name: string) => `Wejściówka: ${name}`;
const today = '2026-11-21';

describe('przyznanie karnetu — co przyznać (SPEC-010 AC-3)', () => {
  const products = [
    P(2, { kind: 'entries', name: 'Ukryty', is_active: false }),
    P(3, { kind: 'single_entry', name: 'Wejście' }),
  ];
  const events = [
    E(1, { name: 'Trwa', starts_on: '2026-11-20', ends_on: '2026-11-21' }),
    E(2, { name: 'Minione', starts_on: '2026-11-10', ends_on: '2026-11-20' }),
    E(3, { name: 'Z limitem', capacity: 20, seats_left: 12 }),
    E(4, { name: 'Pełne', capacity: 10, seats_left: 0 }),
  ];
  const groups = grantGroups(products, events, today, ticket);

  it('AC-3: grupy w kolejności ilościowe, jednorazowe, wejściówki — także produkty ukryte', () => {
    expect(groups.map((g) => g.kind)).toEqual(['entries', 'single_entry', 'ticket']);
    expect(groups[0]!.items[0]).toMatchObject({ value: `product:${ID(2)}`, name: 'Ukryty', hidden: true, price: 12000 });
    expect(groups[1]!.items[0]).toMatchObject({ name: 'Wejście', hidden: false, disabled: false });
  });

  it('AC-3: wejściówki tylko na wydarzenia, których ostatni dzień nie minął; wolne miejsca i wyprzedane', () => {
    const tickets = groups[2]!.items;
    expect(tickets.map((i) => i.name)).toEqual(['Wejściówka: Trwa', 'Wejściówka: Z limitem', 'Wejściówka: Pełne']);
    expect(tickets[0]).toMatchObject({ disabled: false, event: { seats_left: null } });
    expect(tickets[1]).toMatchObject({ disabled: false, event: { seats_left: 12 }, price: 5000 });
    expect(tickets[2]).toMatchObject({ disabled: true, event: { seats_left: 0 } });
  });

  it('AC-3: puste grupy pominięte', () => {
    expect(grantGroups([P(1, { kind: 'single_entry' })], [], today, ticket).map((g) => g.kind)).toEqual(['single_entry']);
  });
});

describe('przyznanie karnetu — „Ważny do” (SPEC-010 AC-4)', () => {
  it('AC-4: domyślnie dziś + 1 rok, zakres dziś…dziś + 5 lat', () => {
    expect(expiresRange(today)).toEqual({ min: today, max: '2031-11-21', default: '2027-11-21' });
  });

  it('AC-4: 29.02 + rok = 28.02 (jak pass_expires_on); do roku przestępnego zostaje 29.02', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
    expect(addYears('2026-12-31', 5)).toBe('2031-12-31');
  });
});

describe('przyznanie karnetu — walidacja (SPEC-010 AC-2, AC-4…AC-6)', () => {
  const product = `product:${ID(1)}`;
  const event = `event:${ID(101)}`;
  const form = { personId: ID(9), item: product, expiresOn: '2027-11-21', reason: '  Nagroda — zawody X  ' };

  it('AC-6, AC-7: poprawny produkt → argumenty grant_pass z obciętym powodem i datą', () => {
    expect(validateGrant(form, today)).toEqual({
      ok: true,
      args: { p_user_id: ID(9), p_product_id: ID(1), p_event_id: null, p_reason: 'Nagroda — zawody X', p_expires_on: '2027-11-21' },
    });
  });

  it('AC-5: wejściówka — bez daty ważności (p_expires_on = null), nawet gdy pole ma wartość', () => {
    expect(validateGrant({ ...form, item: event, expiresOn: '' }, today)).toMatchObject({
      ok: true,
      args: { p_product_id: null, p_event_id: ID(101), p_expires_on: null },
    });
  });

  it('AC-2: osoba wymagana; AC-3: pozycja wymagana', () => {
    expect(validateGrant({ ...form, personId: null, item: '' }, today)).toEqual({
      ok: false,
      errors: { person: 'grant.personRequired', item: 'grant.itemRequired' },
    });
  });

  it('AC-4: data poza zakresem dziś…dziś + 5 lat albo pusta → błąd', () => {
    for (const expiresOn of ['2026-11-20', '2031-11-22', '', 'jutro']) {
      expect(validateGrant({ ...form, expiresOn }, today)).toEqual({ ok: false, errors: { expiresOn: 'grant.errorExpiresOn' } });
    }
    for (const expiresOn of [today, '2031-11-21']) expect(validateGrant({ ...form, expiresOn }, today).ok).toBe(true);
  });

  it('AC-6: powód 3–300 znaków po obcięciu spacji', () => {
    const bad = { ok: false, errors: { reason: 'grant.errorReason' } };
    expect(validateGrant({ ...form, reason: '  ab  ' }, today)).toEqual(bad);
    expect(validateGrant({ ...form, reason: 'x'.repeat(301) }, today)).toEqual(bad);
    expect(validateGrant({ ...form, reason: 'abc' }, today).ok).toBe(true);
    expect(validateGrant({ ...form, reason: ` ${'x'.repeat(300)} ` }, today).ok).toBe(true);
  });
});

describe('przyznanie karnetu — błędy grant_pass (SPEC-010 §6, AC-10, AC-11)', () => {
  it('AC-10: sold_out → „Brak wolnych miejsc…”', () => {
    expect(grantErrorKey({ message: 'sold_out' })).toBe('grant.errorSoldOut');
  });

  it('AC-11: event_unavailable i sales_closed → „Na to wydarzenie nie można już przyznać wejściówki.”', () => {
    expect(grantErrorKey({ message: 'event_unavailable' })).toBe('grant.errorEvent');
    expect(grantErrorKey({ message: 'sales_closed' })).toBe('grant.errorEvent');
  });

  it('pozostałe kody i nieznane błędy', () => {
    expect(grantErrorKey({ message: 'user_not_found' })).toBe('grant.errorPerson');
    expect(grantErrorKey({ message: 'product_not_found' })).toBe('grant.errorProduct');
    expect(grantErrorKey({ message: 'invalid_grant_reason' })).toBe('grant.errorReason');
    expect(grantErrorKey({ message: 'invalid_expires_on' })).toBe('grant.errorExpiresOn');
    expect(grantErrorKey({ message: 'Failed to fetch' })).toBe('grant.errorGeneric');
    expect(grantErrorKey(null)).toBe('grant.errorGeneric');
  });
});

describe('przyznanie karnetu — adresy (SPEC-010 AC-1, AC-8)', () => {
  it('AC-1: profil osoby → formularz z ?osoba=<id>', () => {
    expect(grantUrlFor(ID(9))).toBe(`/panel/zamowienia/przyznaj/?osoba=${ID(9)}`);
    expect(grantPersonFromSearch(`?osoba=${ID(9)}`)).toBe(ID(9));
    expect(grantPersonFromSearch('?osoba=abc')).toBeNull();
  });

  it('AC-8: „Pokaż zamówienie” → lista zamówień z wyszukaniem po numerze', () => {
    expect(orderSearchUrl('SV-2026-000123')).toBe('/panel/zamowienia/?numer=SV-2026-000123');
    expect(orderNumberFromSearch('?numer=SV-2026-000123')).toBe('SV-2026-000123');
    expect(orderNumberFromSearch('?numer=Jan')).toBeNull();
    expect(orderNumberFromSearch('')).toBeNull();
  });
});
