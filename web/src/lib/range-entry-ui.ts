/**
 * Wyspa wpisu osoby z kontem w `/panel/ksiazka/` (SPEC-005 US-3, US-4: AC-5…AC-12). Obsługa i admin.
 * Osoba: skan QR (`staff_find_by_qr`), wyszukanie (`staff_search_people`) albo `?osoba=` z karty użytkownika
 * lub po sprzedaży na miejscu (`staff_person_by_id`). Braki danych — `staff_complete_profile` (wpis w `audit_log`).
 * Uprawnienia w kolejności AC-10 — `passes_for_range_entry`. Podpis i zapis wpisu — zadanie #61.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { todayInWarsaw } from './calendar';
import { SEARCH_MIN_LENGTH, type PersonHit } from './on-site-sales';
import { requireStaff } from './panel';
import { LIMITS } from './profile';
import { scanQrCode } from './qr-scanner';
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
  const nextStep = query(root, '[data-next-step]');
  const dialog = query<HTMLDialogElement>(document, '[data-scan-dialog]');

  const { supabase } = await requireStaff();
  let person: PersonSummary | null = null;
  let passes: EntryPass[] = [];

  const name = () => person?.full_name ?? t('sales.noName');
  const chosenPass = () => passList.querySelector<HTMLInputElement>('input[name="pass"]:checked')?.value ?? null;
  const updateNext = () => {
    next.disabled = !person?.is_range_ready || !warning.hidden || !chosenPass();
  };

  function showStep(step: 'find' | 'person' | 'next'): void {
    find.hidden = step !== 'find';
    card.hidden = step !== 'person';
    nextStep.hidden = step !== 'next';
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

  async function loadPasses(): Promise<void> {
    const error = query(card, '[data-passes-error]');
    const result = await supabase.rpc('passes_for_range_entry', { p_user_id: person!.id });
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
    if (current.is_range_ready) void loadPasses();
    updateNext();
  }

  /** AC-9: dzisiejszy wpis → ostrzeżenie; reszta ekranu dopiero po „Kontynuuj”. */
  function selectPerson(summary: PersonSummary): void {
    person = summary;
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

  function goNext(companion: boolean): void {
    // Wybór (osoba, uprawnienie albo osoba towarzysząca) przejmie krok podpisu (#61).
    const pass = companion ? undefined : passes.find((item) => item.id === chosenPass());
    const effect = pass && passEffect(pass, todayInWarsaw());
    query(nextStep, '[data-next-summary]').textContent = effect
      ? t('rangeEntry.chosenPass', { name: name(), effect: t(effect.key, effect.params) })
      : t('rangeEntry.chosenCompanion', { name: name() });
    showStep('next');
  }
  next.addEventListener('click', () => goNext(false));
  query(card, '[data-companion]').addEventListener('click', () => goNext(true));

  const restart = () => {
    person = null;
    queryInput.value = '';
    history.replaceState(null, '', window.location.pathname);
    showStep('find');
    queryInput.focus();
  };
  query(card, '[data-other]').addEventListener('click', restart);
  query(nextStep, '[data-restart]').addEventListener('click', restart);

  // AC-8 (karta użytkownika) i AC-12 (powrót ze sprzedaży na miejscu): od razu ta osoba.
  const personId = personIdFromSearch(window.location.search);
  if (personId) await loadPerson('staff_person_by_id', { p_id: personId });
}
