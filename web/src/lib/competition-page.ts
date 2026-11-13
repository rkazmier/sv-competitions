/**
 * Dane strony zawodów (SPEC-001 US-9, AC-38…41) i kart kalendarza (AC-42, AC-43) — bez DOM.
 * Ten sam widok (`CompetitionView`) renderuje strona statyczna `/zawody/<slug>/` i podgląd w panelu (AC-24).
 */
import type { CalendarEntry, EntryStatus } from './calendar';
import { formatTime, sortSchedule, type ScheduleItem } from './competitions';
import { formatDate, formatDateRange } from './dates';
import { excerpt, safeExternalUrl, toParagraphs } from './text';

// Kolumny jawnie: `created_by` nie jest udostępniany klientom (docs/architecture.md).
export const COMPETITION_PAGE_COLUMNS =
  'id, slug, name, starts_on, ends_on, description, matchbook_path, status, ' +
  'discipline:disciplines(name), rulebook:rulebooks(file_path), schedule_items(id, day, time, description, position)';
export const EVENT_COLUMNS =
  'id, name, starts_on, ends_on, description, external_url, status, category:event_categories(name)';

export interface CompetitionRow {
  id: string;
  slug: string;
  name: string;
  starts_on: string;
  ends_on: string | null;
  description: string | null;
  matchbook_path: string | null;
  status: EntryStatus;
  discipline: { name: string } | null;
  rulebook: { file_path: string } | null;
  schedule_items: ScheduleItem[] | null;
}

export interface EventRow {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string | null;
  description: string | null;
  external_url: string | null;
  status: EntryStatus;
  category: { name: string } | null;
}

export interface ScheduleDay {
  day: string;
  heading: string;
  items: { time: string; description: string }[];
}

export interface CompetitionView {
  slug: string;
  name: string;
  dateRange: string;
  discipline: string;
  paragraphs: string[];
  /** Początek opisu, maks. 160 znaków (AC-41); pusty, gdy brak opisu */
  summary: string;
  schedule: ScheduleDay[];
  rulebookUrl: string | null;
  matchbookUrl: string | null;
  isDraft: boolean;
}

/** Publiczny adres pliku w Storage (bucket `documents`). */
export type PublicUrl = (path: string) => string;

/** AC-38: harmonogram pogrupowany po dniach, w dniu wg godziny (AC-21). */
export function groupSchedule(items: readonly ScheduleItem[]): ScheduleDay[] {
  const days: ScheduleDay[] = [];
  for (const item of sortSchedule(items)) {
    let day = days.at(-1);
    if (day?.day !== item.day) {
      day = { day: item.day, heading: formatDate(item.day), items: [] };
      days.push(day);
    }
    day.items.push({ time: formatTime(item.time), description: item.description });
  }
  return days;
}

export function toCompetitionView(row: CompetitionRow, publicUrl: PublicUrl): CompetitionView {
  return {
    slug: row.slug,
    name: row.name,
    dateRange: formatDateRange(row.starts_on, row.ends_on),
    discipline: row.discipline?.name ?? '',
    paragraphs: toParagraphs(row.description),
    summary: excerpt(row.description),
    schedule: groupSchedule(row.schedule_items ?? []),
    rulebookUrl: row.rulebook ? publicUrl(row.rulebook.file_path) : null,
    matchbookUrl: row.matchbook_path ? publicUrl(row.matchbook_path) : null,
    isDraft: row.status === 'draft',
  };
}

export function competitionEntry(row: CompetitionRow): CalendarEntry {
  return {
    kind: 'competition',
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    label: row.discipline?.name ?? '',
    slug: row.slug,
  };
}

export function eventEntry(row: EventRow): CalendarEntry {
  return {
    kind: 'event',
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    status: row.status,
    label: row.category?.name ?? '',
    description: row.description,
    externalUrl: safeExternalUrl(row.external_url),
  };
}

/** Adres strony zawodów (AC-42). */
export const competitionPath = (slug: string) => `/zawody/${encodeURIComponent(slug)}/`;
