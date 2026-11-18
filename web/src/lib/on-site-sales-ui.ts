/**
 * Wyspa sprzedaży na miejscu (`/panel/sprzedaz/`, SPEC-003 US-5, AC-21…AC-23). Obsługa i admin (`requireStaff`).
 * Zapis wyłącznie funkcją bazy `create_on_site_order` (cena z bazy, `created_by` = zalogowana obsługa).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent` (bez HTML).
 */
import { t } from '../i18n';
import { todayInWarsaw } from './calendar';
import {
  SALE_EVENT_COLUMNS,
  SEARCH_MIN_LENGTH,
  itemArgs,
  saleErrorKey,
  saleItems,
  saleTime,
  saleTotals,
  type OnSiteSale,
  type PersonHit,
  type SaleItem,
  type TicketEvent,
} from './on-site-sales';
import { BILLING_COLUMNS, invoiceArgs, type InvoiceDetails } from './invoice';
import { bindInvoiceFields } from './invoice-ui';
import { PRODUCT_COLUMNS, formatPrice, type Product } from './products';
import { requireStaff } from './panel';
import { scanQrCode } from './qr-scanner';
import { entryReturnUrl, personIdFromSearch, qrTokenFromScan, type PersonSummary } from './range-entry';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

type ErrorField = 'person' | 'item' | 'method' | 'invoice';

