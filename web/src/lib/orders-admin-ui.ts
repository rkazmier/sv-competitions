/**
 * Wyspa zamówień w panelu (`/panel/zamowienia/`, SPEC-003 US-6, AC-24…AC-27). Tylko admin (`requireAdmin`).
 * Lista z `admin_list_orders`; „Anuluj i zwróć”: Tpay — Edge Function `payments-refund` (zlecenie zwrotu w Tpay),
 * na miejscu — `cancel_order` (od razu `refunded`). Obie drogi zapisują `order_refund` w `audit_log` (AC-27).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` (bez HTML).
 */
import { t, type MessageKey } from '../i18n';
import { todayInWarsaw } from './calendar';
import {
  csvFileName,
  defaultFilters,
  filterArgs,
  invoiceAction,
  methodKeys,
  numberSearchKey,
  orderDateTime,
  ordersCsv,
  ordersTotal,
  personLabel,
  refundAction,
  refundErrorKey,
  statusKey,
  type AdminOrder,
  type OrderFilters,
} from './orders-admin';
import { invoiceArgs } from './invoice';
import { bindInvoiceFields } from './invoice-ui';
import { invoiceErrorKey } from './invoices-admin';
import { requireAdmin } from './panel';
import { formatPrice } from './products';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

async function functionErrorCode(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  try {
    return ((await context.json()) as { error?: string })?.error ?? null;
  } catch {
    return null;
  }
}

