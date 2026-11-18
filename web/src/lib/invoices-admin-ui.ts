/**
 * Wyspa panelu faktur (`/panel/faktury/`, SPEC-004 US-3: AC-10…AC-13, AC-15, AC-16). Tylko admin (`requireAdmin`).
 * Lista z `admin_list_invoices`; oznaczanie — `mark_invoice_issued`, cofanie — `unmark_invoice` (obie z wpisem w `audit_log`).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` (bez HTML).
 */
import { t, type MessageKey } from '../i18n';
import { formatDateTime } from './admin-users';
import {
  FIELD_KEYS,
  checkMark,
  invoiceErrorKey,
  invoiceValues,
  invoicesCsv,
  invoicesFileName,
  isRefunded,
  listArgs,
  saleDate,
  type AdminInvoice,
  type InvoiceTab,
} from './invoices-admin';
import { requireAdmin } from './panel';
import { formatPrice } from './products';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text: string, className = 'button'): HTMLButtonElement {
  const element = make('button', text, className);
  element.type = 'button';
  return element;
}

/** Pole formularza z etykietą i komunikatem błędu (AC-12). */
function input(id: string, label: string, hint?: string): { wrap: HTMLElement; field: HTMLInputElement; error: HTMLElement } {
  const wrap = make('div');
  const labelElement = make('label', label, 'field-label');
  labelElement.htmlFor = id;
  const field = make('input', '', 'input');
  field.id = id;
  field.maxLength = 50;
  field.autocomplete = 'off';
  const error = make('p', '', 'message-error');
  error.id = `${id}-error`;
  error.hidden = true;
  field.setAttribute('aria-describedby', error.id);
  wrap.append(labelElement, field);
  if (hint) wrap.append(make('p', hint, 'hint'));
  wrap.append(error);
  return { wrap, field, error };
}

