/**
 * Formularz zawodów, harmonogram i matchbook (SPEC-001 US-5, AC-17…23). Logika bez DOM.
 * Daty to dni `YYYY-MM-DD` (czas lokalny strzelnicy) — porównanie leksykograficzne jest poprawne.
 */

export const COMPETITION_NAME_MAX = 150;
export const COMPETITION_DESCRIPTION_MAX = 10000;
export const SCHEDULE_DESCRIPTION_MAX = 300;
/** Komunikat wyzwalaczy `schedule_items_day` i `competitions_schedule_range` (docs/architecture.md). */
export const SCHEDULE_RANGE_ERROR = 'schedule_item_day_out_of_range';

export interface CompetitionInput {
  name: string;
  discipline_id: string;
  starts_on: string;
  ends_on: string;
  description: string;
}

export type CompetitionErrors = Partial<
  Record<'name' | 'discipline_id' | 'starts_on' | 'ends_on' | 'description', 'required' | 'tooLong' | 'endBeforeStart'>
>;

const length = (value: string) => [...value].length;

/** AC-17: wymagane nazwa, dyscyplina, data początku; AC-18: koniec nie przed początkiem. */
export function validateCompetition(input: CompetitionInput): CompetitionErrors {
  const errors: CompetitionErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = 'required';
  else if (length(name) > COMPETITION_NAME_MAX) errors.name = 'tooLong';
  if (!input.discipline_id) errors.discipline_id = 'required';
  if (!input.starts_on) errors.starts_on = 'required';
  if (input.starts_on && input.ends_on && input.ends_on < input.starts_on) errors.ends_on = 'endBeforeStart';
  if (length(input.description) > COMPETITION_DESCRIPTION_MAX) errors.description = 'tooLong';
  return errors;
}

/** Wiersz do zapisu: puste pola opcjonalne → `null`. */
export function toRow(input: CompetitionInput, rulebookId: string) {
  const description = input.description.trim();
  return {
    name: input.name.trim(),
    discipline_id: input.discipline_id,
    starts_on: input.starts_on,
    ends_on: input.ends_on || null,
    description: description || null,
    rulebook_id: rulebookId || null,
  };
}

export interface ScheduleItem {
  id: string;
  day: string;
  /** `HH:MM` lub `HH:MM:SS` z bazy; `null` = bez godziny */
  time: string | null;
  description: string;
  position: number;
}

export type ScheduleItemError = 'descriptionRequired' | 'descriptionTooLong' | 'dayRequired' | 'dayOutOfRange';

export function dayInRange(day: string, startsOn: string, endsOn: string | null): boolean {
  return day >= startsOn && day <= (endsOn || startsOn);
}

export function validateScheduleItem(
  item: Pick<ScheduleItem, 'day' | 'description'>,
  startsOn: string,
  endsOn: string | null,
): ScheduleItemError | null {
  if (!item.day) return 'dayRequired';
  if (!dayInRange(item.day, startsOn, endsOn)) return 'dayOutOfRange';
  const description = item.description.trim();
  if (!description) return 'descriptionRequired';
  if (length(description) > SCHEDULE_DESCRIPTION_MAX) return 'descriptionTooLong';
  return null;
}

/** AC-22: punkty, które wypadną poza nowy termin zawodów. */
export function itemsOutOfRange(items: readonly ScheduleItem[], startsOn: string, endsOn: string | null): string[] {
  return items.filter((item) => !dayInRange(item.day, startsOn, endsOn)).map((item) => item.id);
}

/** AC-21: po dniu i godzinie; punkty bez godziny na początku dnia, remisy w kolejności dodania. */
export function sortSchedule(items: readonly ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    if (a.time !== b.time) {
      if (a.time === null) return -1;
      if (b.time === null) return 1;
      return a.time < b.time ? -1 : 1;
    }
    return a.position - b.position;
  });
}

/** `08:00:00` → `08:00` */
export function formatTime(time: string | null): string {
  return time ? time.slice(0, 5) : '';
}

/** Ścieżka w Storage: `matchbooks/<competition_id>/<uuid>.pdf` (SPEC-001 §5). */
export function matchbookPath(competitionId: string, fileId: string): string {
  return `matchbooks/${competitionId}/${fileId}.pdf`;
}

export interface DisciplineOption {
  id: string;
  name: string;
  is_active: boolean;
}

/** AC-17 + §7: aktywne dyscypliny i bieżąca (także ukryta), alfabetycznie. */
export function disciplineOptions(items: readonly DisciplineOption[], currentId?: string | null): DisciplineOption[] {
  return items
    .filter((item) => item.is_active || item.id === currentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export interface RulebookOption {
  id: string;
  title: string;
  is_archived: boolean;
  created_at: string;
}

/** AC-19: niezarchiwizowane od najnowszych; bieżący zarchiwizowany zostaje na liście (AC-14). */
export function rulebookOptions(items: readonly RulebookOption[], currentId?: string | null): RulebookOption[] {
  return items
    .filter((item) => !item.is_archived || item.id === currentId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** Błąd zakresu dnia z wyzwalacza w bazie (AC-22). */
export function isScheduleRangeError(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === '23514' && Boolean(error.message?.includes(SCHEDULE_RANGE_ERROR));
}
