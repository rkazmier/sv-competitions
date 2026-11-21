/**
 * Wyspy Oferty (SPEC-003 US-2, US-3): `/oferta/` (AC-5, AC-6), `/oferta/zamowienie/` (AC-7, AC-8 — wywołanie
 * `payments-create`), `/konto/platnosc/` (AC-10) i sekcje karnetów i płatności w `/konto/` (AC-12…AC-15).
 * Logika bez DOM: lib/offer.ts. Teksty z bazy trafiają do DOM tylko przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t, type MessageKey } from '../i18n';
import { LOGIN_PAGE, withNext } from './auth';
import { todayInWarsaw } from './calendar';
import { formatDate, formatDateRange } from './dates';
import { formatDateTime, formatDay } from './admin-users';
import {
  OFFER_COLUMNS,
  ORDER_COLUMNS,
  PASS_COLUMNS,
  PAYMENT_METHOD_TEXT,
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_STATUS_PAGE,
  buyHref,
  eventOrderPath,
  firstUsedOn,
  idParam,
  orderPath,
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
import { PRODUCT_KINDS, formatPrice, groupProducts, type Product } from './products';
import { entryPassText, usageHistory, type MyRangeEntry } from './range-history';
import { BILLING_COLUMNS, invoiceStatus, type InvoiceDetails } from './invoice';
import { bindInvoiceFields } from './invoice-ui';
import { functionErrorCode, getSupabase } from './supabase';

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

function client(): SupabaseClient | null {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function notes(product: Product): HTMLElement[] {
  return productNotes(product).map((key) => node('p', t(key), 'hint'));
}

// ===== /oferta/ =====

/** AC-5, AC-6: produkty w grupach, pobierane w przeglądarce (ceny zawsze aktualne). */
export async function mountOffer(root: HTMLElement): Promise<void> {
  const loading = el(root, '[data-loading]');
  const fail = () => {
    loading.hidden = true;
    el(root, '[data-load-error]').hidden = false;
  };
  const supabase = client();
  if (!supabase) return fail();
  const [{ data: session }, { data, error }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from('products').select(OFFER_COLUMNS).eq('is_active', true),
  ]);
  if (error || !data) return fail();
  const signedIn = Boolean(session.session);
  const groups = groupProducts(data as Product[]);
  for (const kind of PRODUCT_KINDS) {
    const list = el(root, `[data-group="${kind}"]`);
    el(root, `[data-empty="${kind}"]`).hidden = groups[kind].length > 0;
    list.replaceChildren(
      ...groups[kind].map((product) => {
        const item = node('li', undefined, 'card offer-item');
        const name = node('h3', product.name);
        const price = node('p', formatPrice(product.price), 'offer-price');
        const buy = node('a', t('offer.buy'), 'button button-primary');
        buy.href = buyHref(product.id, signedIn);
        buy.setAttribute('aria-label', t('offer.buyLabel', { name: product.name }));
        const description = product.description ? [node('p', product.description)] : [];
        item.append(name, price, ...description, ...notes(product), buy);
        return item;
      }),
    );
  }
  loading.hidden = true;
  el(root, '[data-groups]').hidden = false;
}

// ===== /oferta/zamowienie/ =====

interface OrderItem {
  name: string;
  price: number;
  notes: HTMLElement[];
}

/** Wejściówka (AC-17…AC-19): tylko opublikowane wydarzenie płatne; sprzedaż do ostatniego dnia, limit miejsc. */
async function loadTicket(supabase: SupabaseClient, eventId: string): Promise<OrderItem | string> {
  const { data, error } = await supabase
    .from('calendar_events')
    .select('id, name, starts_on, ends_on, ticket_price')
    .eq('id', eventId)
    .eq('status', 'published')
    .eq('access_mode', 'paid')
    .maybeSingle<{ id: string; name: string; starts_on: string; ends_on: string | null; ticket_price: number | null }>();
  if (error) return t('offer.loadError');
  if (!data?.ticket_price) return t('offer.unavailable');
  const seats = await supabase.rpc('event_seats_left', { p_event_id: eventId });
  const sale = ticketSale(data.ends_on ?? data.starts_on, todayInWarsaw(), typeof seats.data === 'number' ? seats.data : null);
  if (sale === 'closed') return t('calendarCard.salesClosed');
  if (sale === 'soldOut') return t('offer.soldOut');
  const dates = formatDateRange(data.starts_on, data.ends_on);
  return {
    name: t('offer.ticketName', { name: data.name }),
    price: data.ticket_price,
    notes: [node('p', t('offer.ticketValidity', { dates }), 'hint')],
  };
}

const PAY_ERRORS: Record<string, MessageKey> = {
  product_unavailable: 'offer.unavailable',
  event_unavailable: 'offer.unavailable',
  sold_out: 'offer.soldOut',
  sales_closed: 'calendarCard.salesClosed',
  invalid_invoice: 'invoice.invalidDetails',
};

