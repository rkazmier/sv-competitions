/**
 * Wyspa listy wpisów kalendarza w `/panel/` (SPEC-001 AC-6): zawody i wydarzenia, szkice i opublikowane.
 * Tekst z bazy trafia do DOM wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { sortEntries, type CalendarEntry, type EntryStatus } from './calendar';
import { formatDateRange } from './dates';
import { requireOrganizer, showLoadError } from './panel';
import { rebuildAndDescribe } from './site-rebuild';

interface Row {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string | null;
  status: EntryStatus;
}
interface CompetitionRow extends Row {
  discipline: { name: string } | null;
}
interface EventRow extends Row {
  category: { name: string } | null;
}

const BASE = 'id, name, starts_on, ends_on, status';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

export async function mountEntries(): Promise<void> {
  const list = query<HTMLUListElement>(document, '[data-entries]');
  const empty = query<HTMLElement>(document, '[data-entries-empty]');
  const template = query<HTMLTemplateElement>(document, '[data-entry-template]');

  const supabase = await requireOrganizer();
  // AC-34: ręczne odświeżenie strony publicznej (np. po nieudanej automatycznej przebudowie, §7).
  const refresh = query<HTMLButtonElement>(document, '[data-refresh-site]');
  const refreshStatus = query<HTMLElement>(document, '[data-refresh-status]');
  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    refreshStatus.textContent = '';
    refreshStatus.textContent = await rebuildAndDescribe(supabase);
    refresh.disabled = false;
  });
  // Kolumny wymienione jawnie: `created_by` nie jest udostępniany klientom (docs/architecture.md).
  const [competitions, events] = await Promise.all([
    supabase.from('competitions').select(`${BASE}, discipline:disciplines(name)`),
    supabase.from('calendar_events').select(`${BASE}, category:event_categories(name)`),
  ]);
  if (competitions.error || events.error) return showLoadError();

  const toEntry = (kind: CalendarEntry['kind'], row: Row, label: string | undefined): CalendarEntry => ({
    kind,
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    label: label ?? '',
  });
  // Bez wygenerowanych typów bazy klient zakłada tablicę dla osadzenia; relacja wiele-do-jednego zwraca obiekt.
  const entries = sortEntries([
    ...((competitions.data ?? []) as unknown as CompetitionRow[]).map((row) => toEntry('competition', row, row.discipline?.name)),
    ...((events.data ?? []) as unknown as EventRow[]).map((row) => toEntry('event', row, row.category?.name)),
  ]);

  list.replaceChildren(
    ...entries.map((entry) => {
      const fragment = template.content.cloneNode(true) as DocumentFragment;
      const li = query<HTMLLIElement>(fragment, '[data-entry]');
      li.dataset.kind = entry.kind;
      query<HTMLElement>(li, '[data-kind]').textContent =
        entry.kind === 'competition' ? t('entries.kindCompetition') : t('entries.kindEvent');
      query<HTMLElement>(li, '[data-status]').textContent =
        entry.status === 'published' ? t('entries.statusPublished') : t('entries.statusDraft');
      const name = query<HTMLElement>(li, '[data-name]');
      if (entry.kind === 'competition') {
        const link = document.createElement('a');
        link.href = `/panel/zawody/edytuj/?id=${encodeURIComponent(entry.id)}`;
        link.textContent = entry.name;
        name.replaceChildren(link);
      } else {
        name.textContent = entry.name;
      }
      query<HTMLElement>(li, '[data-date]').textContent = formatDateRange(entry.startsOn, entry.endsOn);
      query<HTMLElement>(li, '[data-label]').textContent = entry.label;
      return li;
    }),
  );
  empty.hidden = entries.length > 0;
}
