import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { orderStatusText, PAYMENT_METHOD_TEXT } from './offer';
import {
  canCancelGrant,
  canResendEmail,
  csvCell,
  csvFileName,
  defaultFilters,
  emailStatusText,
  filterArgs,
  grantCancelErrorKey,
  grantDetails,
  invoiceAction,
  methodKeys,
  PAYMENT_METHODS,
  ordersCsv,
  numberSearchKey,
  isRefundNoteValid,
  orderAction,
  ordersTotal,
  personLabel,
  refundErrorKey,
  refundsTotal,
  withdrawalQuoteText,
  type AdminOrder,
} from './orders-admin';
import { formatPrice, NBSP } from './products';

const ID = '00000000-0000-0000-0000-0000000000f1';

const order = (fields: Partial<AdminOrder> = {}): AdminOrder => ({
  id: '00000000-0000-0000-0000-0000000000d1',
  order_number: 'SV-2026-000123',
  created_at: '2026-11-18T08:05:00Z',
  item_name: 'Karnet 10 wejść',
  amount: 120000,
  payment_method: 'tpay',
  on_site_method: null,
  status: 'paid',
  refund_note: null,
  user_id: '00000000-0000-0000-0000-0000000000c1',
  person_name: 'Jan Kowalski',
  person_email: 'jan@example.test',
  seller_name: null,
  pass_used: false,
  invoice_requested: false,
  grant_reason: null,
  grant_cancel_note: null,
  terms_version: null,
  early_performance_consent_at: null,
  email_status: null,
  email_sent_at: null,
  refund_amount: null,
  withdrawal_on: null,
  pass_kind: 'entries',
  refund_window_until: null,
  withdrawal_refund: null,
  withdrawal_submitted_at: null,
  withdrawal_processed_at: null,
  withdrawal_comment: null,
  ...fields,
});

describe('SPEC-012 AC-11, AC-14: stan e-maila z potwierdzeniem', () => {
  it('AC-14: „wysłano <data>” / „w kolejce” / „nie wysłano” (Europe/Warsaw)', () => {
    expect(emailStatusText(order({ email_status: 'sent', email_sent_at: '2027-01-02T13:06:00Z' }))).toBe(
      'E-mail z potwierdzeniem: wysłano 2.01.2027 14:06',
    );
    expect(emailStatusText(order({ email_status: 'pending' }))).toBe('E-mail z potwierdzeniem: w kolejce');
    expect(emailStatusText(order({ email_status: 'failed' }))).toBe('E-mail z potwierdzeniem: nie wysłano');
  });

  it('AC-13, AC-14: zamówienie bez e-maila (na miejscu, prezent, sprzed regulaminu) — bez informacji', () => {
    expect(emailStatusText(order({ payment_method: 'on_site' }))).toBeNull();
  });

  it('AC-11: „Wyślij ponownie” tylko po nieudanych próbach (failed)', () => {
    expect(canResendEmail(order({ email_status: 'failed' }))).toBe(true);
    for (const email_status of ['sent', 'pending', 'skipped', null] as const) {
      expect(canResendEmail(order({ email_status }))).toBe(false);
    }
  });
});

describe('AC-24: filtry zamówień', () => {
  it('domyślnie od 1. dnia bieżącego miesiąca do dziś', () => {
    expect(defaultFilters('2026-11-18')).toMatchObject({ from: '2026-11-01', to: '2026-11-18', status: '', person: '' });
  });

  it('pola → argumenty admin_list_orders; puste i niepoprawne pomijane', () => {
    expect(
      filterArgs({ from: '2026-11-01', to: '', status: 'paid', method: 'on_site', item: `product:${ID}`, person: ' Jan ' }),
    ).toEqual({
      p_from: '2026-11-01',
      p_to: null,
      p_status: 'paid',
      p_method: 'on_site',
      p_product_id: ID,
      p_event_id: null,
      p_person: 'Jan',
    });
    expect(filterArgs({ from: 'x', to: '2026-13', status: 'drop', method: 'card', item: `event:${ID}`, person: '  ' })).toEqual({
      p_from: null,
      p_to: null,
      p_status: null,
      p_method: null,
      p_product_id: null,
      p_event_id: ID,
      p_person: null,
    });
  });

  it('suma kwot bieżącego widoku', () => {
    expect(ordersTotal([order(), order({ amount: 5000, status: 'refunded' })])).toBe(125000);
    expect(ordersTotal([])).toBe(0);
  });

  it('osoba: imię i nazwisko, inaczej e-mail; bez konta — null', () => {
    expect(personLabel(order())).toBe('Jan Kowalski');
    expect(personLabel(order({ person_name: null }))).toBe('jan@example.test');
    expect(personLabel(order({ person_name: null, person_email: null, user_id: null }))).toBeNull();
  });
});

