import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { invoiceStatus } from './invoice';
import {
  ORDER_COLUMNS,
  ORDER_STATUS_TEXT,
  PAYMENT_METHOD_TEXT,
  buyHref,
  eventOrderPath,
  firstUsedOn,
  idParam,
  orderStatusKey,
  passHistoryState,
  passValidTo,
  paymentView,
  productNotes,
  sortOrders,
  splitPasses,
  ticketSale,
  type UserOrder,
  type UserPass,
} from './offer';
import { formatPrice, NBSP } from './products';

const ID = '0b7c6f8e-1d2a-4c3b-9e5f-6a7b8c9d0e1f';

const pass = (overrides: Partial<UserPass> = {}): UserPass => ({
  id: ID,
  kind: 'entries',
  status: 'active',
  entries_total: 10,
  entries_left: 7,
  first_used_on: null,
  valid_until: null,
  expires_on: '2027-11-17',
  created_at: '2026-11-17T10:00:00Z',
  orders: { item_name: 'Karnet 10 wejść' },
  pass_usages: [],
  ...overrides,
});

describe('/oferta/', () => {
  it('AC-5: cena w formacie „120,00 zł”', () => {
    expect(formatPrice(12000)).toBe(`120,00${NBSP}zł`);
  });

  it('AC-5: informacje — ważność, aktywacja karnetu czasowego, dni wejścia jednorazowego', () => {
    const texts = (kind: 'entries' | 'days' | 'single_entry', day_type: 'weekend' | 'weekday' | null = null) =>
      productNotes({ kind, day_type }).map((key) => t(key));
    expect(texts('entries')).toEqual(['Ważny 1 rok od zakupu.']);
    expect(texts('days')).toEqual(['Ważny 1 rok od zakupu.', 'Odliczanie dni zaczyna się od pierwszego wejścia.']);
    expect(texts('single_entry', 'weekend')).toEqual(['Ważny 1 rok od zakupu.', 'Tylko w soboty i niedziele.']);
    expect(texts('single_entry', 'weekday')).toEqual(['Ważny 1 rok od zakupu.', 'Tylko od poniedziałku do piątku.']);
  });

  it('AC-6: „Kup” bez logowania → /logowanie/?next=/oferta/zamowienie/?product=<id>', () => {
    const href = buyHref(ID, false);
    expect(href).toBe(`/logowanie/?next=${encodeURIComponent(`/oferta/zamowienie/?product=${ID}`)}`);
    expect(new URL(href, 'https://x.test').searchParams.get('next')).toBe(`/oferta/zamowienie/?product=${ID}`);
  });

  it('AC-7: „Kup” po zalogowaniu → podsumowanie zamówienia', () => {
    expect(buyHref(ID, true)).toBe(`/oferta/zamowienie/?product=${ID}`);
  });

  it('AC-7: identyfikator z adresu — tylko UUID', () => {
    expect(idParam(ID.toUpperCase())).toBe(ID);
    expect(idParam('1 or 1=1')).toBeNull();
    expect(idParam(null)).toBeNull();
  });
});

describe('wejściówki (SPEC-003 US-4)', () => {
  it('AC-17: „Kup wejściówkę” → /oferta/zamowienie/?event=<id>', () => {
    expect(eventOrderPath(ID)).toBe(`/oferta/zamowienie/?event=${ID}`);
  });

  it('AC-18: brak wolnych miejsc → „Wyprzedane”; bez limitu — sprzedaż otwarta', () => {
    expect(ticketSale('2027-06-15', '2027-06-14', 0)).toBe('soldOut');
    expect(ticketSale('2027-06-15', '2027-06-14', 1)).toBe('open');
    expect(ticketSale('2027-06-15', '2027-06-14', null)).toBe('open');
  });

  it('AC-19: sprzedaż do końca ostatniego dnia wydarzenia, potem zamknięta', () => {
    expect(ticketSale('2027-06-15', '2027-06-15', null)).toBe('open');
    expect(ticketSale('2027-06-15', '2027-06-16', null)).toBe('closed');
    expect(ticketSale('2027-06-15', '2027-06-16', 0)).toBe('closed');
    expect(t('calendarCard.salesClosed')).toBe('Sprzedaż zakończona.');
  });
});

