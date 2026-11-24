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
  canOrder,
  eventOrderPath,
  firstUsedOn,
  idParam,
  needsConsent,
  orderPath,
  orderStatusText,
  orderTermsLines,
  termsVersionSuffix,
  type OrderTerms,
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
import { PRODUCT_KINDS, formatPrice, groupProducts, isProductDiscontinued, type Product } from './products';
import { extensionsByPass, extensionText, type PassExtension } from './range-closures';
import { entryPassText, usageHistory, type MyRangeEntry } from './range-history';
import { BILLING_COLUMNS, invoiceStatus, type InvoiceDetails } from './invoice';
import { bindInvoiceFields } from './invoice-ui';
import { functionErrorCode, getSupabase } from './supabase';
import { COMMENT_MAX, isCommentValid, withdrawalErrorKey, withdrawalQuote, withdrawalStatement, type MyWithdrawal } from './withdrawal';

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
  // SPEC-012 AC-54: od DAYS_PASS_SALES_END bez karnetów czasowych i bez ich grupy.
  const today = todayInWarsaw();
  const groups = groupProducts((data as Product[]).filter((product) => !isProductDiscontinued(product, today)));
  for (const kind of PRODUCT_KINDS) {
    const list = el(root, `[data-group="${kind}"]`);
    list.closest('section')!.hidden = isProductDiscontinued({ kind }, today);
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
    .select('id, name, starts_on, ends_on, ticket_price, cancelled_at')
    .eq('id', eventId)
    .eq('status', 'published')
    .eq('access_mode', 'paid')
    .maybeSingle<{
      id: string;
      name: string;
      starts_on: string;
      ends_on: string | null;
      ticket_price: number | null;
      cancelled_at: string | null;
    }>();
  if (error) return t('offer.loadError');
  // SPEC-012 AC-25: odwołane wydarzenie — bez zakupu.
  if (data?.cancelled_at) return t('eventCancel.eventCancelled');
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
  terms_changed: 'offer.termsChanged',
  consent_required: 'offer.consentRequired',
  product_discontinued: 'offer.discontinued',
  event_cancelled: 'eventCancel.eventCancelled',
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
    item = error
      ? t('offer.loadError')
      : !data
        ? t('offer.unavailable')
        : isProductDiscontinued(data, todayInWarsaw())
          ? t('offer.discontinued')
          : { name: data.name, price: data.price, notes: notes(data) };
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
  // SPEC-012 AC-2 (art. 17 ust. 3 ustawy o prawach konsumenta).
  pay.textContent = t('offer.pay', { amount: formatPrice(data.price) });

  // SPEC-012 AC-1: data bieżącej wersji regulaminu (ta sama trafia do `payments-create`, AC-3).
  let termsVersion: string | null = null;
  const termsVersionText = el(form, '[data-terms-version]');
  const loadTermsVersion = async (): Promise<boolean> => {
    const { data: version, error } = await supabase.rpc('current_sales_terms_version');
    if (error) return false;
    termsVersion = typeof version === 'string' ? version : null;
    termsVersionText.textContent = termsVersionSuffix(termsVersion);
    return true;
  };
  if (!(await loadTermsVersion())) return stop(t('offer.loadError'));

  // SPEC-012 AC-6: zgoda przy karnecie i wejściu jednorazowym; przy wejściówce — informacja o braku odstąpienia.
  const terms = el<HTMLInputElement>(form, '#o-terms');
  const consent = el<HTMLInputElement>(form, '#o-consent');
  const consentNeeded = needsConsent({ kind: productId ? 'product' : 'ticket' });
  for (const part of form.querySelectorAll<HTMLElement>('[data-consent]')) part.hidden = !consentNeeded;
  el(form, '[data-ticket-note]').hidden = consentNeeded;
  consent.required = consentNeeded;

  // SPEC-012 AC-2: „Zamawiam i płacę” nieaktywny do zaznaczenia wymaganych checkboxów; SPEC-004 AC-6 — także
  // dopóki zaznaczona faktura nie ma potwierdzonych danych.
  const payHint = el(form, '[data-pay-hint]');
  const checksHint = el(form, '[data-checks-hint]');
  let invoiceBlocked = false;
  const sync = () => {
    const checked = canOrder({ terms: terms.checked, consent: consentNeeded ? consent.checked : null });
    pay.disabled = !checked || invoiceBlocked;
    checksHint.hidden = checked;
    payHint.hidden = !invoiceBlocked;
  };
  terms.addEventListener('change', sync);
  consent.addEventListener('change', sync);
  // SPEC-004 AC-1: zapisane `billing_details` jako podpowiedź (RLS: własny wiersz).
  const invoice = bindInvoiceFields(form, supabase, (control) => {
    invoiceBlocked = control.wanted() && !control.value();
    sync();
  });
  const billing = await supabase.from('billing_details').select(BILLING_COLUMNS).eq('user_id', session.session.user.id).maybeSingle<InvoiceDetails>();
  invoice.setSaved(billing.data ?? null);
  sync();
  loading.hidden = true;
  form.hidden = false;

  const formError = el(form, '[data-form-error]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.hidden = true;
    if (pay.disabled) return;
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
          // SPEC-012 AC-3, AC-8.
          terms_version: termsVersion,
          consent: consentNeeded && consent.checked,
        },
      });
      if (!result.error && result.data?.payment_url) return window.location.assign(result.data.payment_url);
      code = await functionErrorCode(result.error);
    } catch {
      // błąd sieci — komunikat ogólny
    }
    // SPEC-012 AC-3: nowa wersja regulaminu — pobrana na nowo, akceptacja od początku.
    if (code === 'terms_changed') {
      terms.checked = false;
      await loadTermsVersion();
    }
    el(form, '[data-paying]').hidden = true;
    sync();
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

