/**
 * Wyspa `/panel/ksiazka/` — dyżurny Prowadzący (SPEC-007 US-4, AC-15…AC-17, AC-19). Obsługa i admin (`requireStaff`).
 * Bez dyżurnego na dziś: „Kto prowadzi dziś strzelanie?” z listą widocznych prowadzących i wyszukiwarką
 * „Szukaj prowadzącego” (także ukrytych dla innych) — lib/range-officer-picker-ui.ts. Wybór zapisuje dyżurnego
 * w bazie dla całej strzelnicy (`set_range_duty`). Z dyżurnym: „Dyżurny: …” (+ źródło) i „Zmień”.
 * Przebieg wpisu — lib/range-entry-ui.ts. Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { showLoadError, requireStaff } from './panel';
import { DUTY_CHANGED_EVENT, DUTY_MISSING_EVENT, dutyErrorKey, dutyFromRows, dutySourceNote, type RangeDuty } from './range-duty';
import { mountOfficerPicker } from './range-officer-picker-ui';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export async function mountRangeLog(root: HTMLElement): Promise<void> {
  const picker = query<HTMLElement>(root, '[data-shift-picker]');
  const pickerError = query<HTMLElement>(picker, '[data-picker-error]');
  const cancel = query<HTMLButtonElement>(picker, '[data-picker-cancel]');
  const shift = query<HTMLElement>(root, '[data-shift]');
  const officerName = query<HTMLElement>(shift, '[data-officer-name]');
  const sourceNote = query<HTMLElement>(shift, '[data-duty-source]');
  const change = query<HTMLButtonElement>(shift, '[data-change-officer]');

  const { supabase } = await requireStaff();
  let duty: RangeDuty | null = null;
  let picking = false;
  // AC-15: lista jak AC-18 bez osoby wpisywanej (`range_officer_choices`) i wyszukiwarka (AC-19).
  const officers = mountOfficerPicker(query<HTMLElement>(picker, '[data-officer-picker]'), supabase, (officer) => {
    void choose(officer.id);
  });

  async function loadDuty(): Promise<boolean> {
    const { data, error } = await supabase.rpc('current_range_duty');
    if (error) return false;
    duty = dutyFromRows(data);
    return true;
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
    if (!(await officers.open())) return showLoadError();
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

  change.addEventListener('click', async () => {
    await openPicker();
    officers.focusFirst();
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