describe('SPEC-006 AC-10, AC-11: filtr „Osoba lub nr zamówienia”', () => {
  it('AC-10: numer zamówienia — komunikat o pominiętych filtrach albo o braku numeru', () => {
    expect(t('orders.person')).toBe('Osoba lub nr zamówienia');
    expect(numberSearchKey(' sv-2026-123 ', 1)).toBe('orders.numberResult');
    expect(t('orders.numberResult')).toBe('Wynik wyszukiwania po numerze zamówienia — pozostałe filtry pominięte.');
    expect(numberSearchKey('SV-2026-000999', 0)).toBe('orders.numberNotFound');
    expect(t('orders.numberNotFound')).toBe('Brak zamówienia o tym numerze.');
  });

  it('AC-11: tekst bez formy numeru — wyszukiwanie po osobie bez komunikatu, wartość trafia do p_person', () => {
    expect(numberSearchKey('Jan Kowalski', 0)).toBeNull();
    expect(numberSearchKey('123', 3)).toBeNull();
    expect(filterArgs({ ...defaultFilters('2026-11-18'), person: ' Jan ' }).p_person).toBe('Jan');
  });
});

describe('AC-24: eksport CSV', () => {
  it('BOM, średnik, nagłówki z i18n, kwota z przecinkiem, metoda i status po polsku; SPEC-006 AC-9: numer zamówienia w 1. kolumnie', () => {
    const csv = ordersCsv(
      [order(), order({ payment_method: 'on_site', on_site_method: 'cash', status: 'refunded', user_id: null, person_name: null,
        person_email: null, seller_name: 'Anna', refund_note: 'Zwrot gotówki / na terminal' })],
      (key) => t(key),
    );
    const lines = csv.replace('﻿', '').trimEnd().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('"Numer zamówienia";"Data";"Produkt";"Kwota";"Metoda";"Status";"Osoba";"Sprzedał(a)";"Uwagi";"Powód przyznania";"Kwota zwrotu";"Dzień odstąpienia"');
    expect(lines[1]).toBe('"SV-2026-000123";"18.11.2026, 09:05";"Karnet 10 wejść";"1200,00";"Online";"Opłacone";"Jan Kowalski";"";"";"";"";""');
    expect(lines[2]).toContain('"Na miejscu / gotówka";"Zwrócone";"Bez konta";"Anna";"Zwrot gotówki / na terminal";"";"1200,00";""');
  });

  it('cudzysłowy podwojone, formuły arkusza zneutralizowane', () => {
    expect(csvCell('Karnet "VIP"')).toBe('"Karnet ""VIP"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-10')).toBe(`"'-10"`);
  });

  it('nazwa pliku z zakresu dat', () => {
    expect(csvFileName(defaultFilters('2026-11-18'))).toBe('zamowienia-2026-11-01-2026-11-18.csv');
    expect(csvFileName({ ...defaultFilters('2026-11-18'), from: '', to: '' })).toBe('zamowienia.csv');
  });
});

describe('AC-25, AC-26: „Anuluj i zwróć”', () => {
  const TODAY = '2026-11-18';
  it('AC-25: opłacone bez zużycia — przycisk zwrotu', () => {
    expect(orderAction(order(), TODAY)).toEqual({ kind: 'refund', warning: false, noteRequired: false });
  });

  it('AC-26: uprawnienie używane — bez przycisku, informacja', () => {
    expect(orderAction(order({ pass_used: true }), TODAY)).toEqual({ kind: 'used' });
    expect(t('orders.passUsed')).toBe('Karnet był używany — zwrot poza systemem.');
  });

  it('AC-25: inne stany — bez akcji', () => {
    for (const status of ['pending', 'cancelled', 'refund_pending', 'refunded'] as const) {
      expect(orderAction(order({ status }), TODAY)).toBeNull();
    }
  });

  it('błędy zwrotu → komunikaty', () => {
    expect(refundErrorKey('pass_used')).toBe('orders.passUsed');
    expect(refundErrorKey('refund_failed')).toBe('orders.errorTpay');
    expect(refundErrorKey(undefined)).toBe('orders.errorGeneric');
  });
});