export async function mountOrdersAdmin(root: HTMLElement): Promise<void> {
  const filtersForm = query<HTMLFormElement>(root, '[data-filters]');
  const itemSelect = query<HTMLSelectElement>(filtersForm, '[data-item]');
  const exportButton = query<HTMLButtonElement>(filtersForm, '[data-export]');
  const status = query<HTMLElement>(root, '[data-status]');
  const errorBox = query<HTMLElement>(root, '[data-error]');
  const summary = query<HTMLElement>(root, '[data-summary]');
  const rows = query<HTMLElement>(root, '[data-rows]');
  const dialog = query<HTMLDialogElement>(root, '[data-dialog]');
  const note = query<HTMLTextAreaElement>(dialog, '[data-note]');

  const field = (name: string) => filtersForm.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  const initial = defaultFilters(todayInWarsaw());
  for (const [name, value] of Object.entries(initial)) field(name).value = value;

  const supabase = await requireAdmin();
  let orders: AdminOrder[] = [];
  let shownFilters: OrderFilters = initial;

  const readFilters = (): OrderFilters => ({
    from: field('from').value,
    to: field('to').value,
    status: field('status').value,
    method: field('method').value,
    item: field('item').value,
    person: field('person').value,
  });

  function showError(key: MessageKey | null): void {
    errorBox.textContent = key ? t(key) : '';
    errorBox.hidden = !key;
  }

  function cell(row: HTMLTableRowElement, text: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.textContent = text;
    row.append(td);
    return td;
  }

  function render(): void {
    rows.replaceChildren();
    for (const order of orders) {
      const row = document.createElement('tr');
      cell(row, order.order_number).className = 'order-number';
      cell(row, orderDateTime(order.created_at));
      cell(row, order.item_name);
      cell(row, formatPrice(order.amount));
      cell(row, methodKeys(order).map((key) => t(key)).join(' / '));
      cell(row, t(statusKey(order.status)));
      cell(row, personLabel(order) ?? t('orders.noAccount'));
      cell(row, order.seller_name ?? '—');
      cell(row, order.refund_note ?? '');
      const actions = cell(row, '');
      const action = refundAction(order);
      if (action === 'refund') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button';
        button.textContent = t('orders.refund');
        button.setAttribute('aria-label', t('orders.refundLabel', { item: order.item_name, amount: formatPrice(order.amount) }));
        button.addEventListener('click', () => openRefund(order));
        actions.append(button);
      } else if (action === 'used') {
        actions.textContent = t('orders.passUsed');
      }
      const invoice = invoiceAction(order);
      if (invoice === 'add') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button';
        button.textContent = t('orders.addInvoice');
        button.setAttribute('aria-label', t('orders.addInvoiceLabel', { item: order.item_name, amount: formatPrice(order.amount) }));
        button.addEventListener('click', () => openInvoice(order));
        actions.append(button);
      } else if (invoice === 'requested') {
        const note = document.createElement('p');
        note.textContent = t('orders.invoiceRequested');
        actions.append(note);
      }
      rows.append(row);
    }
    query<HTMLElement>(root, '[data-table]').hidden = orders.length === 0;
    // SPEC-006 AC-10: wyszukiwanie po numerze — komunikat zamiast zwykłego „Brak zamówień…”.
    const numberKey = numberSearchKey(shownFilters.person, orders.length);
    const notice = query<HTMLElement>(root, '[data-number-notice]');
    notice.textContent = numberKey ? t(numberKey) : '';
    notice.hidden = !numberKey;
    query<HTMLElement>(root, '[data-empty]').hidden = orders.length > 0 || numberKey !== null;
    summary.textContent = t('orders.summary', { count: orders.length, amount: formatPrice(ordersTotal(orders)) });
    exportButton.disabled = orders.length === 0;
  }

  async function load(): Promise<void> {
    const filters = readFilters();
    showError(null);
    summary.textContent = t('orders.loading');
    const { data, error } = await supabase.rpc('admin_list_orders', filterArgs(filters));
    if (error) {
      summary.textContent = '';
      showError('orders.loadError');
      return;
    }
    orders = (data ?? []) as AdminOrder[];
    shownFilters = filters;
    render();
  }

  async function loadItems(): Promise<void> {
    const [productsResult, eventsResult] = await Promise.all([
      supabase.from('products').select('id, name').order('kind').order('position'),
      supabase.from('calendar_events').select('id, name, starts_on').eq('access_mode', 'paid').order('starts_on', { ascending: false }),
    ]);
    for (const product of productsResult.data ?? []) itemSelect.add(new Option(product.name, `product:${product.id}`));
    for (const event of eventsResult.data ?? []) {
      itemSelect.add(new Option(t('offer.ticketName', { name: event.name }), `event:${event.id}`));
    }
  }

  let pending: AdminOrder | null = null;

  function openRefund(order: AdminOrder): void {
    pending = order;
    status.textContent = '';
    showError(null);
    note.value = '';
    const amount = formatPrice(order.amount);
    query<HTMLElement>(dialog, '[data-confirm-item]').textContent = t('orders.confirmItem', {
      number: order.order_number,
      item: order.item_name,
      person: personLabel(order) ?? t('orders.noAccount'),
      date: orderDateTime(order.created_at),
    });
    query<HTMLElement>(dialog, '[data-confirm-text]').textContent = t(
      order.payment_method === 'tpay' ? 'orders.confirmOnline' : 'orders.confirmOnSite',
      { amount },
    );
    dialog.showModal();
  }

  async function refund(order: AdminOrder, refundNote: string): Promise<void> {
    status.textContent = t('orders.refunding');
    let code: string | null = null;
    let ok = false;
    try {
      if (order.payment_method === 'tpay') {
        const result = await supabase.functions.invoke('payments-refund', {
          body: { order_id: order.id, refund_note: refundNote || null },
        });
        ok = !result.error;
        code = ok ? null : await functionErrorCode(result.error);
      } else {
        const { error } = await supabase.rpc('cancel_order', { p_order_id: order.id, p_refund_note: refundNote || null });
        ok = !error;
        code = error?.message ?? null;
      }
    } catch {
      // błąd sieci — komunikat ogólny
    }
    status.textContent = ok ? t(order.payment_method === 'tpay' ? 'orders.refundedOnline' : 'orders.refundedOnSite') : '';
    await load();
    if (!ok) showError(refundErrorKey(code));
  }

  dialog.addEventListener('close', () => {
    const order = pending;
    pending = null;
    if (order && dialog.returnValue === 'confirm') void refund(order, note.value.trim());
  });

  // SPEC-004 AC-14: dane do faktury po zakupie — kroki AC-2…AC-5 bez nadpisywania `billing_details` klienta.
  const invoiceDialog = query<HTMLDialogElement>(root, '[data-invoice-dialog]');
  const invoiceSave = query<HTMLButtonElement>(invoiceDialog, '[data-invoice-save]');
  const invoiceError = query<HTMLElement>(invoiceDialog, '[data-invoice-error]');
  const invoiceFields = bindInvoiceFields(invoiceDialog, supabase, (control) => {
    invoiceSave.disabled = !control.value();
  });
  let invoiceOrder: AdminOrder | null = null;

  function openInvoice(order: AdminOrder): void {
    invoiceOrder = order;
    status.textContent = '';
    showError(null);
    invoiceError.hidden = true;
    invoiceFields.setSaved(null);
    query<HTMLElement>(invoiceDialog, '[data-invoice-item]').textContent = t('orders.confirmItem', {
      number: order.order_number,
      item: order.item_name,
      person: personLabel(order) ?? t('orders.noAccount'),
      date: orderDateTime(order.created_at),
    });
    invoiceDialog.showModal();
  }

  invoiceSave.addEventListener('click', async () => {
    const details = invoiceFields.value();
    if (!invoiceOrder || !details) return;
    invoiceSave.disabled = true;
    const { error } = await supabase.rpc('set_order_invoice_details', invoiceArgs(invoiceOrder.id, details, false));
    invoiceSave.disabled = false;
    if (error) {
      invoiceError.textContent = t(invoiceErrorKey(error.message));
      invoiceError.hidden = false;
      return;
    }
    invoiceDialog.close();
    status.textContent = t('orders.invoiceSaved');
    await load();
  });
  query<HTMLButtonElement>(invoiceDialog, '[data-invoice-close]').addEventListener('click', () => invoiceDialog.close());

  filtersForm.addEventListener('submit', (event) => {
    event.preventDefault();
    status.textContent = '';
    void load();
  });

  exportButton.addEventListener('click', () => {
    const blob = new Blob([ordersCsv(orders, (key) => t(key))], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = csvFileName(shownFilters);
    link.click();
    URL.revokeObjectURL(link.href);
  });

  await Promise.all([loadItems(), load()]);
}