describe('/konto/platnosc/', () => {
  it('AC-10: `pending` przez 60 s — czekamy, potem „Sprawdź „Moje konto””', () => {
    expect(paymentView('pending', 0)).toBe('waiting');
    expect(paymentView('pending', 57_000)).toBe('waiting');
    expect(paymentView('pending', 60_000)).toBe('slow');
    expect(t('offer.paymentWaiting')).toBe('Czekamy na potwierdzenie płatności…');
    expect(t('offer.paymentSlow')).toBe('Potwierdzenie może potrwać kilka minut. Sprawdź „Moje konto”.');
  });

  it('AC-10: `paid` — „Płatność przyjęta…”', () => {
    expect(paymentView('paid', 0)).toBe('paid');
    expect(paymentView('paid', 90_000)).toBe('paid');
    expect(t('offer.paymentPaid')).toBe('Płatność przyjęta. Karnet jest aktywny w Twoim koncie.');
  });

  it('AC-10: inny stan (np. anulowane) — bez odświeżania, odsyła do konta', () => {
    expect(paymentView('cancelled', 0)).toBe('slow');
  });
});

describe('/konto/ — karnety', () => {
  const today = '2026-12-01';

  it('AC-12: „Ważny do” — czasowy aktywowany: ostatni dzień; pozostałe: expires_on', () => {
    expect(passValidTo(pass())).toBe('2027-11-17');
    expect(passValidTo(pass({ kind: 'days', first_used_on: '2026-11-20', valid_until: '2026-12-19' }))).toBe('2026-12-19');
    expect(passValidTo(pass({ kind: 'days' }))).toBe('2027-11-17');
  });

  it('AC-12: data pierwszego użycia — aktywacja albo najwcześniejsze niecofnięte zużycie', () => {
    expect(firstUsedOn(pass())).toBeNull();
    expect(
      firstUsedOn(
        pass({
          pass_usages: [
            { id: 'u1', used_on: '2026-11-25', created_at: '2026-11-25T09:00:00Z', reverted_at: null },
            { id: 'u2', used_on: '2026-11-20', created_at: '2026-11-20T09:00:00Z', reverted_at: '2026-11-20T12:00:00Z' },
            { id: 'u3', used_on: '2026-11-22', created_at: '2026-11-22T09:00:00Z', reverted_at: null },
          ],
        }),
      ),
    ).toBe('2026-11-22');
    expect(firstUsedOn(pass({ kind: 'days', first_used_on: '2026-11-21' }))).toBe('2026-11-21');
  });

  it('AC-12, AC-15: aktywne w „Twoje karnety”; wykorzystane, wygasłe i anulowane w „Historia karnetów”', () => {
    const active = pass({ id: 'a' });
    const notActivated = pass({ id: 'b', kind: 'days', entries_total: null, entries_left: null });
    const usedUp = pass({ id: 'c', status: 'used_up', entries_left: 0 });
    const cancelled = pass({ id: 'd', status: 'cancelled' });
    const expired = pass({ id: 'e', expires_on: '2026-11-30' });
    const daysOver = pass({ id: 'f', kind: 'days', first_used_on: '2026-11-01', valid_until: '2026-11-30' });
    const { active: shown, history } = splitPasses([active, notActivated, usedUp, cancelled, expired, daysOver], today);
    expect(shown.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(history.map((p) => p.id).sort()).toEqual(['c', 'd', 'e', 'f']);
    expect(t(passHistoryState(usedUp))).toBe('Wykorzystany');
    expect(t(passHistoryState(cancelled))).toBe('Anulowany');
    expect(t(passHistoryState(expired))).toBe('Wygasł');
  });

  it('AC-12: karnet ważny jeszcze w ostatnim dniu', () => {
    expect(splitPasses([pass({ expires_on: today })], today).active).toHaveLength(1);
  });

  it('AC-12: teksty — pozostałe wejścia i nieaktywny karnet czasowy', () => {
    expect(t('offer.entriesLeft', { left: 7, total: 10 })).toBe('Pozostałe wejścia: 7 z 10');
    expect(t('offer.notActivated')).toBe('Nieaktywny — dni liczą się od pierwszego wejścia');
  });

  it('AC-14: „Przedłuż karnet” prowadzi do /oferta/', () => {
    expect(t('offer.renew')).toBe('Przedłuż karnet');
  });
});

describe('/konto/ — historia płatności', () => {
  it('AC-13: od najnowszych; metoda i status po polsku', () => {
    const order = (id: string, created_at: string): UserOrder => ({
      id,
      order_number: 'SV-2026-000001',
      item_name: 'Karnet',
      amount: 12000,
      payment_method: 'tpay',
      status: 'paid',
      created_at,
      invoice_requested: false,
      invoice_number: null,
    });
    expect(
      sortOrders([order('a', '2026-11-01T10:00:00Z'), order('b', '2026-11-03T10:00:00Z'), order('c', '2026-11-02T10:00:00Z')]).map(
        (o) => o.id,
      ),
    ).toEqual(['b', 'c', 'a']);
    expect(Object.values(PAYMENT_METHOD_TEXT).map((key) => t(key))).toEqual(['Online', 'Na miejscu', 'Prezent']);
    expect(Object.values(ORDER_STATUS_TEXT).map((key) => t(key))).toEqual([
      'Opłacone',
      'Oczekuje',
      'Nieopłacone — anulowane',
      'Zwrot w toku',
      'Zwrócone',
    ]);
  });
});

describe('SPEC-010: prezent w /konto/', () => {
  const gift = (fields: Partial<UserOrder> = {}): UserOrder => ({
    id: 'g1',
    order_number: 'SV-2026-000124',
    item_name: 'Karnet 10 wejść',
    amount: 0,
    payment_method: 'gift',
    status: 'paid',
    created_at: '2026-11-21T10:00:00Z',
    invoice_requested: false,
    invoice_number: null,
    ...fields,
  });

  it('AC-12: przyznany karnet w „Twoje karnety” jak kupiony; „Ważny do” = data ustawiona przez admina', () => {
    const granted = pass({ expires_on: '2027-03-31', orders: { item_name: 'Karnet ukryty' } });
    expect(splitPasses([granted], '2026-11-21').active).toEqual([granted]);
    expect(passValidTo(granted)).toBe('2027-03-31');
  });

  it('AC-13: „Historia płatności” — 0,00 zł, „Prezent”, „Opłacone” / po anulowaniu „Anulowane”, bez statusu faktury i powodu', () => {
    expect(formatPrice(gift().amount)).toBe(`0,00${NBSP}zł`);
    expect(t(PAYMENT_METHOD_TEXT[gift().payment_method])).toBe('Prezent');
    expect(t(orderStatusKey(gift()))).toBe('Opłacone');
    expect(t(orderStatusKey(gift({ status: 'cancelled' })))).toBe('Anulowane');
    expect(t(orderStatusKey({ payment_method: 'tpay', status: 'cancelled' }))).toBe('Nieopłacone — anulowane');
    expect(invoiceStatus(gift({ invoice_requested: true }))).toBeNull();
    expect(ORDER_COLUMNS).not.toMatch(/reason|order_grants/);
  });

  it('AC-20: anulowany karnet z prezentu — tylko w „Historia karnetów” jako „Anulowany”', () => {
    const cancelled = pass({ status: 'cancelled', entries_left: 4 });
    const { active, history } = splitPasses([cancelled], '2026-11-21');
    expect(active).toEqual([]);
    expect(history).toEqual([cancelled]);
    expect(t(passHistoryState(cancelled))).toBe('Anulowany');
  });
});
