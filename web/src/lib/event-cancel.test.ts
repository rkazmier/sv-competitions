import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { eventEntry } from './competition-page';
import {
  cancelCounts,
  cancelErrorKey,
  canCancelEvent,
  isCancelReasonValid,
  REFUND_STATE_KEYS,
  refundState,
} from './event-cancel';

const event = { status: 'published' as const, starts_on: '2027-03-14', ends_on: '2027-03-15', cancelled_at: null };

describe('odwołanie wydarzenia (SPEC-012 US-5)', () => {
  it('AC-23, AC-29: „Odwołaj wydarzenie” tylko dla opublikowanego, nieodwołanego i niezakończonego', () => {
    expect(canCancelEvent(event, '2027-03-01')).toBe(true);
    expect(canCancelEvent(event, '2027-03-15')).toBe(true); // trwające — ostatni dzień
    expect(canCancelEvent(event, '2027-03-16')).toBe(false); // zakończone
    expect(canCancelEvent({ ...event, ends_on: null }, '2027-03-15')).toBe(false);
    expect(canCancelEvent({ ...event, status: 'draft' }, '2027-03-01')).toBe(false);
    expect(canCancelEvent({ ...event, cancelled_at: '2027-03-02T10:00:00Z' }, '2027-03-01')).toBe(false);
  });

  it('AC-23: powód odwołania 3–200 znaków po przycięciu', () => {
    expect(isCancelReasonValid('  ab ')).toBe(false);
    expect(isCancelReasonValid('abc')).toBe(true);
    expect(isCancelReasonValid('ż'.repeat(200))).toBe(true);
    expect(isCancelReasonValid('x'.repeat(201))).toBe(false);
  });

  it('AC-23: tekst okna z liczbą wejściówek online (N) i na miejscu (M)', () => {
    const counts = cancelCounts([
      { status: 'paid', payment_method: 'tpay' },
      { status: 'paid', payment_method: 'tpay' },
      { status: 'pending', payment_method: 'tpay' },
      { status: 'paid', payment_method: 'on_site' },
      { status: 'paid', payment_method: 'gift' },
      { status: 'refunded', payment_method: 'on_site' },
    ]);
    expect(counts).toEqual({ online: 2, onSite: 1 });
    expect(t('eventCancel.dialogText', counts)).toBe(
      'Wydarzenie zostanie oznaczone jako odwołane. Wszystkie wejściówki zostaną anulowane, a pieniądze zwrócone: ' +
        'online — automatycznie przez Tpay (2), na miejscu — lista do zwrotu (1). Kupujący z kontem dostaną e-mail. ' +
        'Tej operacji nie można cofnąć.',
    );
    expect(t('eventCancel.reasonLabel')).toBe('Powód odwołania (widoczny publicznie) *');
    expect(t('eventCancel.reasonHint')).toBe('Nie wpisuj danych osobowych.');
  });

  it('AC-26, AC-28, AC-51: stany listy „Zwroty po odwołaniu”', () => {
    const label = (payment_method: 'tpay' | 'on_site', status: 'paid' | 'refund_pending' | 'refunded') =>
      t(REFUND_STATE_KEYS[refundState({ payment_method, status })]);
    expect(label('tpay', 'refund_pending')).toBe('Zwrot w toku');
    expect(label('tpay', 'refunded')).toBe('Zwrócone');
    expect(label('on_site', 'refunded')).toBe('Do zwrotu na miejscu');
    expect(label('tpay', 'paid')).toBe('Zwrot Tpay nieudany');
    expect(refundState({ payment_method: 'tpay', status: 'paid' })).toBe('failed');
    expect(t('eventCancel.retry')).toBe('Ponów zwrot');
    expect(t('eventCancel.noAccount')).toBe('Osoba bez konta');
  });

  it('AC-23, AC-29: błędy odwołania → komunikaty', () => {
    expect(t(cancelErrorKey('event_already_cancelled'))).toBe('To wydarzenie jest już odwołane.');
    expect(t(cancelErrorKey('event_ended'))).toBe('Wydarzenie już się zakończyło — nie można go odwołać.');
    expect(t(cancelErrorKey('invalid_cancel_reason'))).toBe('Powód odwołania musi mieć od 3 do 200 znaków.');
    expect(t(cancelErrorKey(null))).toBe('Nie udało się odwołać wydarzenia. Spróbuj ponownie.');
    expect(t('eventCancel.eventCancelled')).toBe('Wydarzenie zostało odwołane.');
  });

  it('AC-25: karta odwołanego wydarzenia — powód zamiast ceny i limitu', () => {
    const row = {
      id: 'e1',
      name: 'Piknik',
      starts_on: '2027-03-14',
      ends_on: null,
      description: null,
      external_url: null,
      status: 'published' as const,
      access_mode: 'paid' as const,
      ticket_price: 5000,
      capacity: 10,
      category: { name: 'Pikniki' },
    };
    expect(eventEntry(row)).toMatchObject({ ticketPrice: 5000, capacity: 10 });
    const cancelled = eventEntry({ ...row, cancelled_at: '2027-03-01T10:00:00Z', cancel_reason: 'Awaria' });
    expect(cancelled.cancelReason).toBe('Awaria');
    expect(cancelled.ticketPrice).toBeUndefined();
    expect(cancelled.capacity).toBeUndefined();
    expect(t('calendarCard.cancelReason', { reason: 'Awaria' })).toBe('Powód: Awaria');
  });
});