/** AC-7: podsumowanie produktu albo wejściówki (AC-17); AC-8: „Zapłać” → `payments-create` → bramka Tpay. */
export async function mountOrder(root: HTMLElement): Promise<void> {
  const loading = el(root, '[data-loading]');
  const message = el(root, '[data-message]');
  const stop = (text: string) => {
    loading.hidden = true;
    message.textContent = text;
    message.hidden = false;
  };
  const supabase = client();
  const params = new URLSearchParams(window.location.search);
  const productId = idParam(params.get('product'));
  const eventId = productId ? null : idParam(params.get('event'));
  if (!supabase || !(productId || eventId)) return stop(t('offer.unavailable'));
  const { data: session } = await supabase.auth.getSession();
  const path = productId ? orderPath(productId) : eventOrderPath(eventId!);
  if (!session.session) return window.location.replace(withNext(LOGIN_PAGE, path));

  // Cena zawsze świeża z bazy (§7: zmiana ceny między wyświetleniem a zapłatą); ukryty produkt — RLS go nie zwraca.
  let item: OrderItem | string;
  if (productId) {
    const { data, error } = await supabase.from('products').select(OFFER_COLUMNS).eq('id', productId).eq('is_active', true).maybeSingle<Product>();
    item = error ? t('offer.loadError') : data ? { name: data.name, price: data.price, notes: notes(data) } : t('offer.unavailable');
  } else {
    item = await loadTicket(supabase, eventId!);
  }
  if (typeof item === 'string') return stop(item);
  const data = item;

  el(root, '[data-product-name]').textContent = data.name;
  el(root, '[data-product-price]').textContent = formatPrice(data.price);
  el(root, '[data-product-notes]').replaceChildren(...data.notes);
  const form = el<HTMLFormElement>(root, 'form[data-order]');
  const pay = el<HTMLButtonElement>(form, '[data-pay]');
  pay.textContent = t('offer.pay', { amount: formatPrice(data.price) });

  // SPEC-004 AC-1: zapisane `billing_details` jako podpowiedź (RLS: własny wiersz). AC-6: „Zapłać” nieaktywny,
  // dopóki zaznaczona faktura nie ma potwierdzonych danych.
  const payHint = el(form, '[data-pay-hint]');
  const invoice = bindInvoiceFields(form, supabase, (control) => {
    const blocked = control.wanted() && !control.value();
    pay.disabled = blocked;
    payHint.hidden = !blocked;
  });
  const billing = await supabase.from('billing_details').select(BILLING_COLUMNS).eq('user_id', session.session.user.id).maybeSingle<InvoiceDetails>();
  invoice.setSaved(billing.data ?? null);
  loading.hidden = true;
  form.hidden = false;

  const terms = el<HTMLInputElement>(form, '#o-terms');
  const termsError = el(form, '[data-terms-error]');
  const formError = el(form, '[data-form-error]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.hidden = true;
    termsError.hidden = terms.checked;
    terms.setAttribute('aria-invalid', String(!terms.checked));
    if (!terms.checked) return terms.focus();
    const details = invoice.wanted() ? invoice.value() : null;
    if (invoice.wanted() && !details) return;

    // §7: blokada przycisku + klucz idempotencji żądania — podwójne kliknięcie = jedno zamówienie.
    pay.disabled = true;
    el(form, '[data-paying]').hidden = false;
    let code: string | null = null;
    try {
      const result = await supabase.functions.invoke<{ order_id: string; payment_url: string }>('payments-create', {
        body: {
          ...(productId ? { product_id: productId } : { event_id: eventId }),
          request_key: crypto.randomUUID(),
          // AC-5: kopia danych w zamówieniu i nadpisanie `billing_details` (zapis po stronie `payments-create`).
          ...(details ? { invoice: details } : {}),
        },
      });
      if (!result.error && result.data?.payment_url) return window.location.assign(result.data.payment_url);
      code = await functionErrorCode(result.error);
    } catch {
      // błąd sieci — komunikat ogólny
    }
    pay.disabled = false;
    el(form, '[data-paying]').hidden = true;
    formError.textContent = t((code && PAY_ERRORS[code]) || 'offer.payError');
    formError.hidden = false;
  });
}

// ===== /konto/platnosc/ =====

/** AC-10: stan zamówienia co 3 s przez maks. 60 s. */
export async function mountPaymentStatus(root: HTMLElement): Promise<void> {
  const status = el(root, '[data-payment-status]');
  const number = el(root, '[data-payment-order]');
  const show = (text: string, done = false) => {
    status.textContent = text;
    el(root, '[data-account-link]').hidden = !done;
  };
  const supabase = client();
  const orderId = idParam(new URLSearchParams(window.location.search).get('order'));
  if (!supabase || !orderId) return show(t('offer.paymentNotFound'), true);
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) {
    return window.location.replace(withNext(LOGIN_PAGE, `${PAYMENT_STATUS_PAGE}?order=${orderId}`));
  }

  const started = Date.now();
  const check = async (): Promise<void> => {
    const { data, error } = await supabase.from('orders').select('status, order_number').eq('id', orderId)
      .maybeSingle<{ status: string; order_number: string }>();
    if (!error && !data) return show(t('offer.paymentNotFound'), true);
    // SPEC-006 AC-13: „Zamówienie SV-2026-000123”.
    if (data) number.textContent = t('offer.paymentOrder', { number: data.order_number });
    number.hidden = !data;
    const view = paymentView(error ? 'pending' : data!.status, Date.now() - started);
    if (view === 'waiting') {
      show(t('offer.paymentWaiting'));
      window.setTimeout(() => void check(), PAYMENT_POLL_INTERVAL_MS);
      return;
    }
    show(t(view === 'paid' ? 'offer.paymentPaid' : 'offer.paymentSlow'), true);
  };
  await check();
}

