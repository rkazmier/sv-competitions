/**
 * Odwołanie wydarzenia w panelu (SPEC-012 US-5: AC-23, AC-24, AC-26, AC-29, AC-51) — logika bez DOM.
 * Daty to dni `YYYY-MM-DD` (Europe/Warsaw) — porównanie leksykograficzne jest poprawne.
 */
import type { MessageKey } from '../i18n';

export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 200;
/** Edge Function: odwołanie (`cancel_calendar_event`) i zwroty Tpay. */
export const EVENT_CANCEL_FUNCTION = 'event-cancel';

export interface CancellableEvent {
  status: 'draft' | 'published';
  starts_on: string;
  ends_on: string | null;
  cancelled_at: string | null;
}

/** AC-23, AC-29: przycisk tylko dla opublikowanego, nieodwołanego wydarzenia, którego ostatni dzień nie minął (każdy tryb). */
export function canCancelEvent(event: CancellableEvent, today: string): boolean {
  return event.status === 'published' && !event.cancelled_at && (event.ends_on ?? event.starts_on) >= today;
}

/** AC-23: powód odwołania 3–200 znaków (po przycięciu, jak `check` w bazie). */
export function isCancelReasonValid(reason: string): boolean {
  const length = [...reason.trim()].length;
  return length >= CANCEL_REASON_MIN && length <= CANCEL_REASON_MAX;
}

/** AC-23: liczby w oknie potwierdzenia — opłacone wejściówki online (N) i na miejscu (M). */
export function cancelCounts(orders: readonly { status: string; payment_method: string }[]): { online: number; onSite: number } {
  const paid = orders.filter((o) => o.status === 'paid');
  return {
    online: paid.filter((o) => o.payment_method === 'tpay').length,
    onSite: paid.filter((o) => o.payment_method === 'on_site').length,
  };
}

/** Wiersz `admin_event_refunds` (AC-26). */
export interface EventRefund {
  order_id: string;
  order_number: string;
  person_name: string | null;
  has_account: boolean;
  payment_method: 'tpay' | 'on_site';
  amount: number;
  refund_amount: number | null;
  status: 'paid' | 'refund_pending' | 'refunded';
  refund_requested_at: string | null;
}

export type RefundState = 'pending' | 'refunded' | 'onSite' | 'failed';

/**
 * AC-26, AC-28, AC-51: na miejscu — „Do zwrotu na miejscu”; Tpay `refund_pending` — „Zwrot w toku”, `refunded` — „Zwrócone”,
 * `paid` (Tpay odrzucił zwrot albo wpłata po odwołaniu) — „Zwrot Tpay nieudany — Ponów zwrot”.
 */
export function refundState(row: Pick<EventRefund, 'payment_method' | 'status'>): RefundState {
  if (row.payment_method === 'on_site') return 'onSite';
  if (row.status === 'paid') return 'failed';
  return row.status === 'refunded' ? 'refunded' : 'pending';
}

export const REFUND_STATE_KEYS: Record<RefundState, MessageKey> = {
  pending: 'eventCancel.statePending',
  refunded: 'eventCancel.stateRefunded',
  onSite: 'eventCancel.stateOnSite',
  failed: 'eventCancel.stateFailed',
};

const CANCEL_ERRORS: Record<string, MessageKey> = {
  invalid_cancel_reason: 'eventCancel.reasonInvalid',
  invalid_request: 'eventCancel.reasonInvalid',
  event_already_cancelled: 'eventCancel.errorAlreadyCancelled',
  event_ended: 'eventCancel.errorEnded',
  event_not_published: 'eventCancel.errorNotPublished',
};

/** Kod błędu `event-cancel` → komunikat (inne — ogólny). */
export function cancelErrorKey(code: string | null | undefined): MessageKey {
  return CANCEL_ERRORS[code ?? ''] ?? 'eventCancel.error';
}
