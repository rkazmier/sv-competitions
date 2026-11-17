import { describe, expect, it } from 'vitest';
import {
  changesFrozenFields,
  formatPrice,
  groupProducts,
  isProductHasOrdersError,
  NBSP,
  parsePrice,
  priceInputValue,
  productForm,
  validateProduct,
  type Product,
  type ProductForm,
} from './products';

const form = (overrides: Partial<ProductForm> = {}): ProductForm => ({
  kind: 'entries',
  name: 'Karnet 10 wejść',
  price: '120,00',
  entries: '10',
  days: '',
  day_type: '',
  description: '',
  ...overrides,
});

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  kind: 'entries',
  name: 'Karnet 10 wejść',
  description: null,
  price: 12000,
  entries: 10,
  days: null,
  day_type: null,
  is_active: false,
  position: 1,
  ...overrides,
});

describe('produkty — cena', () => {
  it('AC-1: cena w złotych do grosza → grosze', () => {
    expect(parsePrice('120')).toBe(12000);
    expect(parsePrice('120,5')).toBe(12050);
    expect(parsePrice('120,50')).toBe(12050);
    expect(parsePrice('0.01')).toBe(1);
    expect(parsePrice(' 1 200,99 zł ')).toBe(120099);
    expect(parsePrice('19,999')).toBeNull();
    expect(parsePrice('-5')).toBeNull();
    expect(parsePrice('dwadzieścia')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });

  it('AC-1: cena wyświetlana jak w Ofercie („120,00 zł”) i w polu edycji', () => {
    expect(formatPrice(12000)).toBe('120,00 zł');
    expect(formatPrice(5001)).toBe('50,01 zł');
    expect(formatPrice(12000)).toBe(`120,00${NBSP}zł`);
    expect(priceInputValue(12050)).toBe('120,50');
    expect(priceInputValue(1)).toBe('0,01');
  });
});

describe('produkty — walidacja formularza', () => {
  it('AC-1: karnet ilościowy → wiersz z liczbą wejść, pozostałe szczegóły null', () => {
    expect(validateProduct(form({ name: '  Karnet 10 wejść ', description: '  ' }))).toEqual({
      ok: true,
      row: { kind: 'entries', name: 'Karnet 10 wejść', description: null, price: 12000, entries: 10, days: null, day_type: null },
    });
  });

  it('AC-1: karnet czasowy wymaga liczby dni 1–366, pola innych rodzajów są pomijane', () => {
    const ok = validateProduct(form({ kind: 'days', entries: '10', days: '366' }));
    expect(ok).toMatchObject({ ok: true, row: { days: 366, entries: null } });
    expect(validateProduct(form({ kind: 'days', days: '367' }))).toEqual({ ok: false, errors: { days: 'daysInvalid' } });
    expect(validateProduct(form({ kind: 'days', days: '0' }))).toEqual({ ok: false, errors: { days: 'daysInvalid' } });
  });

  it('AC-1: wejście jednorazowe wymaga dnia (Weekend / Dzień powszedni)', () => {
    expect(validateProduct(form({ kind: 'single_entry', day_type: 'weekday' }))).toMatchObject({
      ok: true,
      row: { day_type: 'weekday', entries: null, days: null },
    });
    expect(validateProduct(form({ kind: 'single_entry', day_type: '' }))).toEqual({
      ok: false,
      errors: { day_type: 'dayTypeRequired' },
    });
  });

  it('AC-1: liczba wejść 1–100, liczby całkowite', () => {
    expect(validateProduct(form({ entries: '100' })).ok).toBe(true);
    for (const entries of ['0', '101', '2.5', '', 'x']) {
      expect(validateProduct(form({ entries }))).toEqual({ ok: false, errors: { entries: 'entriesInvalid' } });
    }
  });

  it('AC-1: wymagane pola i limity: rodzaj, nazwa (100), cena (0,01–10 000 zł), opis (500)', () => {
    expect(
      validateProduct(form({ kind: '', name: ' ', price: '0', description: 'x'.repeat(501) })),
    ).toEqual({
      ok: false,
      errors: { kind: 'kindRequired', name: 'nameRequired', price: 'priceInvalid', description: 'descriptionTooLong' },
    });
    expect(validateProduct(form({ name: 'ż'.repeat(101) }))).toEqual({ ok: false, errors: { name: 'nameTooLong' } });
    expect(validateProduct(form({ price: '10000,00' })).ok).toBe(true);
    expect(validateProduct(form({ price: '10000,01' }))).toEqual({ ok: false, errors: { price: 'priceInvalid' } });
    expect(validateProduct(form({ description: 'x'.repeat(500) })).ok).toBe(true);
  });

  it('AC-3: formularz edycji odtwarza produkt', () => {
    const p = product({ price: 12050, description: 'Opis' });
    expect(validateProduct(productForm(p))).toEqual({
      ok: true,
      row: { kind: 'entries', name: p.name, description: 'Opis', price: 12050, entries: 10, days: null, day_type: null },
    });
  });
});

describe('produkty — zamówienia i kolejność', () => {
  it('AC-3: nazwa i cena nie są zamrożone; rodzaj, liczba wejść/dni i dzień — tak', () => {
    const p = product();
    const ok = validateProduct(productForm(p));
    if (!ok.ok) throw new Error('nieprawidłowy formularz');
    expect(changesFrozenFields(p, { ...ok.row, name: 'Nowa nazwa', price: 99 })).toBe(false);
    expect(changesFrozenFields(p, { ...ok.row, entries: 12 })).toBe(true);
    expect(changesFrozenFields(p, { ...ok.row, kind: 'days', entries: null, days: 10 })).toBe(true);
  });

  it('AC-3: błąd bazy `product_has_orders` jest rozpoznawany', () => {
    expect(isProductHasOrdersError({ code: '23514', message: 'product_has_orders' })).toBe(true);
    expect(isProductHasOrdersError({ code: '23514', message: 'products_kind_details' })).toBe(false);
    expect(isProductHasOrdersError(null)).toBe(false);
  });

  it('AC-4: produkty w grupach rodzaju, w grupie wg pozycji', () => {
    const groups = groupProducts([
      product({ id: 'b', position: 2 }),
      product({ id: 'd', kind: 'days', entries: null, days: 30, position: 1 }),
      product({ id: 'a', position: 1 }),
      product({ id: 'c', position: 3, is_active: true }),
    ]);
    expect(groups.entries.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(groups.days.map((p) => p.id)).toEqual(['d']);
    expect(groups.single_entry).toEqual([]);
  });
});