export async function mountOnSiteSales(root: HTMLElement): Promise<void> {
  const form = query<HTMLFormElement>(root, '[data-form]');
  const accountBox = query<HTMLElement>(form, '[data-account]');
  const searchBox = query<HTMLElement>(form, '[data-search-box]');
  const queryInput = query<HTMLInputElement>(form, '[data-query]');
  const searchButton = query<HTMLButtonElement>(form, '[data-search]');
  const searchStatus = query<HTMLElement>(form, '[data-search-status]');
  const results = query<HTMLUListElement>(form, '[data-results]');
  const selectedBox = query<HTMLElement>(form, '[data-selected]');
  const selectedName = query<HTMLElement>(form, '[data-selected-name]');
  const guestHint = query<HTMLElement>(form, '[data-guest-hint]');
  const itemSelect = query<HTMLSelectElement>(form, '[data-item]');
  const itemsEmpty = query<HTMLElement>(form, '[data-items-empty]');
  const formError = query<HTMLElement>(form, '[data-form-error]');
  const submit = query<HTMLButtonElement>(form, '[data-submit]');
  const status = query<HTMLElement>(form, '[data-status]');
  const todayBody = query<HTMLElement>(root, '[data-today]');

  const { supabase } = await requireStaff();
  let person: PersonHit | null = null;
  let products: Product[] = [];
  let events: TicketEvent[] = [];
  let items: SaleItem[] = [];

  const isGuest = () => form.querySelector<HTMLInputElement>('input[name="who"]:checked')?.value === 'guest';
  const method = () => form.querySelector<HTMLInputElement>('input[name="method"]:checked')?.value;

  function setError(field: ErrorField, message: string | null): void {
    const output = query<HTMLElement>(form, `[data-error-for="${field}"]`);
    output.textContent = message ?? '';
    output.hidden = !message;
  }

  function renderItems(): void {
    const previous = itemSelect.value;
    items = saleItems(products, events, todayInWarsaw(), isGuest(), (name) => t('offer.ticketName', { name }));
    itemSelect.replaceChildren(itemSelect.options[0]);
    for (const item of items) {
      itemSelect.add(new Option(t('sales.itemOption', { name: item.name, price: formatPrice(item.price) }), item.value));
    }
    itemSelect.value = items.some((item) => item.value === previous) ? previous : '';
    itemsEmpty.hidden = items.length > 0;
  }

  // SPEC-004 AC-9: dla osoby z kontem podpowiadają się jej `billing_details` (RLS: odczyt dla obsługi);
  // dla osoby bez konta — puste pola, dane firmy trafiają tylko do zamówienia.
  const invoice = bindInvoiceFields(form, supabase, () => setError('invoice', null));
  let invoiceFor: string | null | undefined;
  async function syncInvoice(): Promise<void> {
    const id = isGuest() ? null : (person?.id ?? null);
    if (id === invoiceFor) return;
    invoiceFor = id;
    if (!id) return invoice.setSaved(null);
    const { data } = await supabase.from('billing_details').select(BILLING_COLUMNS).eq('user_id', id).maybeSingle<InvoiceDetails>();
    if (invoiceFor === id) invoice.setSaved(data ?? null);
  }

  function renderPerson(): void {
    void syncInvoice();
    const guest = isGuest();
    accountBox.hidden = guest;
    guestHint.hidden = !guest;
    searchBox.hidden = person !== null;
    selectedBox.hidden = person === null;
    selectedName.textContent = person ? t('sales.selected', { name: person.full_name ?? t('sales.noName') }) : '';
    renderItems();
  }

  async function search(): Promise<void> {
    const text = queryInput.value.trim();
    results.replaceChildren();
    if (text.length < SEARCH_MIN_LENGTH) {
      searchStatus.textContent = t('sales.searchHint', { min: SEARCH_MIN_LENGTH });
      return;
    }
    searchButton.disabled = true;
    searchStatus.textContent = t('sales.searching');
    const { data, error } = await supabase.rpc('staff_search_people', { p_query: text });
    searchButton.disabled = false;
    if (error) {
      searchStatus.textContent = t('sales.searchError');
      return;
    }
    const hits = (data ?? []) as PersonHit[];
    searchStatus.textContent = hits.length ? '' : t('sales.noResults');
    for (const hit of hits) {
      const name = hit.full_name ?? t('sales.noName');
      const li = document.createElement('li');
      li.className = 'card';
      const label = document.createElement('p');
      label.textContent = hit.email_hint ? `${name} · ${hit.email_hint}` : name;
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'button';
      choose.textContent = t('sales.choose');
      choose.setAttribute('aria-label', t('sales.chooseLabel', { name }));
      choose.addEventListener('click', () => {
        person = hit;
        results.replaceChildren();
        setError('person', null);
        renderPerson();
      });
      li.append(label, choose);
      results.append(li);
    }
  }

  async function loadToday(): Promise<void> {
    const { data, error } = await supabase.rpc('staff_on_site_sales_today');
    query<HTMLElement>(root, '[data-today-error]').hidden = !error;
    if (error) return;
    const sales = (data ?? []) as OnSiteSale[];
    todayBody.replaceChildren();
    for (const sale of sales) {
      const row = document.createElement('tr');
      const amount = formatPrice(sale.amount) + (sale.status === 'paid' ? '' : ` ${t('sales.refunded')}`);
      const number = document.createElement('td');
      number.className = 'order-number';
      number.textContent = sale.order_number;
      row.append(number);
      for (const text of [saleTime(sale.created_at), sale.item_name, amount, t(`sales.${sale.on_site_method}`), sale.seller_name ?? '—']) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.append(cell);
      }
      todayBody.append(row);
    }
    query<HTMLElement>(root, '[data-today-table]').hidden = sales.length === 0;
    query<HTMLElement>(root, '[data-today-empty]').hidden = sales.length > 0;
    const totals = saleTotals(sales);
    query<HTMLElement>(root, '[data-total="cash"]').textContent = t('sales.totalCash', { amount: formatPrice(totals.cash) });
    query<HTMLElement>(root, '[data-total="terminal"]').textContent = t('sales.totalTerminal', {
      amount: formatPrice(totals.terminal),
    });
  }

  async function loadItems(): Promise<void> {
    const today = todayInWarsaw();
    const [productsResult, eventsResult] = await Promise.all([
      supabase.from('products').select(PRODUCT_COLUMNS).eq('is_active', true).order('kind').order('position'),
      supabase
        .from('calendar_events')
        .select(SALE_EVENT_COLUMNS)
        .eq('status', 'published')
        .eq('access_mode', 'paid')
        .or(`ends_on.gte.${today},starts_on.gte.${today}`)
        .order('starts_on'),
    ]);
    if (productsResult.error || eventsResult.error) {
      formError.textContent = t('panel.loadError');
      formError.hidden = false;
      return;
    }
    products = (productsResult.data ?? []) as Product[];
    events = (eventsResult.data ?? []) as TicketEvent[];
    renderItems();
  }

  for (const radio of form.querySelectorAll<HTMLInputElement>('input[name="who"]')) {
    radio.addEventListener('change', () => {
      setError('person', null);
      renderPerson();
    });
  }
  searchButton.addEventListener('click', () => void search());
  queryInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void search();
    }
  });
  // SPEC-005 AC-5: skan kodu QR konta zamiast wyszukiwania.
  async function selectBy(fn: 'staff_find_by_qr' | 'staff_person_by_id', args: Record<string, string>): Promise<void> {
    const { data, error } = await supabase.rpc(fn, args);
    const found = ((data ?? []) as PersonSummary[])[0];
    if (!found) {
      searchStatus.textContent = error ? t('rangeEntry.qrError') : t('rangeEntry.qrNotFound');
      return;
    }
    person = { id: found.id, full_name: found.full_name, email_hint: null };
    setError('person', null);
    renderPerson();
  }
  query<HTMLButtonElement>(form, '[data-scan]').addEventListener('click', async () => {
    searchStatus.textContent = '';
    const text = await scanQrCode(query<HTMLDialogElement>(document, '[data-scan-dialog]'));
    if (text === null) return;
    const token = qrTokenFromScan(text);
    if (token) await selectBy('staff_find_by_qr', { p_token: token });
    else searchStatus.textContent = t('rangeEntry.qrNotFound');
  });

  query<HTMLButtonElement>(form, '[data-change]').addEventListener('click', () => {
    person = null;
    renderPerson();
    queryInput.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    formError.hidden = true;
    const guest = isGuest();
    const args = itemArgs(itemSelect.value);
    const chosenMethod = method();
    setError('person', !guest && !person ? t('sales.personRequired') : null);
    setError('item', args ? null : t('sales.itemRequired'));
    setError('method', chosenMethod ? null : t('sales.methodRequired'));
    const details = invoice.wanted() ? invoice.value() : null;
    const invoiceMissing = invoice.wanted() && !details;
    setError('invoice', invoiceMissing ? t('invoice.confirmRequired') : null);
    if ((!guest && !person) || !args || !chosenMethod || invoiceMissing) return;

    submit.disabled = true;
    submit.textContent = t('sales.saving');
    const { data: orderId, error } = await supabase.rpc('create_on_site_order', {
      p_user_id: guest ? null : person!.id,
      p_on_site_method: chosenMethod,
      ...args,
    });
    // AC-9: kopia danych firmy w zamówieniu (obsługa — tylko własna sprzedaż „na miejscu”), bez zmiany `billing_details`.
    const invoiceError = !error && details
      ? (await supabase.rpc('set_order_invoice_details', invoiceArgs(orderId as string, details, false))).error
      : null;
    submit.disabled = false;
    submit.textContent = t('sales.submit');
    if (error) {
      formError.textContent = t(saleErrorKey(error));
      formError.hidden = false;
      return;
    }
    if (invoiceError) {
      formError.textContent = t('invoice.saleInvoiceError');
      formError.hidden = false;
    }
    // SPEC-006 AC-15: numer nadaje baza — odczyt z `orders` (obsługa ma odczyt, RLS).
    const { data: saved } = await supabase.from('orders').select('order_number').eq('id', orderId as string)
      .maybeSingle<{ order_number: string }>();
    status.textContent = saved?.order_number
      ? t('sales.saved', { number: saved.order_number })
      : t('sales.savedNoNumber');
    // SPEC-005 AC-12: sprzedaż z książki → powrót do wpisu tej osoby z nowym uprawnieniem.
    if (returnUrl && !guest && person?.id === presetId && !invoiceError) return window.location.assign(returnUrl);
    person = null;
    form.reset();
    invoiceFor = undefined;
    renderPerson();
    await loadToday();
  });

  const returnUrl = entryReturnUrl(window.location.search);
  if (returnUrl) {
    query<HTMLElement>(root, '[data-back-to-entry]').hidden = false;
    query<HTMLAnchorElement>(root, '[data-back-link]').href = returnUrl;
  }
  renderPerson();
  const presetId = personIdFromSearch(window.location.search);
  await Promise.all([loadItems(), loadToday(), presetId ? selectBy('staff_person_by_id', { p_id: presetId }) : null]);
}
