/**
 * Wyspa wpisu osoby z kontem w `/panel/ksiazka/` (SPEC-005 US-3, US-4: AC-5…AC-12). Obsługa i admin.
 * Osoba: skan QR (`staff_find_by_qr`), wyszukanie (`staff_search_people`) albo `?osoba=` z karty użytkownika
 * lub po sprzedaży na miejscu (`staff_person_by_id`). Braki danych — `staff_complete_profile` (wpis w `audit_log`).
 * Uprawnienia w kolejności AC-10 — `passes_for_range_entry`. Osoba bez konta (AC-18, AC-19): dane i sprzedaż
 * na miejscu (`create_on_site_order`), potem jej uprawnienie bez właściciela. Podpis i zapis (AC-13…AC-17) —
 * lib/range-sign-ui.ts; osoba towarzysząca (AC-20) — ten sam przebieg bez kroku uprawnienia. Prowadzący wpisu:
 * domyślnie dyżurny, „Zmień” w kroku podpisu (SPEC-007 AC-18…AC-21, lib/range-officer-picker-ui.ts).
 * Dyżurny Prowadzący z konta (SPEC-008): bez sprzedaży na miejscu — bez uprawnienia tylko osoba towarzysząca (AC-8);
 * błąd wywołania po utracie dyżuru → `DUTY_LOST_EVENT` (AC-14, komunikat w lib/range-log-ui.ts).
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { todayInWarsaw } from './calendar';
import { SALE_EVENT_COLUMNS, SEARCH_MIN_LENGTH, itemArgs, saleErrorKey, saleItems, type PersonHit, type TicketEvent } from './on-site-sales';
import { PRODUCT_COLUMNS, formatPrice, type Product } from './products';
import { requireRangeLog } from './panel';
import { LIMITS } from './profile';
import { scanQrCode } from './qr-scanner';
import {
  DUTY_CHANGED_EVENT,
  DUTY_LOST_EVENT,
  DUTY_MISSING_EVENT,
  dutyFromRows,
  dutyLost,
  type RangeDuty,
} from './range-duty';
import { blockNames, loadRangeBlocks } from './pass-blocking';
import { mountOfficerPicker } from './range-officer-picker-ui';
import { ENTRY_SAVED_EVENT } from './range-history';
import { entryDateTime, permitOrAddress, saveErrorKey, signaturePath, type EntryPerson } from './range-sign';
import { mountSignaturePad, saveRangeEntry } from './range-sign-ui';
import {
  completeErrorKey,
  entryTime,
  missingInputs,
  passEffect,
  personIdFromSearch,
  qrTokenFromScan,
  saleUrlFor,
  validateCompletion,
  type EntryPass,
  type PersonSummary,
} from './range-entry';

function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

const MISSING_LABELS = { full_name: 'account.missingFullName', permit_or_address: 'account.missingPermitOrAddress' } as const;

export async function mountRangeEntry(root: HTMLElement): Promise<void> {
  const find = query(root, '[data-find]');
  const queryInput = query<HTMLInputElement>(find, '[data-query]');
  const searchButton = query<HTMLButtonElement>(find, '[data-search]');
  const findStatus = query(find, '[data-find-status]');
  const results = query<HTMLUListElement>(find, '[data-results]');
  const card = query(root, '[data-person]');
  const warning = query(card, '[data-today-warning]');
  const body = query(card, '[data-person-body]');
  const completeForm = query<HTMLFormElement>(card, '[data-complete-form]');
  const completeStatus = query(card, '[data-complete-status]');
  const passesBox = query(card, '[data-passes]');
  const passList = query(card, '[data-pass-list]');
  const noPass = query(card, '[data-no-pass]');
  const next = query<HTMLButtonElement>(card, '[data-next]');
  const guestForm = query<HTMLFormElement>(root, '[data-guest]');
  const saleForm = query<HTMLFormElement>(root, '[data-sale]');
  const sign = query(root, '[data-sign]');
  const save = query<HTMLButtonElement>(sign, '[data-save]');
  const signError = query(sign, '[data-sign-error]');
  const done = query(root, '[data-done]');
  const dialog = query<HTMLDialogElement>(document, '[data-scan-dialog]');

  const { supabase, role } = await requireRangeLog();
  const isDuty = role === 'duty';
  /** SPEC-008 AC-14: dyżurny z konta stracił dyżur — wyspa dyżurnego pokazuje komunikat; zwraca `true`. */
  async function lostDuty(error: { code?: string; message?: string } | null | undefined): Promise<boolean> {
    if (!isDuty || !(await dutyLost(supabase, error))) return false;
    root.dispatchEvent(new CustomEvent(DUTY_LOST_EVENT));
    return true;
  }
  // SPEC-008 AC-8: dyżurny nie sprzedaje na miejscu — bez „Sprzedaj na miejscu”, komunikat o Obsłudze.
  if (isDuty) {
    query(noPass, '[data-sell]').hidden = true;
    query(noPass, '[data-no-pass-text]').textContent = t('rangeEntry.noPassDuty');
  }
  let person: PersonSummary | null = null;
  let passes: EntryPass[] = [];
  /** AC-20: kolejna osoba wpisywana jako towarzysząca (bez kroku uprawnienia). */
  let companion = false;
  /** Osoba bez konta (AC-18): dane z formularza, uprawnienie ze sprzedaży na miejscu (AC-19). */
  let guest: EntryPerson | null = null;
  let entryData: EntryPerson | null = null;
  let entryPassId: string | null = null;
  /** Identyfikator wpisu = nazwa pliku podpisu; ten sam przy ponowieniu, nowy po zmianie podpisu (AC-16). */
  let entry: { id: string; path: string; version: number } | null = null;
  let saving = false;
  /** Prowadzący tego wpisu — dyżurny z chwili otwarcia kroku podpisu (SPEC-007 §7) albo wybrany „Zmień” (AC-20). */
  let officerId: string | null = null;
  const pad = mountSignaturePad(query<HTMLCanvasElement>(sign, '[data-pad]'), () => {
    save.disabled = saving || !pad.complete; // AC-14
  });

  const name = () => person?.full_name ?? t('sales.noName');
  const chosenPass = () => passList.querySelector<HTMLInputElement>('input[name="pass"]:checked')?.value ?? null;
  const updateNext = () => {
    next.disabled = !person?.is_range_ready || !warning.hidden || (!companion && !chosenPass());
  };

  type Step = 'find' | 'person' | 'guest' | 'sale' | 'sign' | 'done';
  const steps: Record<Step, HTMLElement> = { find, person: card, guest: guestForm, sale: saleForm, sign, done };
  function showStep(step: Step): void {
    for (const [name, element] of Object.entries(steps)) element.hidden = name !== step;
    query(find, '[data-companion-note]').hidden = !companion;
    // §6: tryb „podaj urządzenie” — bez nawigacji panelu podczas podpisu.
    document.body.classList.toggle('handover', step === 'sign');
  }

  function renderPasses(): void {
    const today = todayInWarsaw();
    passList.replaceChildren(
      ...passes.map((pass, index) => {
        const label = document.createElement('label');
        label.className = 'choice';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'pass';
        input.value = pass.id;
        input.checked = index === 0; // AC-10: domyślnie pierwsza pozycja
        input.addEventListener('change', updateNext);
        const { key, params } = passEffect(pass, today);
        label.append(input, document.createTextNode(` ${t(key, params)}`));
        return label;
      }),
    );
    passesBox.hidden = passes.length === 0;
    noPass.hidden = passes.length > 0;
    query<HTMLAnchorElement>(noPass, '[data-sell]').href = saleUrlFor(person!.id);
    updateNext();
  }

  // SPEC-012 AC-42: w dzień blokady komunikat; listę (tylko wejściówki) zwraca już baza.
  const blockedNotice = query(card, '[data-range-blocked]');
  async function loadPasses(): Promise<void> {
    const error = query(card, '[data-passes-error]');
    const [result, blocks] = await Promise.all([
      supabase.rpc('passes_for_range_entry', { p_user_id: person!.id }),
      loadRangeBlocks(supabase, todayInWarsaw()),
    ]);
    if (await lostDuty(result.error)) return;
    blockedNotice.textContent = blocks.length ? t('passBlocking.rangeEntry', { name: blockNames(blocks) }) : '';
    blockedNotice.hidden = blocks.length === 0;
    error.hidden = !result.error;
    passes = result.error ? [] : ((result.data ?? []) as EntryPass[]);
    if (!result.error) renderPasses();
  }

  function renderPerson(): void {
    const current = person!;
    query(card, '[data-person-name]').textContent = name();
    query(card, '[data-ready]').hidden = !current.is_range_ready;
    const missing = query(card, '[data-missing]');
    missing.hidden = current.is_range_ready;
    query(missing, '[data-missing-list]').replaceChildren(
      ...current.missing_fields.map((field) => {
        const li = document.createElement('li');
        li.textContent = t(MISSING_LABELS[field as keyof typeof MISSING_LABELS] ?? 'account.missingFullName');
        return li;
      }),
    );
    const fields = missingInputs(current.missing_fields);
    for (const wrapper of completeForm.querySelectorAll<HTMLElement>('[data-field]')) {
      wrapper.hidden = !fields.includes(wrapper.dataset.field as never);
    }
    query(completeForm, '[data-complete-hint]').hidden = !fields.includes('address');
    if (current.is_range_ready) completeForm.hidden = true;
    passesBox.hidden = true;
    noPass.hidden = true;
    blockedNotice.hidden = true;
    if (current.is_range_ready && !companion) void loadPasses();
    updateNext();
  }

  /** AC-9: dzisiejszy wpis → ostrzeżenie; reszta ekranu dopiero po „Kontynuuj”. */
  function selectPerson(summary: PersonSummary): void {
    person = summary;
    guest = null;
    passes = [];
    results.replaceChildren();
    findStatus.textContent = '';
    completeStatus.textContent = '';
    completeForm.reset();
    completeForm.hidden = true;
    warning.hidden = !summary.last_entry_today;
    body.hidden = Boolean(summary.last_entry_today);
    if (summary.last_entry_today) {
      query(warning, '[data-today-text]').textContent = t('rangeEntry.todayWarning', { time: entryTime(summary.last_entry_today) });
    }
    showStep('person');
    renderPerson();
    query(card, '[data-person-name]').focus();
  }

  async function search(): Promise<void> {
    const text = queryInput.value.trim();
    results.replaceChildren();
    if (text.length < SEARCH_MIN_LENGTH) {
      findStatus.textContent = t('sales.searchHint', { min: SEARCH_MIN_LENGTH });
      return;
    }
    searchButton.disabled = true;
    findStatus.textContent = t('sales.searching');
    const { data, error } = await supabase.rpc('staff_search_people', { p_query: text });
    searchButton.disabled = false;
    if (await lostDuty(error)) return;
    if (error) {
      findStatus.textContent = t('sales.searchError');
      return;
    }
    const hits = (data ?? []) as PersonHit[];
    findStatus.textContent = hits.length ? '' : t('sales.noResults');
    for (const hit of hits) {
      const hitName = hit.full_name ?? t('sales.noName');
      const li = document.createElement('li');
      li.className = 'card';
      const label = document.createElement('p');
      label.textContent = hit.email_hint ? `${hitName} · ${hit.email_hint}` : hitName;
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'button';
      choose.textContent = t('sales.choose');
      choose.setAttribute('aria-label', t('sales.chooseLabel', { name: hitName }));
      choose.addEventListener('click', () => void loadPerson('staff_person_by_id', { p_id: hit.id }));
      li.append(label, choose);
      results.append(li);
    }
  }

  async function loadPerson(fn: 'staff_find_by_qr' | 'staff_person_by_id', args: Record<string, string>): Promise<void> {
    const { data, error } = await supabase.rpc(fn, args);
    const found = ((data ?? []) as PersonSummary[])[0];
    if (found) return selectPerson(found);
    if (await lostDuty(error)) return;
    showStep('find');
    findStatus.textContent = error ? t('rangeEntry.qrError') : t(fn === 'staff_find_by_qr' ? 'rangeEntry.qrNotFound' : 'rangeEntry.errorPerson');
  }

  query(find, '[data-scan]').addEventListener('click', async () => {
    findStatus.textContent = '';
    const text = await scanQrCode(dialog);
    if (text === null) return;
    const token = qrTokenFromScan(text);
    if (!token) {
      findStatus.textContent = t('rangeEntry.qrNotFound');
      return;
    }
    await loadPerson('staff_find_by_qr', { p_token: token });
  });
  searchButton.addEventListener('click', () => void search());
  queryInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void search();
    }
  });

  query(warning, '[data-today-continue]').addEventListener('click', () => {
    warning.hidden = true;
    body.hidden = false;
    updateNext();
  });
  query(card, '[data-complete-open]').addEventListener('click', () => {
    completeForm.hidden = false;
    completeForm.querySelector<HTMLInputElement>('[data-field]:not([hidden]) input')?.focus();
  });

  // AC-7: tylko brakujące pola, walidacja jak SPEC-002; zapis w bazie dopisuje `audit_log`.
  completeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formError = query(completeForm, '[data-complete-error]');
    formError.hidden = true;
    const input = Object.fromEntries(new FormData(completeForm)) as Record<string, string>;
    const { errors, complete, values } = validateCompletion(person!.missing_fields, input);
    for (const output of completeForm.querySelectorAll<HTMLElement>('[data-error-for]')) {
      const field = output.dataset.errorFor as keyof typeof LIMITS;
      const kind = errors[field];
      output.textContent =
        kind === 'permitPair' ? t('profile.errorPermitPair') : kind ? t('profile.errorLength', LIMITS[field]) : '';
      output.hidden = !kind;
    }
    if (!complete) {
      formError.textContent = Object.keys(errors).length ? t('profile.saveError') : t('rangeEntry.completeHint');
      formError.hidden = false;
      return;
    }
    const submit = query<HTMLButtonElement>(completeForm, '[data-complete-submit]');
    submit.disabled = true;
    const { data, error } = await supabase.rpc('staff_complete_profile', {
      p_id: person!.id,
      p_full_name: values.full_name ?? null,
      p_permit_number: values.permit_number ?? null,
      p_permit_authority: values.permit_authority ?? null,
      p_address: values.address ?? null,
    });
    submit.disabled = false;
    if (await lostDuty(error)) return;
    const updated = ((data ?? []) as PersonSummary[])[0];
    if (error || !updated) {
      formError.textContent = t(completeErrorKey(error));
      formError.hidden = false;
      return;
    }
    person = { ...updated, last_entry_today: person!.last_entry_today };
    completeForm.hidden = true;
    completeStatus.textContent = t('rangeEntry.completeSaved');
    renderPerson();
  });

  /** SPEC-007 AC-16, AC-17, §7: Prowadzący wpisu = dyżurny pobrany z bazy przy rozpoczęciu każdego wpisu. */
  function setOfficer(duty: RangeDuty | null): void {
    officerId = duty?.range_officer_id ?? null;
    query(sign, '[data-sign-field="officer"]').textContent = duty?.full_name ?? '';
  }

  /**
   * SPEC-007 AC-18…AC-21: „Prowadzący: …” + „Zmień” w kroku podpisu. Wybór dotyczy tylko tego wpisu — dyżurny
   * się nie zmienia (AC-20); osoba wpisywana jest pierwsza na liście, ale nie jest wybierana automatycznie (AC-21).
   */
  const officerPicker = query(sign, '[data-entry-officer-picker]');
  const officerChange = query<HTMLButtonElement>(sign, '[data-entry-officer-change]');
  const showOfficerPicker = (show: boolean) => {
    officerPicker.hidden = !show;
    officerChange.hidden = show;
  };
  const entryOfficers = mountOfficerPicker(query(officerPicker, '[data-officer-picker]'), supabase, (officer) => {
    officerId = officer.id;
    query(sign, '[data-sign-field="officer"]').textContent = officer.full_name;
    signError.hidden = true;
    showOfficerPicker(false);
    officerChange.focus();
  });
  async function openOfficerPicker(): Promise<void> {
    // AC-18: osoba z kontem (także towarzysząca) — jej zatwierdzone uprawnienia na początku; osoba bez konta — bez.
    if (!(await entryOfficers.open(person?.id ?? null))) {
      signError.textContent = t('panel.loadError');
      signError.hidden = false;
      return;
    }
    showOfficerPicker(true);
    entryOfficers.focusFirst();
  }
  officerChange.addEventListener('click', () => void openOfficerPicker());
  query(officerPicker, '[data-entry-officer-cancel]').addEventListener('click', () => {
    showOfficerPicker(false);
    officerChange.focus();
  });
  root.addEventListener(DUTY_CHANGED_EVENT, (event) => {
    setOfficer((event as CustomEvent<RangeDuty | null>).detail);
    signError.hidden = true;
  });

  /**
   * Aktualny dyżurny do wpisu. AC-17: źródło z prowadzącym spoza listy jest pomijane (baza); gdy żadne nie wskazuje
   * prowadzącego — komunikat i ponowny wybór dyżurnego (AC-15, lib/range-log-ui.ts). Zwraca, czy dyżurny jest.
   */
  async function loadEntryOfficer(): Promise<boolean> {
    const { data, error } = await supabase.rpc('current_range_duty');
    if (await lostDuty(error)) return false;
    const duty = error ? null : dutyFromRows(data);
    setOfficer(duty);
    if (duty) return true;
    signError.textContent = t(error ? 'panel.loadError' : 'rangeSign.errorOfficer');
    signError.hidden = false;
    if (!error) root.dispatchEvent(new CustomEvent(DUTY_MISSING_EVENT));
    return false;
  }

  /** AC-13: ekran podpisu z danymi wpisu, regulaminem i (osoba bez konta) klauzulą informacyjną. */
  async function openSign(passText: string): Promise<void> {
    const values: Record<string, string> = {
      time: entryDateTime(new Date()),
      name: entryData!.full_name ?? '',
      permit: permitOrAddress(entryData!),
      officer: '',
      pass: passText,
    };
    for (const field of sign.querySelectorAll<HTMLElement>('[data-sign-field]')) {
      field.textContent = values[field.dataset.signField!];
    }
    query(sign, '[data-guest-notice]').hidden = !guest;
    query(sign, '[data-other-pass]').hidden = true;
    signError.hidden = true;
    showOfficerPicker(false);
    showStep('sign');
    query(sign, '#sign-heading').focus();
    await loadEntryOfficer();
  }

  async function goNext(asCompanion: boolean): Promise<void> {
    companion ||= asCompanion;
    const pass = companion ? undefined : passes.find((item) => item.id === chosenPass());
    const { data, error } = await supabase.rpc('staff_person_entry_data', { p_id: person!.id });
    if (await lostDuty(error)) return;
    entryData = ((data ?? []) as EntryPerson[])[0] ?? { full_name: person!.full_name, permit_number: null, permit_authority: null, address: null };
    entryPassId = pass?.id ?? null;
    const effect = pass && passEffect(pass, todayInWarsaw());
    await openSign(effect ? t(effect.key, effect.params) : t('rangeSign.companionPass'));
  }
  next.addEventListener('click', () => void goNext(false));
  query(card, '[data-companion]').addEventListener('click', () => void goNext(true));

  // AC-18: osoba bez konta — imię i nazwisko oraz decyzja z organem albo adres (walidacja SPEC-002).
  const guestNoPass = query(guestForm, '[data-guest-no-pass]');
  query(find, '[data-guest-open]').addEventListener('click', () => {
    guestForm.reset();
    guestNoPass.hidden = true;
    showStep('guest');
    query(guestForm, '#guest-heading').focus();
  });
  guestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = Object.fromEntries(new FormData(guestForm)) as Record<string, string>;
    const { errors, complete, values } = validateCompletion(['full_name', 'permit_or_address'], input);
    for (const output of guestForm.querySelectorAll<HTMLElement>('[data-error-for]')) {
      const kind = errors[output.dataset.errorFor as keyof typeof LIMITS];
      output.textContent = kind === 'permitPair' ? t('profile.errorPermitPair') : kind ? t('profile.errorLength', LIMITS[output.dataset.errorFor as keyof typeof LIMITS]) : '';
      output.hidden = !kind;
    }
    const formError = query(guestForm, '[data-guest-error]');
    formError.textContent = Object.keys(errors).length ? t('profile.saveError') : t('rangeEntry.completeHint');
    formError.hidden = complete;
    if (!complete) return;
    person = null;
    guest = entryData = values as EntryPerson;
    entryPassId = null;
    if (companion) return void openSign(t('rangeSign.companionPass'));
    // SPEC-008 AC-8: osoba bez konta nie ma uprawnienia, a dyżurny nie sprzedaje — tylko osoba towarzysząca.
    if (isDuty) {
      guestNoPass.hidden = false;
      return query(guestNoPass, '[data-guest-companion]').focus();
    }
    void openSale();
  });
  query(guestNoPass, '[data-guest-companion]').addEventListener('click', () => {
    companion = true;
    void openSign(t('rangeSign.companionPass'));
  });

  // AC-19: osoba bez konta płaci na miejscu — wejście jednorazowe na dziś albo wejściówka na dzisiejsze wydarzenie.
  const itemSelect = query<HTMLSelectElement>(saleForm, '[data-item]');
  const saleError = query(saleForm, '[data-sale-error]');
  async function openSale(): Promise<void> {
    saleForm.reset();
    saleError.hidden = true;
    showStep('sale');
    query(saleForm, '#sale-heading').focus();
    const today = todayInWarsaw();
    const [products, events, blocks] = await Promise.all([
      supabase.from('products').select(PRODUCT_COLUMNS).eq('is_active', true).order('kind').order('position'),
      supabase.from('calendar_events').select(SALE_EVENT_COLUMNS).eq('status', 'published').eq('access_mode', 'paid')
        .is('cancelled_at', null).lte('starts_on', today).or(`ends_on.gte.${today},ends_on.is.null`),
      loadRangeBlocks(supabase, today),
    ]);
    // SPEC-012 AC-42, AC-43: w dzień blokady osobie bez konta — tylko wejściówka.
    const items = saleItems((products.data ?? []) as Product[], (events.data ?? []) as TicketEvent[], today, true,
      (name) => t('offer.ticketName', { name }), blocks.length > 0);
    itemSelect.replaceChildren(itemSelect.options[0]);
    for (const item of items) {
      itemSelect.add(new Option(t('sales.itemOption', { name: item.name, price: formatPrice(item.price) }), item.value));
    }
    saleError.textContent = products.error || events.error ? t('panel.loadError') : t('rangeSign.saleItemsEmpty');
    saleError.hidden = items.length > 0 && !products.error && !events.error;
  }
  saleForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const args = itemArgs(itemSelect.value);
    const method = saleForm.querySelector<HTMLInputElement>('input[name="method"]:checked')?.value;
    saleError.textContent = !args ? t('sales.itemRequired') : t('sales.methodRequired');
    saleError.hidden = Boolean(args && method);
    if (!args || !method) return;
    const submit = query<HTMLButtonElement>(saleForm, '[data-sale-submit]');
    submit.disabled = true;
    const order = await supabase.rpc('create_on_site_order', { p_user_id: null, p_on_site_method: method, ...args });
    const pass = order.error ? null : await supabase.from('user_passes').select('id').eq('order_id', order.data as string).single();
    submit.disabled = false;
    if (order.error || !pass?.data) {
      saleError.textContent = order.error ? t(saleErrorKey(order.error)) : t('rangeSign.salePassError');
      saleError.hidden = false;
      return;
    }
    entryPassId = (pass.data as { id: string }).id;
    await openSign(itemSelect.selectedOptions[0]?.text ?? '');
  });

  // AC-15, AC-16: podpis do bucketu, wpis i zużycie w jednej transakcji; po błędzie podpis zostaje na ekranie.
  save.addEventListener('click', async () => {
    signError.hidden = true;
    if (!officerId) await loadEntryOfficer();
    const entryOfficerId = officerId;
    if (!entryOfficerId) return;
    if (!entry || entry.version !== pad.version) {
      const id = crypto.randomUUID();
      entry = { id, path: signaturePath(id), version: pad.version };
    }
    saving = save.disabled = true;
    save.textContent = t('rangeSign.saving');
    const png = await pad.toPng();
    const result = png
      ? await saveRangeEntry(supabase, {
          ...entry, png, officerId: entryOfficerId, profileId: person?.id ?? null, passId: entryPassId, companion, guest,
        })
      : { error: {} };
    saving = false;
    save.disabled = !pad.complete;
    save.textContent = t('rangeSign.save');
    if ('error' in result) {
      if (await lostDuty(result.error)) return;
      const key = saveErrorKey(result.error);
      // AC-17, §7: wybrany prowadzący zniknął z listy w trakcie wpisu — domyślnie aktualny dyżurny i lista wyboru;
      // podpis zostaje na ekranie.
      if (key === 'rangeSign.errorOfficerInactive') {
        if (!(await loadEntryOfficer())) return;
        await openOfficerPicker();
      }
      signError.textContent = t(key);
      signError.hidden = false;
      query(sign, '[data-other-pass]').hidden = key !== 'rangeSign.errorPassUsed' || !person;
      return;
    }
    // AC-17: potwierdzenie; dalej osoba towarzysząca albo następna osoba.
    query(done, '[data-done-text]').textContent = t('rangeSign.done', { name: entryData!.full_name ?? '', time: entryTime(result.entered_at) });
    entry = null;
    pad.clear();
    showStep('done');
    // AC-21: lista dzisiejszych wpisów (lib/range-today-ui.ts) odświeża się po zapisie.
    root.dispatchEvent(new CustomEvent(ENTRY_SAVED_EVENT));
    query(done, '[data-done-text]').focus();
  });
  query(sign, '[data-clear]').addEventListener('click', () => pad.clear());
  query(sign, '[data-other-pass]').addEventListener('click', () => {
    showStep('person');
    void loadPasses();
  });

  const restart = (asCompanion = false) => {
    person = guest = entryData = null;
    entryPassId = null;
    entry = null;
    companion = asCompanion;
    pad.clear();
    queryInput.value = '';
    results.replaceChildren();
    findStatus.textContent = '';
    history.replaceState(null, '', window.location.pathname);
    showStep('find');
    queryInput.focus();
  };
  query(card, '[data-other]').addEventListener('click', () => restart(companion));
  for (const back of root.querySelectorAll<HTMLButtonElement>('[data-back]')) {
    back.addEventListener('click', () => restart(companion && guestForm.contains(back)));
  }
  query(done, '[data-add-companion]').addEventListener('click', () => restart(true));

  // AC-8 (karta użytkownika) i AC-12 (powrót ze sprzedaży na miejscu): od razu ta osoba.
  const personId = personIdFromSearch(window.location.search);
  if (personId) await loadPerson('staff_person_by_id', { p_id: personId });
}