export async function mountInvoicesAdmin(root: HTMLElement): Promise<void> {
  const filtersForm = query<HTMLFormElement>(root, '[data-filters]');
  const exportButton = query<HTMLButtonElement>(filtersForm, '[data-export]');
  const status = query<HTMLElement>(root, '[data-status]');
  const errorBox = query<HTMLElement>(root, '[data-error]');
  const summary = query<HTMLElement>(root, '[data-summary]');
  const empty = query<HTMLElement>(root, '[data-empty]');
  const list = query<HTMLElement>(root, '[data-list]');
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  const field = (name: string) => filtersForm.elements.namedItem(name) as HTMLInputElement;

  const supabase = await requireAdmin();
  let tab: InvoiceTab = 'todo';
  let invoices: AdminInvoice[] = [];
  let shown: { tab: InvoiceTab; from: string; to: string } = { tab, from: '', to: '' };

  function showError(key: MessageKey | null): void {
    errorBox.textContent = key ? t(key) : '';
    errorBox.hidden = !key;
  }

  /** AC-11: wartość z przyciskiem „Kopiuj” (Clipboard API, komunikat „Skopiowano”). */
  function copyRow(label: string, value: string): HTMLElement {
    const row = make('div', '', 'copy-row');
    const text = make('div');
    text.append(make('dt', label), make('dd', value));
    const copy = button(t('invoices.copy'));
    copy.setAttribute('aria-label', t('invoices.copyLabel', { field: label }));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(value);
        status.textContent = `${t('invoices.copied')}: ${label}`;
      } catch {
        status.textContent = t('invoices.copyError');
      }
    });
    row.append(text, copy);
    return row;
  }

  /** AC-12: „Numer faktury”* i „Numer KSeF” → „Oznacz jako wystawioną”. */
  function markForm(invoice: AdminInvoice): HTMLFormElement {
    const form = make('form');
    form.noValidate = true;
    const number = input(`n-${invoice.id}`, `${t('invoices.invoiceNumber')} *`);
    const ksef = input(`k-${invoice.id}`, t('invoices.ksefNumber'), t('invoices.ksefHint'));
    const submit = make('button', t('invoices.mark'), 'button button-primary');
    form.append(number.wrap, ksef.wrap, submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const check = checkMark(number.field.value, ksef.field.value);
      for (const [key, part] of [['number', number], ['ksef', ksef]] as const) {
        const bad = !check.ok && check.field === key;
        part.error.textContent = bad ? t(check.error) : '';
        part.error.hidden = !bad;
        part.field.setAttribute('aria-invalid', String(bad));
      }
      if (!check.ok) return (check.field === 'number' ? number : ksef).field.focus();
      submit.disabled = true;
      const { error } = await supabase.rpc('mark_invoice_issued', {
        p_order_id: invoice.id,
        p_invoice_number: check.invoiceNumber,
        p_ksef_number: check.ksefNumber,
      });
      submit.disabled = false;
      await afterChange(error, 'invoices.marked');
    });
    return form;
  }

  /** AC-13: „Cofnij oznaczenie” po potwierdzeniu. */
  function unmarkButton(invoice: AdminInvoice): HTMLButtonElement {
    const unmark = button(t('invoices.unmark'));
    unmark.addEventListener('click', async () => {
      if (!window.confirm(t('invoices.unmarkConfirm', { number: invoice.invoice_number ?? '' }))) return;
      unmark.disabled = true;
      const { error } = await supabase.rpc('unmark_invoice', { p_order_id: invoice.id });
      await afterChange(error, 'invoices.unmarked');
    });
    return unmark;
  }

  async function afterChange(error: { message?: string } | null, done: MessageKey): Promise<void> {
    status.textContent = error ? '' : t(done);
    await load();
    if (error) showError(invoiceErrorKey(error.message));
  }

  function item(invoice: AdminInvoice): HTMLElement {
    const li = make('li', '', 'card');
    const details = make('details', '', 'invoice-item');
    const rest = [invoice.invoice_nip, invoice.invoice_company_name, formatPrice(invoice.amount), invoice.invoice_number ?? '']
      .filter(Boolean).join(' · ');
    const head = make('summary');
    // SPEC-006 AC-7: numer zamówienia obok daty zapłaty.
    const line = make('span');
    line.append(`${saleDate(invoice.paid_at)} · `, make('span', invoice.order_number, 'order-number'), ` · ${rest}`);
    head.append(line);
    // AC-10: dane wpisane ręcznie; AC-16: zwrot zamówienia z fakturą — widoczne także po zwinięciu.
    if (invoice.invoice_data_source === 'manual') head.append(make('span', t('invoices.unverified'), 'badge'));
    if (isRefunded(invoice)) head.append(make('span', t('invoices.refunded'), 'badge message-error'));
    details.append(head);
    const dl = make('dl');
    const values = invoiceValues(invoice, (key) => t(key));
    FIELD_KEYS.forEach((key, index) => dl.append(copyRow(t(key), values[index]!)));
    if (invoice.invoice_number) dl.append(copyRow(t('invoices.invoiceNumber'), invoice.invoice_number));
    if (invoice.ksef_number) dl.append(copyRow(t('invoices.ksefNumber'), invoice.ksef_number));
    details.append(dl);
    if (invoice.invoice_number) {
      details.append(make('p', t('invoices.issuedInfo', {
        date: invoice.invoice_issued_at ? formatDateTime(invoice.invoice_issued_at) : '—',
        person: invoice.issued_by_name ?? '—',
      }), 'hint'), unmarkButton(invoice));
    } else {
      details.append(markForm(invoice));
    }
    li.append(details);
    return li;
  }

  function render(): void {
    list.replaceChildren(...invoices.map(item));
    empty.textContent = t(tab === 'todo' ? 'invoices.emptyTodo' : 'invoices.emptyIssued');
    empty.hidden = invoices.length > 0;
    summary.textContent = invoices.length ? t('invoices.count', { count: invoices.length }) : '';
    exportButton.disabled = invoices.length === 0;
  }

  async function load(): Promise<void> {
    const from = field('from').value;
    const to = field('to').value;
    showError(null);
    summary.textContent = t('invoices.loading');
    const { data, error } = await supabase.rpc('admin_list_invoices', listArgs(tab, from, to));
    if (error) {
      summary.textContent = '';
      showError('invoices.loadError');
      return;
    }
    invoices = (data ?? []) as AdminInvoice[];
    shown = { tab, from, to };
    render();
  }

  for (const tabButton of tabs) {
    tabButton.addEventListener('click', () => {
      tab = tabButton.dataset.tab === 'issued' ? 'issued' : 'todo';
      for (const other of tabs) other.setAttribute('aria-pressed', String(other === tabButton));
      status.textContent = '';
      void load();
    });
  }

  filtersForm.addEventListener('submit', (event) => {
    event.preventDefault();
    status.textContent = '';
    void load();
  });

  // AC-15: eksport bieżącej zakładki i zakresu dat zapłaty.
  exportButton.addEventListener('click', () => {
    const blob = new Blob([invoicesCsv(invoices, (key) => t(key))], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = invoicesFileName(shown.tab, shown.from, shown.to);
    link.click();
    URL.revokeObjectURL(link.href);
  });

  await load();
}
