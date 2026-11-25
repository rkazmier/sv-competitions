/**
 * Godziny otwarcia (SPEC-012 US-7): panel `/panel/godziny/` (AC-35, AC-36, AC-39) i sekcja `/oferta/#godziny` (AC-37, AC-38).
 * Dane pobierane w przeglądarce — zmiana w panelu działa od razu, bez `site-rebuild`.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import { todayInWarsaw } from './calendar';
import { formatDate } from './dates';
import {
  OPENING_LOOKAHEAD_DAYS,
  WEEKDAYS,
  addDays,
  blockedHref,
  blockedDates,
  exceptionText,
  hoursError,
  hoursText,
  isNoteValid,
  normalizeNote,
  shortTime,
  upcomingExceptions,
  weekRows,
  weekdayName,
  type BlockedEntry,
  type HoursException,
  type WeekdayHours,
} from './opening-hours';
import { requireAdmin } from './panel';
import { getSupabase } from './supabase';

const HOURS_COLUMNS = 'opens_at, closes_at';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

/** Pola jednego przedziału: stan „Otwarte”/„Zamknięte” + „Od”/„Do” (wyłączone przy „Zamknięte”). */
function hoursFields(root: ParentNode, suffix: string) {
  const state = query<HTMLSelectElement>(root, `[name="state${suffix}"]`);
  const opens = query<HTMLInputElement>(root, `[name="opens${suffix}"]`);
  const closes = query<HTMLInputElement>(root, `[name="closes${suffix}"]`);
  const sync = () => {
    opens.disabled = closes.disabled = state.value !== 'open';
  };
  state.addEventListener('change', sync);
  return {
    set(hours: { opens_at: string | null; closes_at: string | null } | null) {
      state.value = hours?.opens_at ? 'open' : 'closed';
      opens.value = hours?.opens_at ? shortTime(hours.opens_at) : '';
      closes.value = hours?.closes_at ? shortTime(hours.closes_at) : '';
      sync();
    },
    error: () => hoursError(state.value === 'open', opens.value, closes.value),
    value: () =>
      state.value === 'open' ? { opens_at: opens.value, closes_at: closes.value } : { opens_at: null, closes_at: null },
  };
}

// ===== /panel/godziny/ (admin) =====

export async function mountOpeningHoursAdmin(root: HTMLElement): Promise<void> {
  const supabase: SupabaseClient = await requireAdmin();
  const weekForm = query<HTMLFormElement>(root, '[data-week-form]');
  const exceptionForm = query<HTMLFormElement>(root, '[data-exception-form]');
  const day = query<HTMLInputElement>(exceptionForm, '[name="day"]');
  const note = query<HTMLInputElement>(exceptionForm, '[name="note"]');
  const status = query<HTMLElement>(root, '[data-status]');
  const error = query<HTMLElement>(root, '[data-error]');
  const rows = query<HTMLElement>(root, '[data-rows]');
  const table = query<HTMLElement>(root, '[data-table]');
  const empty = query<HTMLElement>(root, '[data-empty]');
  const week = new Map<number, ReturnType<typeof hoursFields>>(
    WEEKDAYS.map((weekday) => [weekday, hoursFields(weekForm, `-${weekday}`)]),
  );
  const exceptionHours = hoursFields(exceptionForm, '');

  function report(message: string, failed = false): void {
    error.textContent = failed ? message : '';
    error.hidden = !failed;
    status.textContent = failed ? '' : message;
  }

  function exceptionRow(exception: HoursException): HTMLTableRowElement {
    const row = document.createElement('tr');
    const remove = node('button', t('openingHours.remove'));
    remove.type = 'button';
    remove.className = 'button';
    remove.setAttribute('aria-label', t('openingHours.removeLabel', { day: formatDate(exception.day) }));
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      const { error: deleteError } = await supabase.from('opening_hours_exceptions').delete().eq('day', exception.day);
      if (deleteError) return report(t('openingHours.error'), true);
      report(t('openingHours.saved'));
      await load();
    });
    const actions = node('td');
    actions.append(remove);
    row.append(node('td', formatDate(exception.day)), node('td', hoursText(exception)), node('td', exception.note ?? ''), actions);
    return row;
  }

  async function load(): Promise<void> {
    const [hours, exceptions] = await Promise.all([
      supabase.from('opening_hours').select(`weekday, ${HOURS_COLUMNS}`),
      supabase.from('opening_hours_exceptions').select(`day, note, ${HOURS_COLUMNS}`).order('day'),
    ]);
    if (hours.error || exceptions.error) return report(t('panel.loadError'), true);
    for (const row of weekRows((hours.data ?? []) as WeekdayHours[])) week.get(row.weekday)?.set(row.hours);
    const list = (exceptions.data ?? []) as HoursException[];
    rows.replaceChildren(...list.map(exceptionRow));
    table.hidden = list.length === 0;
    empty.hidden = list.length > 0;
  }

  // AC-35, AC-39: cały tydzień jednym zapisem.
  weekForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    for (const [weekday, fields] of week) {
      const key = fields.error();
      if (key) return report(`${weekdayName(weekday)}: ${t(key)}`, true);
    }
    report(t('openingHours.saving'));
    const payload = [...week].map(([weekday, fields]) => ({ weekday, ...fields.value() }));
    const { error: saveError } = await supabase.from('opening_hours').upsert(payload);
    if (saveError) return report(t('openingHours.error'), true);
    report(t('openingHours.saved'));
  });

  // AC-36, AC-39: wyjątek dnia (ponowny zapis tej samej daty zastępuje poprzedni — jeden przedział na dzień).
  exceptionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!day.value) return report(t('openingHours.dayRequired'), true);
    const key = exceptionHours.error();
    if (key) return report(t(key), true);
    if (!isNoteValid(note.value)) return report(t('openingHours.noteTooLong'), true);
    report(t('openingHours.saving'));
    const { error: saveError } = await supabase
      .from('opening_hours_exceptions')
      .upsert({ day: day.value, note: normalizeNote(note.value), ...exceptionHours.value() });
    if (saveError) return report(t('openingHours.error'), true);
    exceptionForm.reset();
    exceptionHours.set(null);
    report(t('openingHours.saved'));
    await load();
  });

  exceptionHours.set(null);
  await load();
}