describe('SPEC-004 AC-14: dane do faktury po zakupie', () => {
  it('„Dodaj dane do faktury” tylko przy opłaconym zamówieniu bez faktury', () => {
    expect(invoiceAction(order())).toBe('add');
    expect(invoiceAction(order({ invoice_requested: true }))).toBe('requested');
    expect(invoiceAction(order({ status: 'refunded' }))).toBeNull();
    expect(invoiceAction(order({ status: 'pending' }))).toBeNull();
  });
});

describe('SPEC-010: prezent w zamówieniach', () => {
  const gift = (fields: Partial<AdminOrder> = {}) =>
    order({ payment_method: 'gift', amount: 0, seller_name: 'Admin Adamski', grant_reason: 'Nagroda — zawody X', ...fields });

  it('AC-14: filtr „Metoda” — Online, Na miejscu, Prezent; `gift` trafia do p_method', () => {
    expect(PAYMENT_METHODS.map((method) => t(PAYMENT_METHOD_TEXT[method]))).toEqual(['Online', 'Na miejscu', 'Prezent']);
    expect(filterArgs({ ...defaultFilters('2026-11-21'), method: 'gift' }).p_method).toBe('gift');
  });

  it('AC-14: lista — kwota 0,00 zł, metoda „Prezent”, „Kto” = admin; szczegóły z powodem i notatką anulowania', () => {
    expect(formatPrice(gift().amount)).toBe(`0,00${NBSP}zł`);
    expect(methodKeys(gift()).map((key) => t(key))).toEqual(['Prezent']);
    expect(gift().seller_name).toBe('Admin Adamski');
    expect(grantDetails(gift())).toEqual(['Powód: Nagroda — zawody X']);
    expect(grantDetails(gift({ status: 'cancelled', grant_cancel_note: 'Pomyłka' }))).toEqual([
      'Powód: Nagroda — zawody X',
      'Notatka anulowania: Pomyłka',
    ]);
    expect(grantDetails(order())).toEqual([]);
  });

  it('AC-14: CSV — metoda „Prezent”, kolumna „Powód przyznania” (pusta dla innych metod); suma bez zmian', () => {
    const lines = ordersCsv([gift(), order()], (key) => t(key)).replace('﻿', '').trimEnd().split('\r\n');
    expect(lines[0].endsWith('"Uwagi";"Powód przyznania";"Kwota zwrotu";"Dzień odstąpienia"')).toBe(true);
    expect(lines[1]).toContain('"0,00";"Prezent";"Opłacone";"Jan Kowalski";"Admin Adamski";"";"Nagroda — zawody X"');
    expect(lines[2].endsWith('"";""')).toBe(true);
    expect(ordersTotal([gift(), order()])).toBe(ordersTotal([order()]));
  });

  it('AC-17: prezent — bez „Anuluj i zwróć” i „Dodaj dane do faktury”', () => {
    expect(orderAction(gift(), '2026-11-18')).toBeNull();
    expect(orderAction(gift({ pass_used: true }), '2026-11-18')).toBeNull();
    expect(invoiceAction(gift())).toBeNull();
  });

  it('AC-18: „Anuluj przyznanie” przy opłaconym prezencie, także używanym; nie przy innych metodach', () => {
    expect(canCancelGrant(gift())).toBe(true);
    expect(canCancelGrant(gift({ pass_used: true }))).toBe(true);
    expect(canCancelGrant(order())).toBe(false);
    expect(t('orders.cancelGrantText')).toBe(
      'Karnet zostanie anulowany. Niewykorzystane wejścia i dni przepadają, historia wejść zostaje. Tej operacji nie można cofnąć.',
    );
  });

  it('AC-19: po anulowaniu — „Przyznanie anulowane.”', () => {
    expect(t('orders.grantCancelled')).toBe('Przyznanie anulowane.');
  });

  it('AC-21: anulowany prezent — bez przycisku; ponowne wywołanie → „Przyznanie zostało już anulowane.”', () => {
    expect(canCancelGrant(gift({ status: 'cancelled' }))).toBe(false);
    expect(t(grantCancelErrorKey('order_not_paid'))).toBe('Przyznanie zostało już anulowane.');
    expect(grantCancelErrorKey('invalid_note')).toBe('orders.grantNoteTooLong');
    expect(grantCancelErrorKey(null)).toBe('orders.grantCancelError');
  });
});

