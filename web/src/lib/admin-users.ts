/**
 * Panel admina — konta użytkowników (SPEC-002 US-4…US-6; AC-16…AC-18, AC-20, AC-21, AC-23…AC-25). Logika bez DOM, testowana w Vitest.
 * Dane: `rpc/admin_list_users`, `rpc/admin_user_email`, `rpc/set_user_role`, `profiles`, `audit_log` (tylko admin — RLS),
 * Edge Function `admin-delete-user`.
 * Interfejs: lib/admin-users-ui.ts.
 */
import { t, type MessageKey } from '../i18n';
import type { ProfileField } from './profile';

export const ROLES = ['user', 'staff', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** AC-16: wyszukiwanie od 2 znaków, 50 kont na stronę (tak samo `admin_list_users`). */
export const SEARCH_MIN = 2;
export const PAGE_SIZE = 50;
/** AC-21: ile ostatnich wpisów „Historii zmian” pokazuje karta. */
export const HISTORY_LIMIT = 100;

export const USERS_PAGE = '/panel/uzytkownicy/';
export const userCardHref = (id: string) => `/panel/uzytkownicy/profil/?id=${encodeURIComponent(id)}`;

export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);
export const roleLabel = (role: string) => (isRole(role) ? t(`users.roles.${role}`) : role);

/** Wiersz `admin_list_users`. */
export interface UserRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_range_ready: boolean;
  created_at: string;
  total_count: number;
}

/** Fraza wyszukiwania dla `admin_list_users`: krótsza niż 2 znaki = bez filtra (`null`). */
export function searchTerm(input: string): string | null {
  const term = input.trim();
  return [...term].length >= SEARCH_MIN ? term : null;
}

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `?id=` karty użytkownika; zły format = brak konta. */
export function userIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('id');
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** AC-18: błąd `set_user_role` → komunikat. Ostatni admin ma stały komunikat z bazy (`last_admin`). */
export function roleErrorKey(error: { message?: string } | null): MessageKey {
  return error?.message === 'last_admin' ? 'users.lastAdmin' : 'panel.saveError';
}

const timeFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Warsaw' });
const dayFormat = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeZone: 'Europe/Warsaw' });
/** `timestamptz` → data i godzina w Europe/Warsaw (historia zmian). */
export const formatDateTime = (value: string) => timeFormat.format(new Date(value));
/** `timestamptz` → data w Europe/Warsaw (data założenia konta). */
export const formatDay = (value: string) => dayFormat.format(new Date(value));

/** Wpis `audit_log` z autorem (`profiles` przez `actor_id`). */
export interface AuditEntry {
  id: number;
  action: string;
  changes: Record<string, [unknown, unknown]> | null;
  created_at: string;
  actor: { full_name: string | null } | null;
}

const FIELD_LABEL: Record<ProfileField | 'privacy_notice_ack_at', MessageKey> = {
  full_name: 'profile.fullName',
  phone: 'profile.phone',
  permit_number: 'profile.permitNumber',
  permit_authority: 'profile.permitAuthority',
  address: 'profile.address',
  privacy_notice_ack_at: 'users.privacyAck',
};

function valueText(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return t('account.notProvided');
  if (field === 'role') return roleLabel(String(value));
  if (field === 'privacy_notice_ack_at') return formatDateTime(String(value));
  return String(value);
}

/** AC-21: „co” — jedna linia na zmienione pole: „Telefon: nie podano → 600 100 200”. */
export function describeChanges(entry: Pick<AuditEntry, 'action' | 'changes'>): string[] {
  return Object.entries(entry.changes ?? {}).map(([field, [before, after]]) => {
    const label = field === 'role' ? t('users.role') : field in FIELD_LABEL ? t(FIELD_LABEL[field as ProfileField]) : field;
    return t('users.change', { field: label, before: valueText(field, before), after: valueText(field, after) });
  });
}

/** AC-21: „kto” — imię i nazwisko autora; konto bez danych lub usunięte → opis zastępczy. */
export function actorName(entry: Pick<AuditEntry, 'actor'>): string {
  if (!entry.actor) return t('users.actorDeleted');
  return entry.actor.full_name ?? t('users.actorNoName');
}

// ===== Usunięcie konta (US-6) =====

export const DELETE_USER_FUNCTION = 'admin-delete-user';
/** AC-23: słowo, które admin musi wpisać, aby potwierdzić usunięcie konta. */
export const DELETE_CONFIRM_WORD = 'USUŃ';

/** AC-23: potwierdzenie — dokładnie „USUŃ” (spacje na brzegach pomijane). */
export const isDeleteConfirmed = (input: string) => input.trim() === DELETE_CONFIRM_WORD;

/** AC-25: admin nie usuwa własnego konta. */
export const canDeleteAccount = (currentUserId: string | null | undefined, userId: string) =>
  Boolean(currentUserId) && currentUserId !== userId;

/** Odpowiedź `admin-delete-user` → komunikat (204 — sukces, 409 — własne konto, 404 — brak konta). */
export function deleteResultKey(status: number | null): MessageKey {
  if (status === 204) return 'users.deleted';
  if (status === 409) return 'users.deleteOwn';
  if (status === 404) return 'users.notFound';
  if (status === 403) return 'users.deleteForbidden';
  return 'users.deleteError';
}
