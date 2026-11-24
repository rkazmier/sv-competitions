/**
 * Wyspa „Przyznaj karnet” (`/panel/zamowienia/przyznaj/`, SPEC-010 US-1, AC-1…AC-11). Tylko admin (`requireAdmin`).
 * Zapis wyłącznie funkcją bazy `grant_pass` (kwota 0, `created_by` = zalogowany admin, limit miejsc z blokadą wiersza).
 * `request_key` jest stały dla jednego wypełnienia formularza — ponowienie po błędzie sieci nie tworzy drugiego zamówienia (AC-9);
 * zmiana pola albo „Przyznaj kolejny” losuje nowy klucz. Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { todayInWarsaw } from './calendar';
import { formatDate, formatDateRange } from './dates';
import type { PersonHit } from './on-site-sales';
import { SEARCH_MIN_LENGTH } from './on-site-sales';
import {
  GRANT_EVENT_COLUMNS,
  GRANT_REASON_MAX,
  expiresRange,
  grantErrorKey,
  grantGroups,
  grantPersonFromSearch,
  orderSearchUrl,
  reasonLength,
  validateGrant,
  type GrantEvent,
  type GrantField,
  type GrantItem,
  type GrantProduct,
  type GrantResult,
} from './pass-grant';
import { requireAdmin } from './panel';
import { PRODUCT_COLUMNS, formatPrice } from './products';
import { scanQrCode } from './qr-scanner';
import { qrTokenFromScan, type PersonSummary } from './range-entry';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

const GROUP_LABEL = {
  entries: 'products.groups.entries',
  single_entry: 'products.groups.single_entry',
  ticket: 'grant.ticketGroup',
} as const;

/** AC-3: „Nazwa (ukryty w Ofercie)”; wejściówka — „Wejściówka: X — 14 czerwca 2027 — wolne: 12 / wyprzedane”. */
function optionLabel(item: GrantItem): string {
  const parts = [item.hidden ? `${item.name} ${t('grant.hiddenSuffix')}` : item.name];
  if (item.event) {
    parts.push(formatDateRange(item.event.starts_on, item.event.ends_on));
    if (item.disabled) parts.push(t('grant.soldOut'));
    else if (item.event.seats_left !== null) parts.push(t('grant.seatsLeft', { count: item.event.seats_left }));
  }
  return parts.join(' — ');
}

