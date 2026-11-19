/**
 * Zatwierdzanie zgłoszeń prowadzących z kont w `/panel/prowadzacy/` (SPEC-007 US-2, AC-7…AC-10) — logika bez DOM.
 * Decyzja tylko przez funkcję bazy `review_range_officer` (Obsługa i admin); lista z `range_officers` (RLS `is_staff()`).
 */
import { t } from '../i18n';
import { formatDateTime } from './admin-users';
import type { DictionaryItem } from './dictionary';
import { institutionText } from './range-officer-account';

export type PanelRole = 'staff' | 'admin';
export type ReviewDecision = 'approved' | 'rejected';

/** Zgłoszenie z konta do zatwierdzenia: aktywne (nie usunięte przez użytkownika), `pending`. */
export function isPendingSubmission(item: DictionaryItem): boolean {
  return Boolean(item.profile_id) && item.status === 'pending' && item.is_active;
}

/** „Do zatwierdzenia (n)” — najstarsze zgłoszenia najpierw. */
export function pendingSubmissions(items: readonly DictionaryItem[]): DictionaryItem[] {
  return items
    .filter(isPendingSubmission)
    .sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? '') || a.name.localeCompare(b.name, 'pl'));
}

/** Szczegóły zgłoszenia: „Nr legitymacji: 123 · PZSS · zgłoszono 19.11.2026, 10:00”. */
export function submissionDetails(item: DictionaryItem): string {
  const parts = [
    t('dictionary.officers.details', {
      license: item.license_number ?? '',
      institution: institutionText({ institution: item.institution ?? null, institution_other: item.institution_other ?? null }),
    }),
  ];
  if (item.submitted_at) parts.push(t('officerReview.submittedAt', { date: formatDateTime(item.submitted_at) }));
  return parts.join(' · ');
}

/** Oznaczenia na liście prowadzących (AC-10): „Z konta”, stan zgłoszenia innego niż zatwierdzone, „Ukryty dla innych”. */
export function officerTags(item: DictionaryItem): string[] {
  if (!item.profile_id) return [];
  const tags = [t('officerReview.fromAccount')];
  if (item.status === 'pending') tags.push(t('officerReview.statusPending'));
  if (item.status === 'rejected') tags.push(t('officerReview.statusRejected'));
  if (item.hide_from_others) tags.push(t('officerReview.hiddenForOthers'));
  return tags;
}

/** Edycja danych (imię i nazwisko, nr legitymacji, instytucja): tylko admin i tylko prowadzący dodani przez admina (AC-10). */
export function canEditOfficer(item: DictionaryItem, role: PanelRole): boolean {
  return role === 'admin' && !item.profile_id;
}

/** „Ukryj” / „Przywróć”: tylko admin, każdy prowadzący (SPEC-005 AC-1a, SPEC-007 AC-10). */
export function canToggleOfficer(role: PanelRole): boolean {
  return role === 'admin';
}

/** Komunikat po decyzji (AC-8, AC-9). */
export function reviewDoneText(decision: ReviewDecision): string {
  return t(decision === 'approved' ? 'officerReview.approved' : 'officerReview.rejected');
}

/** Błąd `review_range_officer`: zgłoszenie rozpatrzone w międzyczasie (`not_pending`) albo ogólny. */
export function reviewErrorText(error: { message?: string } | null | undefined): string {
  return t(error?.message === 'not_pending' ? 'officerReview.notPending' : 'panel.saveError');
}

/** Opis licznika w menu dla czytników ekranu: „Prowadzący, do zatwierdzenia: 2”. */
export function pendingMenuLabel(count: number): string {
  return `${t('panel.menu.rangeOfficers')}, ${t('panel.menu.rangeOfficersCount', { count })}`;
}

/** Zdarzenie strony: liczba oczekujących zmieniła się po decyzji — menu aktualizuje licznik. */
export const PENDING_COUNT_EVENT = 'sv:officers-pending';
