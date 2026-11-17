/**
 * Wyspy Oferty (SPEC-003 US-2, US-3): `/oferta/` (AC-5, AC-6), `/oferta/zamowienie/` (AC-7, AC-8 — wywołanie
 * `payments-create`), `/konto/platnosc/` (AC-10) i sekcje karnetów i płatności w `/konto/` (AC-12…AC-15).
 * Logika bez DOM: lib/offer.ts. Teksty z bazy trafiają do DOM tylko przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { LOGIN_PAGE, withNext } from './auth';
import { formatDate } from './dates';
import { formatDay } from './admin-users';
import {
  OFFER_COLUMNS,
  ORDER_COLUMNS,
  ORDER_STATUS_TEXT,
  PASS_COLUMNS,
  PAYMENT_METHOD_TEXT,
  PAYMENT_POLL_INTERVAL_MS,
  PAYMENT_STATUS_PAGE,
  buyHref,
  firstUsedOn,
  idParam,
  orderPath,
  passHistoryState,
  passValidTo,
  paymentView,
  productNotes,
  sortOrders,
  splitPasses,
  type UserOrder,
  type UserPass,
} from './offer';
import { PRODUCT_KINDS, formatPrice, groupProducts, type Product } from './products';
import { getSupabase } from './supabase';

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

/** Kod błędu z odpowiedzi `payments-create` (FunctionsHttpError ma `context: Response`). */
async function errorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  try {
    return ((await context.json()) as { error?: string })?.error ?? null;
  } catch {
    return null;
  }
}

/** AC-7: podsumowanie produktu; AC-8: „Zapłać” → `payments-create` → bramka Tpay. */
export async function mountOrder(root: HTMLElement): Promise<void> {
  const loading = el(root, '[data-loading]');
  const message = el(root, '[data-message]');
  const stop = (text: string) => {
    loading.hidden = true;
    message.textContent = text;
    message.hidden = false;
  };
  const supabase = client();
  const productId = idParam(new URLSearchParams(window.location.search).get('product'));
  if (!supabase || !productId) return stop(t('offer.unavailable'));
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return window.location.replace(withNext(LOGIN_PAGE, orderPath(productId)));

  // Cena zawsze świeża z bazy (§7: zmiana ceny między wyświetleniem a zapłatą); ukryty produkt — RLS go nie zwraca.
  const { data, error } = await supabase.from('products').select(OFFER_COLUMNS).eq('id', productId).eq('is_active', true).maybeSingle<Product>();
  if (error) return stop(t('offer.loadError'));
  if (!data) return stop(t('offer.unavailable'));

  el(root, '[data-product-name]').textContent = data.name;
  el(root, '[data-product-price]').textContent = formatPrice(data.price);
  el(root, '[data-product-notes]').replaceChildren(...notes(data));
  const form = el<HTMLFormElement>(root, 'form[data-order]');
  const pay = el<HTMLButtonElement>(form, '[data-pay]');
  pay.textContent = t('offer.pay', { amount: formatPrice(data.price) });
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

    // §7: blokada przycisku + klucz idempotencji żądania — podwójne kliknięcie = jedno zamówienie.
    pay.disabled = true;
    el(form, '[data-paying]').hidden = false;
    let code: string | null = null;
    try {
      const result = await supabase.functions.invoke<{ order_id: string; payment_url: string }>('payments-create', {
        body: { product_id: productId, request_key: crypto.randomUUID() },
      });
      if (!result.error && result.data?.payment_url) return window.location.assign(result.data.payment_url);
      code = await errorCode(result.error);
    } catch {
      // błąd sieci — komunikat ogólny
    }
    pay.disabled = false;
    el(form, '[data-paying]').hidden = true;
    formError.textContent = t(code === 'product_unavailable' ? 'offer.unavailable' : 'offer.payError');
    formError.hidden = false;
  });
}

// ===== /konto/platnosc/ =====

/** AC-10: stan zamówienia co 3 s przez maks. 60 s. */
export async function mountPaymentStatus(root: HTMLElement): Promise<void> {
  const status = el(root, '[data-payment-status]');
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
    const { data, error } = await supabase.from('orders').select('status').eq('id', orderId).maybeSingle<{ status: string }>();
    if (!error && !data) return show(t('offer.paymentNotFound'), true);
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
  return item;
}

function orderRow(order: UserOrder): HTMLTableRowElement {
  const row = node('tr');
  row.append(
    node('td', formatDay(order.created_at)),
    node('td', order.item_name),
    node('td', formatPrice(order.amount)),
    node('td', t(PAYMENT_METHOD_TEXT[order.payment_method])),
    node('td', t(ORDER_STATUS_TEXT[order.status])),
  );
  return row;
}

/** AC-12…AC-15: „Twoje karnety”, „Historia karnetów” (zwinięta), „Historia płatności”. RLS: tylko własne. */
export async function renderPassesAndPayments(supabase: SupabaseClient, userId: string): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-passes-root]');
  if (!root) return;
  const [passes, orders] = await Promise.all([
    supabase.from('user_passes').select(PASS_COLUMNS).eq('user_id', userId),
    supabase.from('orders').select(ORDER_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false }),
  ]);
  if (passes.error || orders.error) {
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
}