describe('SPEC-012 US-4: odstąpienie od umowy w panelu', () => {
  const TODAY = '2027-01-05';
  const inWindow = { refund_window_until: '2027-01-16', withdrawal_refund: 6667, amount: 10000 };

  it('AC-15: w oknie — „Odstąpienie od umowy” (także używany karnet) i „Odstąpienie możliwe do 16.01.2027”', () => {
    expect(orderAction(order(inWindow), TODAY)).toEqual({ kind: 'withdrawal', until: '2027-01-16', refund: 6667 });
    expect(orderAction(order({ ...inWindow, pass_used: true }), TODAY)?.kind).toBe('withdrawal');
    expect(orderAction(order(inWindow), '2027-01-16')?.kind).toBe('withdrawal');
    expect(t('orders.withdrawalUntil', { date: '16.01.2027' })).toBe('Odstąpienie możliwe do 16.01.2027');
  });

  it('AC-16, AC-17: wyliczenie — „Cena 100,00 zł, wykorzystano 1 z 3 wejść (33,33 zł). Zwrot: 66,67 zł.”', () => {
    expect(withdrawalQuoteText({ amount: 10000, used: 1, total: 3, used_value: 3333, refund_amount: 6667 })).toBe(
      `Cena 100,00${NBSP}zł, wykorzystano 1 z 3 wejść (33,33${NBSP}zł). Zwrot: 66,67${NBSP}zł.`,
    );
    expect(withdrawalQuoteText({ amount: 5000, used: 0, total: 1, used_value: 0, refund_amount: 5000 })).toBe(
      `Cena 50,00${NBSP}zł, bez wykorzystania. Zwrot: 50,00${NBSP}zł.`,
    );
  });

  it('AC-18: zwrot 0 zł — przycisk nieaktywny z informacją', () => {
    expect(orderAction(order({ ...inWindow, withdrawal_refund: 0, pass_used: true }), TODAY)).toEqual({ kind: 'done' });
    expect(t('orders.withdrawalDone')).toBe('Usługa wykonana w całości — prawo odstąpienia wygasło.');
    expect(refundErrorKey('withdrawal_nothing_to_refund')).toBe('orders.withdrawalDone');
  });

  it('AC-21: po oknie — „Anuluj i zwróć” z ostrzeżeniem i wymaganą notatką; używany — bez zmian', () => {
    expect(orderAction(order({ refund_window_until: '2027-01-04' }), TODAY)).toEqual({ kind: 'refund', warning: true, noteRequired: true });
    expect(orderAction(order({ ...inWindow, refund_window_until: '2027-01-04' }), TODAY)?.kind).toBe('refund');
    expect(orderAction(order({ refund_window_until: '2027-01-04', pass_used: true }), TODAY)).toEqual({ kind: 'used' });
    expect(t('orders.lateWarning')).toBe(
      'Minęło 14 dni od zakupu. Regulamin nie przewiduje zwrotu — zwróć tylko w uzasadnionym przypadku (np. reklamacja).',
    );
    expect(isRefundNoteValid(' ab ')).toBe(false);
    expect(isRefundNoteValid('Reklamacja')).toBe(true);
    expect(isRefundNoteValid('x'.repeat(301))).toBe(false);
    expect(refundErrorKey('refund_note_required')).toBe('orders.refundNoteRequired');
  });

  it('AC-22: wejściówka i sprzedaż na miejscu — bez odstąpienia; na miejscu w oknie — notatka wymagana bez ostrzeżenia', () => {
    expect(orderAction(order({ pass_kind: 'event_ticket' }), TODAY)).toEqual({ kind: 'refund', warning: false, noteRequired: false });
    expect(orderAction(order({ payment_method: 'on_site', on_site_method: 'cash', refund_window_until: '2027-01-16' }), TODAY))
      .toEqual({ kind: 'refund', warning: false, noteRequired: true });
  });

  it('AC-55: karnet czasowy w oknie — „Anuluj i zwróć” bez ostrzeżenia; aktywowany — zwrot poza systemem', () => {
    const days: Partial<AdminOrder> = { pass_kind: 'days', refund_window_until: '2027-01-16', withdrawal_refund: null };
    expect(orderAction(order(days), TODAY)).toEqual({ kind: 'refund', warning: false, noteRequired: false });
    expect(orderAction(order({ ...days, pass_used: true }), TODAY)).toEqual({ kind: 'used' });
  });

  it('AC-52: zwrot po odstąpieniu odrzucony — „Ponów zwrot” tej samej kwoty', () => {
    const failed = order({ withdrawal_on: '2027-01-04', refund_amount: 6667, pass_used: true });
    expect(orderAction(failed, '2027-02-01')).toEqual({ kind: 'retry', refund: 6667 });
  });

  it('AC-20: status „Zwrócone 66,67 zł z 100,00 zł” / „Zwrot w toku: 66,67 zł”, suma zwrotów, CSV', () => {
    const partial = order({ amount: 10000, refund_amount: 6667, status: 'refunded', withdrawal_on: '2027-01-04' });
    expect(orderStatusText(partial)).toBe(`Zwrócone 66,67${NBSP}zł z 100,00${NBSP}zł`);
    expect(orderStatusText({ ...partial, status: 'refund_pending' })).toBe(`Zwrot w toku: 66,67${NBSP}zł`);
    expect(orderStatusText(order({ amount: 10000, refund_amount: 10000, status: 'refunded' }))).toBe('Zwrócone');
    expect(refundsTotal([partial, order({ amount: 5000, status: 'refunded' }), order()])).toBe(11667);
    expect(t('orders.summaryRefunds', { amount: formatPrice(6667) })).toBe(`Zwroty: −66,67${NBSP}zł`);
    const line = ordersCsv([partial], (key) => t(key)).trimEnd().split('\r\n')[1];
    expect(line).toContain(`"Zwrócone 66,67${NBSP}zł z 100,00${NBSP}zł"`);
    expect(line.endsWith('"66,67";"4.01.2027"')).toBe(true);
  });
});

