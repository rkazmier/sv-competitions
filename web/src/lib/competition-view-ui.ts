/**
 * Podgląd zawodów w panelu `/panel/zawody/podglad/?id=` (SPEC-001 AC-24): dane w przeglądarce (organizator widzi szkice),
 * ten sam komponent co strona publiczna (CompetitionDetails.astro). Tekst z bazy wyłącznie przez `textContent`.
 */
import { t } from '../i18n';
import { COMPETITION_PAGE_COLUMNS, toCompetitionView, type CompetitionRow, type CompetitionView } from './competition-page';
import { requireOrganizer, showLoadError } from './panel';
import { STORAGE_BUCKET } from './rulebooks';

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Brak elementu ${selector}`);
  return element;
}

function setLink(link: HTMLAnchorElement, soon: HTMLElement, url: string | null): void {
  if (url) link.href = url;
  link.hidden = !url;
  soon.hidden = Boolean(url);
}

/** Wypełnia pusty CompetitionDetails danymi widoku. */
export function renderCompetitionView(root: HTMLElement, view: CompetitionView): void {
  query<HTMLElement>(root, '[data-name]').textContent = view.name;
  query<HTMLElement>(root, '[data-date]').textContent = view.dateRange;
  query<HTMLElement>(root, '[data-discipline]').textContent = view.discipline;
  setLink(query(root, '[data-rulebook]'), query(root, '[data-rulebook-soon]'), view.rulebookUrl);
  setLink(query(root, '[data-matchbook]'), query(root, '[data-matchbook-soon]'), view.matchbookUrl);

  query<HTMLElement>(root, '[data-description]').replaceChildren(
    ...view.paragraphs.map((text) => Object.assign(document.createElement('p'), { textContent: text })),
  );

  const template = query<HTMLTemplateElement>(root, '[data-schedule-day-template]');
  query<HTMLElement>(root, '[data-schedule-days]').replaceChildren(
    ...view.schedule.map((day) => {
      const table = query<HTMLTableElement>(template.content.cloneNode(true) as DocumentFragment, '[data-schedule-day]');
      query<HTMLElement>(table, '[data-day-heading]').textContent = day.heading;
      const body = query<HTMLTableSectionElement>(table, '[data-day-items]');
      for (const item of day.items) {
        const row = body.insertRow();
        row.insertCell().textContent = item.time;
        row.insertCell().textContent = item.description;
      }
      return table;
    }),
  );
  query<HTMLElement>(root, '[data-schedule-soon]').hidden = view.schedule.length > 0;
  root.hidden = false;
}

export async function mountCompetitionPreview(): Promise<void> {
  const root = query<HTMLElement>(document, '[data-competition-page]');
  const supabase = await requireOrganizer();
  const id = new URLSearchParams(window.location.search).get('id');
  const { data, error } = id
    ? await supabase.from('competitions').select(COMPETITION_PAGE_COLUMNS).eq('id', id).maybeSingle()
    : { data: null, error: null };
  if (error) return showLoadError();
  if (!data) {
    query<HTMLElement>(document, '[data-preview-not-found]').hidden = false;
    return;
  }

  const storage = supabase.storage.from(STORAGE_BUCKET);
  // Bez wygenerowanych typów bazy klient zakłada tablicę dla osadzenia; relacja wiele-do-jednego zwraca obiekt.
  const view = toCompetitionView(data as unknown as CompetitionRow, (path) => storage.getPublicUrl(path).data.publicUrl);
  renderCompetitionView(root, view);
  query<HTMLElement>(document, '[data-preview-bar]').hidden = !view.isDraft;
  query<HTMLAnchorElement>(document, '[data-preview-back]').href = `/panel/zawody/edytuj/?id=${encodeURIComponent(id!)}`;
  document.title = `${t('competitionPage.previewTitle')}: ${view.name} — ${t('site.name')}`;
}
