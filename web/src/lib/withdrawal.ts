/**
 * SPEC-012 US-9 (AC-46…AC-50, AC-55): „Odstąp od umowy” w `/konto/` — logika bez DOM.
 * Dane z `rpc/my_withdrawals` (tylko zamówienia z odstąpieniem możliwym dziś albo już zgłoszonym).
 */
import { t, type MessageKey } from '../i18n';
import { withdrawalQuoteText } from './orders-admin';
import { shortDay } from './sales-terms';

/** Wiersz `my_withdrawals()`: `submitted_at = null` — odstąpienie możliwe dziś (zwrot > 0). */
export interface MyWithdrawal {
  order_id: string;
  paid_on: string;
  last_day: string;
  amount: number;
  used: number;
  total: number;
  used_value: number;
  refund_amount: number;
  submitted_at: string | null;
}

export const COMMENT_MAX = 500;

/** AC-47: „Odstępuję od umowy zakupu <produkt> (zamówienie <numer>, opłacone <data>).” */
export function withdrawalStatement(item: string, number: string, paidOn: string): string {
  return t('offer.withdrawStatement', { item, number, date: shortDay(paidOn) });
}

/** AC-47 (AC-16): wyliczenie zwrotu na dziś — jak w panelu. */
export const withdrawalQuote = (w: Pick<MyWithdrawal, 'amount' | 'used' | 'total' | 'used_value' | 'refund_amount'>): string =>
  withdrawalQuoteText(w);

export const isCommentValid = (comment: string) => comment.trim().length <= COMMENT_MAX;

const ERRORS: Record<string, MessageKey> = {
  withdrawal_exists: 'offer.withdrawExists',
  withdrawal_window_closed: 'offer.withdrawWindowClosed',
  withdrawal_nothing_to_refund: 'offer.withdrawNothing',
  withdrawal_not_available: 'offer.withdrawNotAvailable',
  order_not_paid: 'offer.withdrawNotAvailable',
  invalid_comment: 'offer.withdrawCommentTooLong',
};

/** AC-50: błąd `submit_withdrawal` → komunikat. */
export function withdrawalErrorKey(message: string | null | undefined): MessageKey {
  return (message && ERRORS[message]) || 'offer.withdrawError';
}
