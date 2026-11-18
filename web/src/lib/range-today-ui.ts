/**
 * `/panel/ksiazka/` — lista dzisiejszych wpisów (SPEC-005 §6) z adnotacjami (US-7, AC-21, AC-22).
 * Obsługa: RLS zwraca tylko dzisiejsze wpisy i przyjmuje adnotacje tylko do nich; admin widzi tu też tylko dzisiejsze
 * (cała książka — `/panel/ksiazka/przeglad/`, #63). Wpis jest niezmienny — korekta wyłącznie adnotacją.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { todayInWarsaw } from './calendar';
import { requireStaff } from './panel';
import { bindAnnotationForm } from './range-annotation-ui';
import { entryTime } from './range-entry';
import {
  ANNOTATION_COLUMNS,
  ENTRY_SAVED_EVENT,
  annotationAuthor,
  groupAnnotations,
  type Annotation,
} from './range-history';

interface TodayEntry {
  id: string;
  entered_at: string;
  full_name: string;
  is_companion: boolean;
}

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

export async function mountRangeToday(root: HTMLElement): Promise<void> {
  const section = el(root, '[data-today]');
  const list = el<HTMLOListElement>(section, '[data-today-list]');
  const empty = el(section, '[data-today-empty]');
  const loadError = el(section, '[data-today-error]');
  const template = el<HTMLTemplateElement>(root, 'template[data-today-template]');
  const { supabase } = await requireStaff();

  async function load(): Promise<void> {
    // Admin widzi całą książkę — zawężenie do ostatnich 36 h w zapytaniu, dzień Europe/Warsaw po stronie klienta.
    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const entries = await supabase
      .from('range_log')
      .select('id, entered_at, full_name, is_companion')
      .gte('entered_at', since)
      .order('entered_at', { ascending: false });
    const today = todayInWarsaw();
    const rows = ((entries.data ?? []) as TodayEntry[]).filter((entry) => todayInWarsaw(new Date(entry.entered_at)) === today);
    const annotations = rows.length
      ? await supabase.from('range_log_annotations').select(ANNOTATION_COLUMNS).in('entry_id', rows.map((row) => row.id))
      : { data: [], error: null };
    loadError.hidden = !(entries.error || annotations.error);
    if (entries.error || annotations.error) return;
    const groups = groupAnnotations((annotations.data ?? []) as unknown as Annotation[]);
    list.replaceChildren(...rows.map((entry) => renderEntry(entry, groups.get(entry.id) ?? [])));
    empty.hidden = rows.length > 0;
  }

  function renderEntry(entry: TodayEntry, annotations: Annotation[]): HTMLElement {
    const item = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const time = entryTime(entry.entered_at);
    el(item, '[data-entry-time]').textContent = time;
    el(item, '[data-entry-name]').textContent = entry.full_name;
    el(item, '[data-entry-companion]').hidden = !entry.is_companion;
    const notes = el(item, '[data-annotations]');
    notes.hidden = annotations.length === 0;
    el(notes, 'ul').replaceChildren(
      ...annotations.map((annotation) => {
        const li = document.createElement('li');
        li.textContent = t('rangeHistory.annotation', {
          author: annotationAuthor(annotation),
          time: entryTime(annotation.created_at),
          body: annotation.body,
        });
        return li;
      }),
    );

    // AC-21: „Dodaj adnotację” → treść 5–500 znaków; AC-22: odrzucenie przez RLS → komunikat.
    bindAnnotationForm(item, entry.id, t('rangeHistory.addAnnotationSr', { name: entry.full_name, time }), supabase, load);
    return item;
  }

  root.addEventListener(ENTRY_SAVED_EVENT, () => void load());
  // Urządzenie zostawione na noc — po powrocie do karty lista nowego dnia.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void load();
  });
  await load();
}
