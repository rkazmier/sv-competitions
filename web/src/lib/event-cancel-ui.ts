/**
 * Wyspa odwołania wydarzenia w `/panel/wydarzenia/edytuj/` (SPEC-012 US-5: AC-23, AC-24, AC-26, AC-29, AC-51).
 * „Odwołaj wydarzenie” → okno z liczbą wejściówek (AC-23) → Edge Function `event-cancel` → przebudowa strony (AC-24).
 * Odwołane: lista „Zwroty po odwołaniu” (`admin_event_refunds`) z „Ponów zwrot” = „Anuluj i zwróć” (`payments-refund`).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { todayInWarsaw } from './calendar';
import {
  cancelCounts,
  cancelErrorKey,
  canCancelEvent,
  EVENT_CANCEL_FUNCTION,
  isCancelReasonValid,
  REFUND_STATE_KEYS,
  refundState,
  type CancellableEvent,
  type EventRefund,
} from './event-cancel';
import { functionErrorCode } from './orders-admin-ui';
import { formatPrice } from './products';

export interface EventCancelOptions {
  root: HTMLElement;
  supabase: SupabaseClient;
  /** Komunikat w polu stanu formularza (`role="status"`). */
  announce: (message: string) => void;
  /** Po odwołaniu: ponowne wczytanie wydarzenia i przebudowa strony; `message` — opis wyniku. */
  onCancelled: (message: string) => Promise<void>;
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export function mountEventCancel({ root, supabase, announce, onCancelled }: EventCancelOptions) {
  const section = query<HTMLElement>(root, '[data-cancel-section]');
  const openButton = query<HTMLButtonElement>(section, '[data-cancel-open]');
  const dialog = query<HTMLDialogElement>(root, '[data-cancel-dialog]');
  const dialogText = query<HTMLElement>(dialog, '[data-cancel-text]');
  const reason = query<HTMLTextAreaElement>(dialog, '[data-cancel-reason]');
  const reasonError = query<HTMLElement>(dialog, '[data-cancel-reason-error]');
  const refunds = query<HTMLElement>(root, '[data-refunds]');
  const rows = query<HTMLElement>(refunds, '[data-refund-rows]');
  const empty = query<HTMLElement>(refunds, '[data-refunds-empty]');
  const template = query<HTMLTemplateElement>(refunds, '[data-refund-template]');
  let eventId: string | null = null;

  function showReasonError(show: boolean): void {
    reasonError.textContent = show ? t('eventCancel.reasonInvalid') : '';
    reasonError.hidden = !show;
    if (show) reason.setAttribute('aria-invalid', 'true');
    else reason.removeAttribute('aria-invalid');
  }

  // AC-23: liczby N i M z opłaconych zamówień wydarzenia (admin_list_orders).
  openButton.addEventListener('click', async () => {
    if (!eventId) return;
    announce('');
    openButton.disabled = true;
    const { data, error } = await supabase.rpc('admin_list_orders', { p_event_id: eventId });
    openButton.disabled = false;
    if (error) return announce(t('eventCancel.error'));
    dialogText.textContent = t('eventCancel.dialogText', cancelCounts((data ?? []) as { status: string; payment_method: string }[]));
    reason.value = '';
    showReasonError(false);
    dialog.showModal();
  });

  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'confirm' && eventId) void cancel(eventId, reason.value.trim());
  });
  // Walidacja przed zamknięciem okna: błędny powód — okno zostaje otwarte z komunikatem.
  query<HTMLButtonElement>(dialog, '[data-cancel-confirm]').addEventListener('click', (e) => {
    if (isCancelReasonValid(reason.value)) return;
    e.preventDefault();
    showReasonError(true);
    reason.focus();
  });

  async function cancel(id: string, text: string): Promise<void> {
    announce(t('eventCancel.cancelling'));
    openButton.disabled = true;
    try {
      const result = await supabase.functions.invoke<{ refunds?: { requested: number; failed: number }; summary?: { online?: number } }>(
        EVENT_CANCEL_FUNCTION,
        { body: { event_id: id, reason: text } },
      );
      if (result.error) {
        openButton.disabled = false;
        return announce(t(cancelErrorKey(await functionErrorCode(result.error))));
      }
      const refundsResult = result.data?.refunds;
      const online = result.data?.summary?.online ?? 0;
      const message = online > 0 && refundsResult
        ? `${t('eventCancel.done')} ${t('eventCancel.refundsQueued', { requested: refundsResult.requested, failed: refundsResult.failed })}`
        : t('eventCancel.done');
      await onCancelled(message);
    } catch {
      openButton.disabled = false;
      announce(t('eventCancel.error'));
    }
  }

  // AC-26: lista zwrotów; „Ponów zwrot” (AC-51) — zwrot pełnej kwoty przez `payments-refund` (`cancel_order`).
  async function loadRefunds(id: string): Promise<void> {
    const { data, error } = await supabase.rpc('admin_event_refunds', { p_event_id: id });
    if (error) return announce(t('panel.loadError'));
    const list = (data ?? []) as EventRefund[];
    rows.replaceChildren(
      ...list.map((row) => {
        const fragment = template.content.cloneNode(true) as DocumentFragment;
        const tr = query<HTMLTableRowElement>(fragment, 'tr');
        query<HTMLElement>(tr, '[data-person]').textContent = row.has_account
          ? (row.person_name ?? '')
          : t('eventCancel.noAccount');
        query<HTMLElement>(tr, '[data-number]').textContent = row.order_number;
        query<HTMLElement>(tr, '[data-method]').textContent = t(
          row.payment_method === 'tpay' ? 'eventCancel.methodTpay' : 'eventCancel.methodOnSite',
        );
        query<HTMLElement>(tr, '[data-amount]').textContent = formatPrice(row.refund_amount ?? row.amount);
        const state = refundState(row);
        query<HTMLElement>(tr, '[data-state]').textContent = t(REFUND_STATE_KEYS[state]);
        const retry = query<HTMLButtonElement>(tr, '[data-retry]');
        retry.hidden = state !== 'failed';
        retry.addEventListener('click', () => void retryRefund(row, retry));
        return tr;
      }),
    );
    empty.hidden = list.length > 0;
  }

  async function retryRefund(row: EventRefund, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    announce(t('eventCancel.retrying'));
    let ok: boolean;
    try {
      const result = await supabase.functions.invoke('payments-refund', { body: { order_id: row.order_id } });
      ok = !result.error;
    } catch {
      ok = false;
    }
    announce(t(ok ? 'eventCancel.retried' : 'eventCancel.retryError'));
    if (eventId) await loadRefunds(eventId);
  }

  /** Stan sekcji dla wczytanego wydarzenia (AC-23, AC-26, AC-29). */
  async function render(event: (CancellableEvent & { id: string }) | null): Promise<void> {
    eventId = event?.id ?? null;
    section.hidden = !event || !canCancelEvent(event, todayInWarsaw());
    openButton.disabled = false;
    refunds.hidden = !event?.cancelled_at;
    if (event?.cancelled_at) await loadRefunds(event.id);
  }

  return { render };
}