describe('SPEC-012 AC-49, AC-52: zgłoszenia odstąpienia z konta w panelu', () => {
  const TODAY = '2027-01-06';
  const requested: Partial<AdminOrder> = {
    payment_method: 'tpay',
    amount: 10000,
    refund_amount: 6667,
    withdrawal_on: '2027-01-05',
    withdrawal_submitted_at: '2027-01-05T09:15:00Z',
  };

  it('AC-49: „Odstąpienie zgłoszone 5.01.2027 — zwróć do 19.01.2027” i „Zleć zwrot” kwoty ze zgłoszenia', () => {
    expect(orderAction(order(requested), TODAY)).toEqual({ kind: 'request', submitted: '2027-01-05', until: '2027-01-19', refund: 6667 });
    expect(t('orders.requestNote', { date: '5.01.2027', until: '19.01.2027' })).toBe('Odstąpienie zgłoszone 5.01.2027 — zwróć do 19.01.2027');
    expect(t('orders.requestRefund')).toBe('Zleć zwrot');
  });

  it('AC-49: zgłoszenie po 23:00 UTC liczone w Europe/Warsaw', () => {
    expect(orderAction(order({ ...requested, withdrawal_submitted_at: '2027-01-04T23:30:00Z' }), TODAY)).toMatchObject({
      submitted: '2027-01-05',
      until: '2027-01-19',
    });
  });

  it('AC-52: nieudany zwrot zgłoszenia — „Ponów zwrot” tej samej kwoty', () => {
    expect(orderAction(order({ ...requested, withdrawal_processed_at: '2027-01-06T10:00:00Z' }), TODAY)).toEqual({
      kind: 'retry',
      refund: 6667,
    });
  });

  it('AC-49: filtr „Zgłoszone odstąpienia”', () => {
    expect(t('orders.statusWithdrawalRequested')).toBe('Zgłoszone odstąpienia');
    expect(filterArgs({ from: '', to: '', status: 'withdrawal_requested', method: '', item: '', person: '' }).p_status)
      .toBe('withdrawal_requested');
  });
});