export async function mountPassGrant(root: HTMLElement): Promise<void> {
  const form = query<HTMLFormElement>(root, '[data-form]');
  const searchBox = query<HTMLElement>(form, '[data-search-box]');
  const queryInput = query<HTMLInputElement>(form, '[data-query]');
  const searchButton = query<HTMLButtonElement>(form, '[data-search]');
  const searchStatus = query<HTMLElement>(form, '[data-search-status]');
  const results = query<HTMLUListElement>(form, '[data-results]');
  const selectedBox = query<HTMLElement>(form, '[data-selected]');
  const selectedName = query<HTMLElement>(form, '[data-selected-name]');
  const itemSelect = query<HTMLSelectElement>(form, '[data-item]');
  const price = query<HTMLElement>(form, '[data-price]');
  const expiresBox = query<HTMLElement>(form, '[data-expires-box]');
  const expiresInput = query<HTMLInputElement>(form, '[data-expires]');
  const ticketValidity = query<HTMLElement>(form, '[data-ticket-validity]');
  const reasonInput = query<HTMLTextAreaElement>(form, '[data-reason]');
  const reasonCount = query<HTMLElement>(form, '[data-reason-count]');
  const formError = query<HTMLElement>(form, '[data-form-error]');
  const submit = query<HTMLButtonElement>(form, '[data-submit]');
  const result = query<HTMLElement>(root, '[data-result]');

  const supabase = await requireAdmin();
  let person: PersonHit | null = null;
  let items: GrantItem[] = [];
  let requestKey = crypto.randomUUID();
  const today = todayInWarsaw();
  const range = expiresRange(today);
  expiresInput.min = range.min;
  expiresInput.max = range.max;
  const maxText = () => formatDate(range.max);

  function setError(field: GrantField, message: string | null): void {
    const output = query<HTMLElement>(form, `[data-error-for="${field}"]`);
    output.textContent = message ?? '';
    output.hidden = !message;
  }

  function renderPerson(): void {
    searchBox.hidden = person !== null;
    selectedBox.hidden = person === null;
    selectedName.textContent = person ? t('sales.selected', { name: person.full_name ?? t('sales.noName') }) : '';
  }

  // AC-4, AC-5: „Ważny do” tylko dla produktu; wejściówka — tekst o ważności.
  function renderItem(): void {
    const item = items.find((i) => i.value === itemSelect.value);
    price.textContent = item ? t('grant.price', { price: formatPrice(item.price) }) : '';
    const isProduct = item !== undefined && item.kind !== 'ticket';
    expiresBox.hidden = !isProduct;
    ticketValidity.hidden = item?.kind !== 'ticket';
    if (!isProduct) setError('expiresOn', null);
  }

  function renderReasonCount(): void {
    reasonCount.textContent = t('grant.reasonCounter', { count: reasonLength(reasonInput.value), max: GRANT_REASON_MAX });
  }

  function choosePerson(hit: PersonHit): void {
    person = hit;
    results.replaceChildren();
    setError('person', null);
    requestKey = crypto.randomUUID();
    renderPerson();
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
      choose.addEventListener('click', () => choosePerson(hit));
      li.append(label, choose);
      results.append(li);
    }
  }

  async function selectBy(fn: 'staff_find_by_qr' | 'staff_person_by_id', args: Record<string, string>): Promise<void> {
    const { data, error } = await supabase.rpc(fn, args);
    const found = ((data ?? []) as PersonSummary[])[0];
    if (!found) {
      searchStatus.textContent = error ? t('rangeEntry.qrError') : t('rangeEntry.qrNotFound');
      return;
    }
    choosePerson({ id: found.id, full_name: found.full_name, email_hint: null });
  }

  async function seatsLeft(event: Omit<GrantEvent, 'seats_left'>): Promise<number | null> {
    if (event.capacity === null) return null;
    const { data, error } = await supabase.rpc('event_seats_left', { p_event_id: event.id });
    return !error && typeof data === 'number' ? data : null;
  }

  async function loadItems(): Promise<void> {
    const [productsResult, eventsResult] = await Promise.all([
      // AC-3: wszystkie produkty, także ukryte (admin czyta całą tabelę — RLS).
      supabase.from('products').select(PRODUCT_COLUMNS).order('kind').order('position'),
      supabase
        .from('calendar_events')
        .select(GRANT_EVENT_COLUMNS)
        .eq('status', 'published')
        .eq('access_mode', 'paid')
        .is('cancelled_at', null)
        .or(`ends_on.gte.${today},starts_on.gte.${today}`)
        .order('starts_on'),
    ]);
    if (productsResult.error || eventsResult.error) {
      formError.textContent = t('panel.loadError');
      formError.hidden = false;
      return;
    }
    const rawEvents = (eventsResult.data ?? []) as Omit<GrantEvent, 'seats_left'>[];
    const events: GrantEvent[] = await Promise.all(rawEvents.map(async (e) => ({ ...e, seats_left: await seatsLeft(e) })));
    const groups = grantGroups((productsResult.data ?? []) as GrantProduct[], events, today, (name) =>
      t('offer.ticketName', { name }),
    );
    items = groups.flatMap((group) => group.items);
    itemSelect.replaceChildren(itemSelect.options[0]!);
    for (const group of groups) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = t(GROUP_LABEL[group.kind]);
      for (const item of group.items) {
        const option = new Option(optionLabel(item), item.value);
        option.disabled = item.disabled;
        optgroup.append(option);
      }
      itemSelect.append(optgroup);
    }
    query<HTMLElement>(form, '[data-items-empty]').hidden = items.length > 0;
    renderItem();
  }

  function resetForm(): void {
    person = null;
    form.reset();
    expiresInput.value = range.default;
    requestKey = crypto.randomUUID();
    for (const field of ['person', 'item', 'expiresOn', 'reason'] as const) setError(field, null);
    formError.hidden = true;
    renderPerson();
    renderItem();
    renderReasonCount();
  }

  searchButton.addEventListener('click', () => void search());
  queryInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void search();
    }
  });
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
  itemSelect.addEventListener('change', () => {
    setError('item', null);
    renderItem();
  });
  reasonInput.addEventListener('input', renderReasonCount);
  // Zmiana treści żądania → nowy klucz (ten sam klucz tylko dla ponowienia identycznego żądania — AC-9).
  form.addEventListener('change', () => {
    requestKey = crypto.randomUUID();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    formError.hidden = true;
    const validation = validateGrant(
      { personId: person?.id ?? null, item: itemSelect.value, expiresOn: expiresInput.value, reason: reasonInput.value },
      today,
    );
    const errors = validation.ok ? {} : validation.errors;
    for (const field of ['person', 'item', 'expiresOn', 'reason'] as const) {
      const key = errors[field];
      setError(field, key ? t(key, { max: maxText() }) : null);
    }
    if (!validation.ok) return;

    // AC-9: przycisk zablokowany do odpowiedzi.
    submit.disabled = true;
    submit.textContent = t('grant.saving');
    const { data, error } = await supabase.rpc('grant_pass', { ...validation.args, p_request_key: requestKey });
    submit.disabled = false;
    submit.textContent = t('grant.submit');
    if (error) {
      formError.textContent = t(grantErrorKey(error), { max: maxText() });
      formError.hidden = false;
      return;
    }
    // AC-8: potwierdzenie z numerem zamówienia, „Przyznaj kolejny” i „Pokaż zamówienie”.
    const granted = data as GrantResult;
    const item = items.find((i) => i.value === itemSelect.value);
    query<HTMLElement>(result, '[data-result-text]').textContent = t('grant.granted', {
      item: item?.name ?? '',
      person: person?.full_name ?? t('sales.noName'),
      number: granted.order_number,
    });
    query<HTMLAnchorElement>(result, '[data-show-order]').href = orderSearchUrl(granted.order_number);
    form.hidden = true;
    result.hidden = false;
    query<HTMLButtonElement>(result, '[data-another]').focus();
  });

  query<HTMLButtonElement>(result, '[data-another]').addEventListener('click', () => {
    resetForm();
    result.hidden = true;
    form.hidden = false;
    void loadItems();
    queryInput.focus();
  });

  resetForm();
  const presetId = grantPersonFromSearch(window.location.search);
  await Promise.all([loadItems(), presetId ? selectBy('staff_person_by_id', { p_id: presetId }) : null]);
}
