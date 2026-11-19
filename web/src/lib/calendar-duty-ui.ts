/**
 * Pole „Dyżurny Prowadzący (opcjonalnie)” w formularzach zawodów i wydarzeń (SPEC-007 US-7, AC-26, AC-28) —
 * components/DutyOfficerField.astro. Wczytanie przez `admin_calendar_duty` (kolumna niepubliczna, AC-30);
 * wybór z listy i wyszukiwarki (lib/range-officer-picker-ui.ts); zapis robi formularz razem z resztą pól.
 * Tekst z bazy — wyłącznie `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { calendarDutyFromRows, type CalendarDuty, type CalendarKind } from './calendar-duty';
import { mountOfficerPicker } from './range-officer-picker-ui';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export interface DutyField {
  /** Wybrany prowadzący do zapisu (`null` — „Nie wskazano”). */
  value(): string | null;
  /** Wczytuje zapisanego dyżurnego (`id` — zawody / wydarzenie; bez `id` — „Nie wskazano”); `false` przy błędzie. */
  load(id: string | null): Promise<boolean>;
  /** Komunikat przy polu po nieudanym zapisie (AC-28, AC-29); `null` czyści. */
  showError(message: string | null): void;
  focus(): void;
}

export function mountDutyField(root: HTMLElement, supabase: SupabaseClient, kind: CalendarKind): DutyField {
  const current = query<HTMLElement>(root, '[data-duty-current]');
  const unavailable = query<HTMLElement>(root, '[data-duty-unavailable]');
  const unsaved = query<HTMLElement>(root, '[data-duty-unsaved]');
  const actions = query<HTMLElement>(root, '[data-duty-actions]');
  const choose = query<HTMLButtonElement>(root, '[data-duty-choose]');
  const chooseLabel = query<HTMLElement>(root, '[data-duty-choose-label]');
  const clear = query<HTMLButtonElement>(root, '[data-duty-clear]');
  const pickerBox = query<HTMLElement>(root, '[data-duty-picker]');
  const cancel = query<HTMLButtonElement>(root, '[data-duty-cancel]');
  const error = query<HTMLElement>(root, '[data-duty-error]');

  /** Zapisany w bazie i wybrany w formularzu (różnica = zmiana do zapisania). */
  let saved: CalendarDuty | null = null;
  let selected: { id: string; full_name: string } | null = null;

  function render(): void {
    current.textContent = selected?.full_name ?? t('calendarDuty.none');
    const unchanged = (selected?.id ?? null) === (saved?.range_officer_id ?? null);
    unavailable.hidden = !(unchanged && saved && !saved.on_list);
    unsaved.hidden = unchanged;
    chooseLabel.textContent = selected ? t('calendarDuty.change') : t('calendarDuty.choose');
    clear.hidden = !selected;
  }

  function closePicker(): void {
    pickerBox.hidden = true;
    actions.hidden = false;
  }

  const picker = mountOfficerPicker(query<HTMLElement>(pickerBox, '[data-officer-picker]'), supabase, (officer) => {
    selected = officer;
    field.showError(null);
    closePicker();
    render();
    choose.focus();
  });

  choose.addEventListener('click', async () => {
    field.showError(null);
    choose.disabled = true;
    const ok = await picker.open();
    choose.disabled = false;
    if (!ok) return field.showError(t('panel.loadError'));
    actions.hidden = true;
    pickerBox.hidden = false;
    picker.focusFirst();
  });
  cancel.addEventListener('click', () => {
    closePicker();
    choose.focus();
  });
  clear.addEventListener('click', () => {
    selected = null;
    field.showError(null);
    render();
    choose.focus();
  });

  const field: DutyField = {
    value: () => selected?.id ?? null,
    async load(id) {
      if (id) {
        const { data, error: loadError } = await supabase.rpc('admin_calendar_duty', { p_kind: kind, p_id: id });
        if (loadError) return false;
        saved = calendarDutyFromRows(data);
      } else {
        saved = null;
      }
      selected = saved ? { id: saved.range_officer_id, full_name: saved.full_name } : null;
      closePicker();
      render();
      return true;
    },
    showError(message) {
      error.textContent = message ?? '';
      error.hidden = !message;
    },
    focus() {
      choose.focus();
    },
  };
  render();
  return field;
}
