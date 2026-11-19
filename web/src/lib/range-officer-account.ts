/**
 * Uprawnienia prowadzącego zgłaszane z konta (SPEC-007 US-1, US-3) — logika bez DOM dla „Twoje dane” w `/konto/`.
 * Dane czyta i zapisuje wyłącznie przez funkcje bazy (`my_range_officer`, `save_my_range_officer`,
 * `set_my_range_officer_hidden`, `remove_my_range_officer`) — użytkownik nie ma uprawnień do tabeli `range_officers`.
 */
import { t, type MessageKey } from '../i18n';
import { isOfficerInstitution } from './dictionary';

export type RangeOfficerStatus = 'pending' | 'approved' | 'rejected';

/** Wiersz z `my_range_officer()` / `save_my_range_officer()`. */
export interface MyRangeOfficer {
  status: RangeOfficerStatus;
  license_number: string | null;
  institution: string | null;
  institution_other: string | null;
  hide_from_others: boolean;
  is_active: boolean;
  submitted_at: string | null;
}

/** Funkcje `returns table` zwracają tablicę (0 albo 1 wiersz). */
export function firstRow(data: unknown): MyRangeOfficer | null {
  return Array.isArray(data) && data.length ? (data[0] as MyRangeOfficer) : null;
}

/**
 * Zgłoszenie do pokazania w „Twoje dane”. Usunięte przez użytkownika albo ukryte przez admina (`is_active = false`)
 * — jak brak zgłoszenia: znów „Dodaj uprawnienia prowadzącego” (AC-1, AC-13).
 */
export function visibleSubmission(row: MyRangeOfficer | null): MyRangeOfficer | null {
  return row?.is_active ? row : null;
}

const STATUS_TEXT: Record<RangeOfficerStatus, MessageKey> = {
  pending: 'rangeOfficerAccount.statusPending',
  approved: 'rangeOfficerAccount.statusApproved',
  rejected: 'rangeOfficerAccount.statusRejected',
};

/** „Uprawnienia prowadzącego: czekają na zatwierdzenie” itd. (AC-4, AC-8, AC-9). */
export function statusText(status: RangeOfficerStatus): string {
  return t(STATUS_TEXT[status]);
}

/** Instytucja do wyświetlenia: nazwa wpisana przy „Inne”, inaczej etykieta kodu (PZŁ itd.). */
export function institutionText(row: Pick<MyRangeOfficer, 'institution' | 'institution_other'>): string {
  if (row.institution === 'OTHER' && row.institution_other) return row.institution_other;
  if (row.institution && isOfficerInstitution(row.institution)) {
    return t(`dictionary.officers.institutions.${row.institution}` as MessageKey);
  }
  return row.institution ?? '';
}

/** Komunikat błędu zapisu z bazy: brak imienia i nazwiska (AC-3) albo ogólny. */
export function saveErrorText(error: { message?: string } | null | undefined): string {
  return t(error?.message === 'full_name_required' ? 'rangeOfficerAccount.fullNameRequired' : 'rangeOfficerAccount.saveError');
}

/** Komunikat po zapisie formularza: zgłoszenie czeka na zatwierdzenie albo (bez zmian nr / instytucji) samo „Zapisano.”. */
export function savedText(row: MyRangeOfficer): string {
  return t(row.status === 'pending' ? 'rangeOfficerAccount.savedPending' : 'rangeOfficerAccount.saved');
}