// ===== /konto/ — karnety i płatności =====

function passItem(pass: UserPass, active: boolean): HTMLLIElement {
  const item = node('li', undefined, 'card pass-item');
  const lines: string[] = [];
  if (pass.kind === 'entries') {
    lines.push(t('offer.entriesLeft', { left: pass.entries_left ?? 0, total: pass.entries_total ?? 0 }));
  }
  const first = firstUsedOn(pass);
  if (pass.kind === 'days' && !pass.first_used_on) {
    lines.push(t('offer.notActivated'));
  } else {
    lines.push(first ? t('offer.firstUsed', { date: formatDate(first) }) : t('offer.notUsedYet'));
  }
  lines.push(t('offer.validTo', { date: formatDate(passValidTo(pass)) }));
  item.append(node('h3', pass.orders?.item_name ?? ''));
  if (!active) item.append(node('p', t(passHistoryState(pass)), 'tag'));
  item.append(...lines.map((line) => node('p', line)));
  // SPEC-005 AC-25: historia zużycia (data, godzina) po rozwinięciu karnetu.
  const usages = usageHistory(pass.pass_usages);
  if (usages.length > 0) {
    const details = node('details', undefined, 'pass-history');
    const list = node('ul');
    list.append(...usages.map((usage) => node('li', formatDateTime(usage.created_at))));
    details.append(node('summary', t('rangeHistory.usageTitle')), list);
    item.append(details);
  }
  return item;
}

/** SPEC-005 AC-24: „Historia wejść” — własne wpisy (`my_range_entries`, bez podpisu), od najnowszych. */
function entryRow(entry: MyRangeEntry): HTMLTableRowElement {
  const row = node('tr');
  const pass = entryPassText(entry);
  row.append(
    node('td', formatDateTime(entry.entered_at)),
    node('td', entry.range_officer_name),
    node('td', 'text' in pass ? pass.text : t(pass.key)),
  );
  return row;
}

function orderRow(order: UserOrder): HTMLTableRowElement {
  const row = node('tr');
  const status = node('td', t(orderStatusKey(order)));
  // SPEC-004 AC-7: „Faktura: w przygotowaniu” / „Faktura: <numer>” (bez pliku — faktura przez KSeF).
  const invoice = invoiceStatus(order);
  if (invoice) status.append(node('span', t(invoice.key, 'number' in invoice ? { number: invoice.number } : {}), 'invoice-status'));
  // SPEC-006 AC-12: „Nr: SV-2026-000123” przy pozycji.
  const item = node('td', order.item_name);
  item.append(node('span', t('offer.orderNumber', { number: order.order_number }), 'order-number order-ref'));
  row.append(
    node('td', formatDay(order.created_at)),
    item,
    node('td', formatPrice(order.amount)),
    node('td', t(PAYMENT_METHOD_TEXT[order.payment_method])),
    status,
  );
  return row;
}

/** AC-12…AC-15: „Twoje karnety”, „Historia karnetów” (zwinięta), „Historia płatności”; SPEC-005 AC-24 „Historia wejść”. RLS: tylko własne. */
export async function renderPassesAndPayments(supabase: SupabaseClient, userId: string): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-passes-root]');
  if (!root) return;
  const [passes, orders, entries] = await Promise.all([
    supabase.from('user_passes').select(PASS_COLUMNS).eq('user_id', userId),
    supabase.from('orders').select(ORDER_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.rpc('my_range_entries'),
  ]);
  if (passes.error || orders.error || entries.error) {
    el(root, '[data-passes-error]').hidden = false;
    return;
  }
  const { active, history } = splitPasses((passes.data ?? []) as unknown as UserPass[]);
  el(root, '[data-passes]').replaceChildren(...active.map((pass) => passItem(pass, true)));
  el(root, '[data-passes-empty]').hidden = active.length > 0;
  el(root, '[data-pass-history]').replaceChildren(...history.map((pass) => passItem(pass, false)));
  el(root, '[data-pass-history-empty]').hidden = history.length > 0;

  const sorted = sortOrders((orders.data ?? []) as UserOrder[]);
  el(root, '[data-orders]').replaceChildren(...sorted.map(orderRow));
  el(root, '[data-orders-table]').hidden = sorted.length === 0;
  el(root, '[data-orders-empty]').hidden = sorted.length > 0;

  const visits = (entries.data ?? []) as MyRangeEntry[];
  el(root, '[data-entries]').replaceChildren(...visits.map(entryRow));
  el(root, '[data-entries-table]').hidden = visits.length === 0;
  el(root, '[data-entries-empty]').hidden = visits.length > 0;
}