function passItem(pass: UserPass, active: boolean, extensions: readonly PassExtension[] = []): HTMLLIElement {
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
  // SPEC-012 AC-33: „Przedłużono o 10 dni (zamknięcie strzelnicy 3–12.02.2027).” — pod „Ważny do”.
  lines.push(...extensions.map(extensionText));
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

/** SPEC-012 AC-5: „Regulamin z 1.01.2027” (PDF wersji) i data zgody — w `/konto/` i w panelu zamówień. */
export function orderTermsNodes(order: OrderTerms): HTMLElement[] {
  const { terms, consent } = orderTermsLines(order);
  const nodes: HTMLElement[] = [];
  if (terms) {
    const line = node('span', undefined, 'order-ref');
    const link = node('a', terms.text);
    link.href = terms.href;
    link.target = '_blank';
    link.rel = 'noopener';
    line.append(link);
    nodes.push(line);
  }
  if (consent) nodes.push(node('span', consent, 'order-ref'));
  return nodes;
}

/**
 * SPEC-012 AC-46, AC-48: przy zamówieniu z odstąpieniem możliwym dziś — „Odstąp od umowy” (karnet czasowy, wejściówka,
 * na miejscu, po oknie i zwrot 0 zł — bez przycisku, AC-55); po oświadczeniu — „Odstąpienie zgłoszone…”.
 */
function withdrawalNodes(order: UserOrder, withdrawal: MyWithdrawal | undefined, open: (order: UserOrder, w: MyWithdrawal) => void): HTMLElement[] {
  if (!withdrawal) return [];
  const amount = formatPrice(withdrawal.refund_amount);
  if (withdrawal.submitted_at) {
    if (order.status !== 'paid') return [];
    return [node('span', t('offer.withdrawSubmitted', { date: formatDay(withdrawal.submitted_at), amount }), 'order-ref')];
  }
  const button = node('button', t('offer.withdraw'), 'button withdraw-button');
  button.type = 'button';
  button.setAttribute('aria-label', t('offer.withdrawLabel', { number: order.order_number }));
  button.addEventListener('click', () => open(order, withdrawal));
  return [button];
}

function orderRow(order: UserOrder, withdrawal: MyWithdrawal | undefined, open: (order: UserOrder, w: MyWithdrawal) => void): HTMLTableRowElement {
  const row = node('tr');
  const status = node('td', orderStatusText(order));
  // SPEC-004 AC-7: „Faktura: w przygotowaniu” / „Faktura: <numer>” (bez pliku — faktura przez KSeF).
  const invoice = invoiceStatus(order);
  if (invoice) status.append(node('span', t(invoice.key, 'number' in invoice ? { number: invoice.number } : {}), 'invoice-status'));
  status.append(...withdrawalNodes(order, withdrawal, open));
  // SPEC-006 AC-12: „Nr: SV-2026-000123” przy pozycji.
  const item = node('td', order.item_name);
  item.append(node('span', t('offer.orderNumber', { number: order.order_number }), 'order-number order-ref'));
  item.append(...orderTermsNodes(order));
  row.append(
    node('td', formatDay(order.created_at)),
    item,
    node('td', formatPrice(order.amount)),
    node('td', t(PAYMENT_METHOD_TEXT[order.payment_method])),
    status,
  );
  return row;
}

/** SPEC-012 AC-47, AC-48, AC-50: okno oświadczenia o odstąpieniu i `rpc/submit_withdrawal`. */
function withdrawalDialog(supabase: SupabaseClient, root: HTMLElement, reload: () => Promise<void>) {
  const dialog = document.querySelector<HTMLDialogElement>('[data-withdraw-dialog]');
  const announce = el(root, '[data-withdraw-status]');
  if (!dialog) return () => {};
  const form = el<HTMLFormElement>(dialog, 'form');
  const comment = el<HTMLTextAreaElement>(dialog, '[data-withdraw-comment]');
  const error = el(dialog, '[data-withdraw-error]');
  const submit = el<HTMLButtonElement>(dialog, '[data-withdraw-submit]');
  comment.maxLength = COMMENT_MAX;
  let current: UserOrder | null = null;

  el(dialog, '[data-withdraw-cancel]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!current) return;
    if (!isCommentValid(comment.value)) {
      error.textContent = t('offer.withdrawCommentTooLong');
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    error.hidden = true;
    const { data, error: rpcError } = await supabase.rpc('submit_withdrawal', {
      p_order_id: current.id,
      p_comment: comment.value.trim() || null,
    });
    submit.disabled = false;
    if (rpcError || typeof data !== 'number') {
      error.textContent = t(withdrawalErrorKey(rpcError?.message));
      error.hidden = false;
      return;
    }
    dialog.close();
    await reload();
    announce.textContent = t('offer.withdrawSent', { amount: formatPrice(data) });
  });

  return (order: UserOrder, withdrawal: MyWithdrawal) => {
    current = order;
    announce.textContent = '';
    el(dialog, '[data-withdraw-statement]').textContent = withdrawalStatement(order.item_name, order.order_number, withdrawal.paid_on);
    el(dialog, '[data-withdraw-quote]').textContent = withdrawalQuote(withdrawal);
    comment.value = '';
    error.hidden = true;
    submit.disabled = false;
    dialog.showModal();
  };
}

let openWithdrawal: ((order: UserOrder, withdrawal: MyWithdrawal) => void) | undefined;

/** AC-12…AC-15: „Twoje karnety”, „Historia karnetów” (zwinięta), „Historia płatności”; SPEC-005 AC-24 „Historia wejść”. RLS: tylko własne. */
export async function renderPassesAndPayments(supabase: SupabaseClient, userId: string): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-passes-root]');
  if (!root) return;
  const [passes, orders, entries, extensions, withdrawals] = await Promise.all([
    supabase.from('user_passes').select(PASS_COLUMNS).eq('user_id', userId),
    supabase.from('orders').select(ORDER_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.rpc('my_range_entries'),
    supabase.rpc('my_pass_extensions'),
    supabase.rpc('my_withdrawals'),
  ]);
  if (passes.error || orders.error || entries.error || extensions.error || withdrawals.error) {
    el(root, '[data-passes-error]').hidden = false;
    return;
  }
  const { active, history } = splitPasses((passes.data ?? []) as unknown as UserPass[]);
  const extended = extensionsByPass((extensions.data ?? []) as PassExtension[]);
  const item = (pass: UserPass, isActive: boolean) => passItem(pass, isActive, extended.get(pass.id));
  el(root, '[data-passes]').replaceChildren(...active.map((pass) => item(pass, true)));
  el(root, '[data-passes-empty]').hidden = active.length > 0;
  el(root, '[data-pass-history]').replaceChildren(...history.map((pass) => item(pass, false)));
  el(root, '[data-pass-history-empty]').hidden = history.length > 0;

  const sorted = sortOrders((orders.data ?? []) as UserOrder[]);
  const byOrder = new Map(((withdrawals.data ?? []) as MyWithdrawal[]).map((w) => [w.order_id, w]));
  openWithdrawal ??= withdrawalDialog(supabase, root, () => renderPassesAndPayments(supabase, userId));
  const open = openWithdrawal;
  el(root, '[data-orders]').replaceChildren(...sorted.map((order) => orderRow(order, byOrder.get(order.id), open)));
  el(root, '[data-orders-table]').hidden = sorted.length === 0;
  el(root, '[data-orders-empty]').hidden = sorted.length > 0;

  const visits = (entries.data ?? []) as MyRangeEntry[];
  el(root, '[data-entries]').replaceChildren(...visits.map(entryRow));
  el(root, '[data-entries-table]').hidden = visits.length === 0;
  el(root, '[data-entries-empty]').hidden = visits.length > 0;
}