// ===== /oferta/#godziny (publiczne) =====

export async function mountOpeningHours(root: HTMLElement): Promise<void> {
  const loading = query<HTMLElement>(root, '[data-hours-loading]');
  const fail = () => {
    loading.hidden = true;
    query<HTMLElement>(root, '[data-hours-error]').hidden = false;
  };
  let supabase: SupabaseClient;
  try {
    supabase = getSupabase();
  } catch {
    return fail();
  }
  const today = todayInWarsaw();
  const [hours, exceptions, blocked] = await Promise.all([
    supabase.from('opening_hours').select(`weekday, ${HOURS_COLUMNS}`),
    supabase.from('opening_hours_exceptions').select(`day, note, ${HOURS_COLUMNS}`).gte('day', today),
    supabase.rpc('range_blocked_between', { p_from: today, p_to: addDays(today, OPENING_LOOKAHEAD_DAYS - 1) }),
  ]);
  if (hours.error || exceptions.error || blocked.error) return fail();
  loading.hidden = true;

  // AC-37, AC-38: tydzień; brak ustawionych godzin → „Godziny otwarcia wkrótce.”
  const weekHours = (hours.data ?? []) as WeekdayHours[];
  if (weekHours.length === 0) {
    query<HTMLElement>(root, '[data-hours-soon]').hidden = false;
  } else {
    const week = query<HTMLElement>(root, '[data-week]');
    week.replaceChildren(
      ...weekRows(weekHours).flatMap((row) => [
        node('dt', weekdayName(row.weekday)),
        node('dd', row.hours ? hoursText(row.hours) : '—'),
      ]),
    );
    week.hidden = false;
  }

  const upcoming = upcomingExceptions((exceptions.data ?? []) as HoursException[], today);
  if (upcoming.length > 0) {
    query<HTMLElement>(root, '[data-exceptions]').replaceChildren(...upcoming.map((e) => node('li', exceptionText(e))));
    query<HTMLElement>(root, '[data-exceptions-section]').hidden = false;
  }

  const entries = (blocked.data ?? []) as BlockedEntry[];
  query<HTMLElement>(root, '[data-blocked-empty]').hidden = entries.length > 0;
  query<HTMLElement>(root, '[data-blocked]').replaceChildren(
    ...entries.map((entry) => {
      // Nazwa wydarzenia jest linkiem do jego miesiąca w kalendarzu.
      const link = node('a', entry.name);
      link.href = blockedHref(entry, today);
      const item = node('li');
      item.append(link, ` — ${blockedDates(entry)}`);
      return item;
    }),
  );
  query<HTMLElement>(root, '[data-blocked-section]').hidden = false;
}
