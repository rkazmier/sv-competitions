/**
 * Wyspa `/panel/ksiazka/` — dyżurny Prowadzący (SPEC-007 US-4, AC-15…AC-17, AC-19). Obsługa i admin (`requireStaff`).
 * Bez dyżurnego na dziś: „Kto prowadzi dziś strzelanie?” z listą widocznych prowadzących i wyszukiwarką
 * „Szukaj prowadzącego” (także ukrytych dla innych). Wybór zapisuje dyżurnego w bazie dla całej strzelnicy
 * (`set_range_duty`). Z dyżurnym: „Dyżurny: …” (+ źródło) i „Zmień”. Przebieg wpisu — lib/range-entry-ui.ts.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { showLoadError, requireStaff } from './panel';
import {
  DUTY_CHANGED_EVENT,
  DUTY_MISSING_EVENT,
  OFFICER_SEARCH_MIN_LENGTH,
  dutyErrorKey,
  dutyFromRows,
  dutySourceNote,
  officerSearchQuery,
  sortOfficers,
  type RangeDuty,
  type RangeOfficer,
} from './range-duty';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export async function mountRangeLog(root: HTMLElement): Promise<void> {
  const picker = query<HTMLElement>(root, '[data-shift-picker]');
  const officersList = query<HTMLUListElement>(picker, '[data-officers]');
  const noOfficers = query<HTMLElement>(picker, '[data-no-officers]');
  const pickerError = query<HTMLElement>(picker, '[data-picker-error]');
  const searchInput = query<HTMLInputElement>(picker, '[data-officer-query]');
  const searchButton = query<HTMLButtonElement>(picker, '[data-officer-search]');
  const searchStatus = query<HTMLElement>(picker, '[data-officer-search-status]');
  const searchResults = query<HTMLUListElement>(picker, '[data-officer-results]');
  const cancel = query<HTMLButtonElement>(picker, '[data-picker-cancel]');
  const shift = query<HTMLElement>(root, '[data-shift]');
  const officerName = query<HTMLElement>(shift, '[data-officer-name]');
  const sourceNote = query<HTMLElement>(shift, '[data-duty-source]');
  const change = query<HTMLButtonElement>(shift, '[data-change-officer]');
  const template = query<HTMLTemplateElement>(root, '[data-officer-template]');

  const { supabase } = await requireStaff();
  let duty: RangeDuty | null = null;
  let picking = false;

  /** AC-15: lista wyboru — aktywni, zatwierdzeni, nieukryci (AC-18 bez osoby wpisywanej), alfabetycznie. */
  async function loadOfficers(): Promise<RangeOfficer[] | null> {
    const { data, error } = await supabase
      .from('range_officers')
      .select('id, full_name')
      .eq('is_active', true)
      .eq('status', 'approved')
      .eq('hide_from_others', false);
    return error ? null : sortOfficers((data ?? []) as RangeOfficer[]);
  }

  async function loadDuty(): Promise<boolean> {
    const { data, error } = await supabase.rpc('current_range_duty');
    if (error) return false;
    duty = dutyFromRows(data);
    return true;
  }

  function officerButtons(officers: readonly RangeOfficer[]): DocumentFragment[] {
    return officers.map((officer) => {
      const fragment = template.content.cloneNode(true) as DocumentFragment;
      const button = query<HTMLButtonElement>(fragment, '[data-officer]');
      button.textContent = officer.full_name;
      button.addEventListener('click', () => void choose(officer.id));
      return fragment;
    });
  }

  function render(): void {
    const showPicker = picking || !duty;
    picker.hidden = !showPicker;
    shift.hidden = showPicker;
    cancel.hidden = !duty;
    if (duty) {
      officerName.textContent = duty.full_name;
      const note = dutySourceNote(duty);
      sourceNote.textContent = note ? t(note.key, note.params) : '';
      sourceNote.hidden = !note;
    }
  }

  async function openPicker(): Promise<void> {
    picking = true;
    pickerError.hidden = true;
    searchInput.value = '';
    searchStatus.textContent = '';
    searchResults.replaceChildren();
    // Świeża lista — prowadzący mógł zostać dodany, zatwierdzony lub ukryty w trakcie dnia.
    const officers = await loadOfficers();
    if (!officers) return showLoadError();
    officersList.replaceChildren(...officerButtons(officers));
    noOfficers.hidden = officers.length > 0;
    render();
  }

  /** AC-15, AC-16: zapis dyżurnego na dziś dla całej strzelnicy; pierwszeństwo przed grafikiem. */
  async function choose(officerId: string): Promise<void> {
    pickerError.hidden = true;
    const { data, error } = await supabase.rpc('set_range_duty', { p_range_officer_id: officerId });
    if (error) {
      // Prowadzący zniknął z listy w międzyczasie — świeża lista, potem komunikat.
      if (error.message === 'range_officer_inactive') await openPicker();
      pickerError.textContent = t(dutyErrorKey(error));
      pickerError.hidden = false;
      return;
    }
    duty = dutyFromRows(data);
    picking = false;
    render();
    root.dispatchEvent(new CustomEvent<RangeDuty | null>(DUTY_CHANGED_EVENT, { detail: duty }));
    change.focus();
  }

  /** AC-19: wyszukiwarka — także ukryci dla innych; tylko identyfikator i imię i nazwisko. */
  async function search(): Promise<void> {
    const value = officerSearchQuery(searchInput.value);
    searchResults.replaceChildren();
    if (!value) {
      searchStatus.textContent = t('rangeLog.searchHint', { min: OFFICER_SEARCH_MIN_LENGTH });
      return;
    }
    searchButton.disabled = true;
    const { data, error } = await supabase.rpc('staff_search_range_officers', { p_query: value });
    searchButton.disabled = false;
    const found = (data ?? []) as RangeOfficer[];
    searchStatus.textContent = error ? t('panel.loadError') : found.length ? '' : t('rangeLog.searchEmpty');
    searchResults.replaceChildren(...officerButtons(found));
  }

  searchButton.addEventListener('click', () => void search());
  searchInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void search();
  });

  change.addEventListener('click', async () => {
    await openPicker();
    officersList.querySelector<HTMLButtonElement>('button')?.focus();
  });
  cancel.addEventListener('click', () => {
    picking = false;
    render();
    change.focus();
  });

  async function refresh(): Promise<void> {
    if (!(await loadDuty())) return showLoadError();
    if (!duty) await openPicker();
    else render();
  }

  // AC-17: przy nowym wpisie dyżurny okazał się niedostępny (albo minęła północ) — ponowny wybór (AC-15).
  root.addEventListener(DUTY_MISSING_EVENT, () => void refresh());
  // Urządzenie zostawione na noc: po powrocie do karty obowiązuje dyżurny nowego dnia (AC-16).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !picking) void refresh();
  });

  await refresh();
}
