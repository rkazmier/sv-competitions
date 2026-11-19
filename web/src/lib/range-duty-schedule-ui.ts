/**
 * Wyspa `/panel/dyzury/` — grafik dyżurów (SPEC-007 US-6, AC-22…AC-25). Obsługa i admin (`requireStaff`).
 * Dni z `range_duty_schedule`; „Ustaw” / „Zmień” otwiera pod dniem listę prowadzących (AC-15) z wyszukiwarką (AC-19)
 * i zapisuje wpis grafiku (`set_scheduled_range_duty`); „Usuń z grafiku” — `clear_scheduled_range_duty`. Po każdej
 * zmianie grafik jest wczytywany ponownie z bazy. Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { requireStaff, showLoadError } from './panel';
import {
  SCHEDULE_MAX_DAYS,
  SCHEDULE_PAGE_DAYS,
  dayHint,
  dutySourceLabel,
  formatScheduleDay,
  hasScheduleEntry,
  nextDayCount,
  scheduleErrorKey,
  scheduleRows,
  setLabelKey,
  type ScheduleDay,
} from './range-duty-schedule';
import { mountOfficerPicker } from './range-officer-picker-ui';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export async function mountDutySchedule(root: HTMLElement): Promise<void> {
  const list = query<HTMLOListElement>(root, '[data-days]');
  const template = query<HTMLTemplateElement>(root, '[data-day-template]');
  const status = query<HTMLElement>(root, '[data-schedule-status]');
  const more = query<HTMLButtonElement>(root, '[data-show-more]');
  const picker = query<HTMLElement>(root, '[data-day-picker]');
  const pickerHeading = query<HTMLElement>(picker, '[data-picker-heading]');
  const pickerError = query<HTMLElement>(picker, '[data-picker-error]');
  const cancel = query<HTMLButtonElement>(picker, '[data-picker-cancel]');

  const { supabase } = await requireStaff();
  let dayCount = SCHEDULE_PAGE_DAYS;
  /** Dzień, dla którego otwarta jest lista wyboru. */
  let picking: string | null = null;

  const officers = mountOfficerPicker(query<HTMLElement>(picker, '[data-officer-picker]'), supabase, (officer) => {
    if (picking) void save(picking, officer.id);
  });

  const setButton = (day: string) => list.querySelector<HTMLButtonElement>(`[data-day="${day}"] [data-day-set]`);

  function closePicker(): void {
    picking = null;
    picker.hidden = true;
    root.append(picker);
  }

  function renderDay(day: ScheduleDay, isToday: boolean): DocumentFragment {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const item = query<HTMLLIElement>(fragment, 'li');
    const date = formatScheduleDay(day.day);
    item.dataset.day = day.day;
    query<HTMLElement>(item, '[data-day-date]').textContent = date;
    query<HTMLElement>(item, '[data-day-today]').hidden = !isToday;
    query<HTMLElement>(item, '[data-day-officer]').textContent = day.full_name ?? t('rangeDutySchedule.noDuty');
    const source = dutySourceLabel(day);
    const sourceTag = query<HTMLElement>(item, '[data-day-source]');
    sourceTag.textContent = source ? t(source.key, source.params) : '';
    sourceTag.hidden = !source;
    const hint = dayHint(day);
    const hintText = query<HTMLElement>(item, '[data-day-hint]');
    hintText.textContent = hint ? t(hint.key, hint.params) : '';
    hintText.hidden = !hint;
    for (const sr of item.querySelectorAll<HTMLElement>('[data-day-sr]')) sr.textContent = ` ${t('rangeDutySchedule.actionSr', { date })}`;
    query<HTMLElement>(item, '[data-day-set-label]').textContent = t(setLabelKey(day));
    query<HTMLButtonElement>(item, '[data-day-set]').addEventListener('click', () => void openPicker(day.day));
    const clear = query<HTMLButtonElement>(item, '[data-day-clear]');
    clear.hidden = !hasScheduleEntry(day);
    clear.addEventListener('click', () => void clearDay(day.day, clear));
    return fragment;
  }

  /** AC-22: dni od dziś (zegar bazy) z dyżurnym, źródłem i wpisem grafiku. */
  async function load(): Promise<boolean> {
    const { data, error } = await supabase.rpc('range_duty_schedule', { p_days: dayCount });
    if (error) return false;
    closePicker();
    const days = scheduleRows(data);
    list.replaceChildren(...days.map((day, index) => renderDay(day, index === 0)));
    more.hidden = dayCount >= SCHEDULE_MAX_DAYS;
    return true;
  }

  async function openPicker(day: string): Promise<void> {
    const item = list.querySelector<HTMLElement>(`[data-day="${day}"]`);
    if (!item) return;
    pickerError.hidden = true;
    if (!(await officers.open())) return showLoadError();
    picking = day;
    pickerHeading.textContent = t('rangeDutySchedule.pickerHeading', { date: formatScheduleDay(day) });
    item.append(picker);
    picker.hidden = false;
    officers.focusFirst();
  }

  /** AC-23: wpis grafiku na dzień (nadpisuje poprzedni); od razu w bazie dla wszystkich urządzeń. */
  async function save(day: string, officerId: string): Promise<void> {
    pickerError.hidden = true;
    const { error } = await supabase.rpc('set_scheduled_range_duty', { p_day: day, p_range_officer_id: officerId });
    if (error) {
      // Prowadzący zniknął z listy w międzyczasie — świeża lista, potem komunikat.
      if (error.message === 'range_officer_inactive') await officers.open();
      pickerError.textContent = t(scheduleErrorKey(error));
      pickerError.hidden = false;
      return;
    }
    await afterChange(day, t('rangeDutySchedule.saved', { date: formatScheduleDay(day) }));
  }

  /** AC-22, AC-25: usuwa tylko wpis grafiku (zmiana w książce na dziś zostaje). */
  async function clearDay(day: string, button: HTMLButtonElement): Promise<void> {
    const item = button.closest('li');
    const error = item ? query<HTMLElement>(item, '[data-day-error]') : null;
    button.disabled = true;
    const { error: clearError } = await supabase.rpc('clear_scheduled_range_duty', { p_day: day });
    button.disabled = false;
    if (clearError) {
      if (error) {
        error.textContent = t(scheduleErrorKey(clearError));
        error.hidden = false;
      }
      return;
    }
    await afterChange(day, t('rangeDutySchedule.cleared', { date: formatScheduleDay(day) }));
  }

  async function afterChange(day: string, message: string): Promise<void> {
    if (!(await load())) return showLoadError();
    status.textContent = message;
    setButton(day)?.focus();
  }

  cancel.addEventListener('click', () => {
    const day = picking;
    closePicker();
    if (day) setButton(day)?.focus();
  });

  more.addEventListener('click', async () => {
    const firstNew = list.children.length;
    dayCount = nextDayCount(dayCount);
    if (!(await load())) return showLoadError();
    list.children[firstNew]?.querySelector<HTMLButtonElement>('[data-day-set]')?.focus();
  });

  if (!(await load())) showLoadError();
}
