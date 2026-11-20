/**
 * Link „Książka” w nagłówku dla dyżurnego Prowadzącego (SPEC-009, ADR-0008) — logika bez DOM, testowana w Vitest.
 * Interfejs: lib/duty-link-ui.ts (nagłówek, `/konto/`, bramka panelu).
 *
 * Pamięć w `sessionStorage` (`sv-duty-link`): `{ sub, day, duty }` — wynik `rpc/is_range_duty_officer` dla danego
 * konta i dnia (Europe/Warsaw). Tylko podpowiedź dla UI, nie daje dostępu (pilnują bramka panelu i RLS).
 */
import { headerState } from './auth';
import { todayInWarsaw } from './calendar';

/** Klucz pamięci w `sessionStorage` (§5). */
export const DUTY_LINK_KEY = 'sv-duty-link';

export interface DutyMemory {
  sub: string;
  day: string;
  duty: boolean;
}

export interface StoredUserSession {
  sub: string;
  accessToken: string;
  /** Sekundy od epoki (z `expires_at` sesji albo `exp` tokenu); `null` — nieznane. */
  expiresAt: number | null;
}

function decodePayload(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const value: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Zapisana sesja (localStorage `sv-auth`) → `sub`, token i ważność; `null` — brak lub nieczytelna (AC-3). */
export function readStoredSession(storedSession: string | null): StoredUserSession | null {
  if (!storedSession) return null;
  let session: { access_token?: unknown; expires_at?: unknown };
  try {
    session = JSON.parse(storedSession) as typeof session;
  } catch {
    return null;
  }
  if (!session || typeof session.access_token !== 'string') return null;
  const claims = decodePayload(session.access_token);
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null;
  const expiresAt =
    typeof session.expires_at === 'number' ? session.expires_at : typeof claims.exp === 'number' ? claims.exp : null;
  return { sub: claims.sub, accessToken: session.access_token, expiresAt };
}

/** Wygasły token (§7) — strona publiczna nie odświeża sesji, więc nagłówek nie pyta. */
export function isExpired(session: StoredUserSession, now: Date): boolean {
  return session.expiresAt !== null && session.expiresAt * 1000 <= now.getTime();
}

/** Pamięć z `sessionStorage` → `{ sub, day, duty }` albo `null` (brak, nieczytelna, zły format). */
export function parseDutyMemory(raw: string | null): DutyMemory | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DutyMemory> | null;
    if (!value || typeof value.sub !== 'string' || typeof value.day !== 'string' || typeof value.duty !== 'boolean') {
      return null;
    }
    return { sub: value.sub, day: value.day, duty: value.duty };
  } catch {
    return null;
  }
}

export function serializeDutyMemory(sub: string, duty: boolean, now: Date = new Date()): string {
  return JSON.stringify({ sub, day: todayInWarsaw(now), duty } satisfies DutyMemory);
}

export type DutyDecision =
  /** Bez linku i bez zapytania: gość, nieczytelna lub wygasła sesja, Obsługa, admin (AC-3, AC-4, §7). */
  | { kind: 'none' }
  /** Wynik z pamięci tej karty — bez zapytania (AC-7). */
  | { kind: 'remembered'; duty: boolean }
  /** Zapytać bazę (brak pamięci, inny dzień lub inne konto — AC-8). */
  | { kind: 'ask'; sub: string; accessToken: string };

/** Decyzja nagłówka: pokazać z pamięci, zapytać bazę, czy nic nie robić. */
export function dutyDecision(storedSession: string | null, storedMemory: string | null, now: Date = new Date()): DutyDecision {
  if (headerState(storedSession) !== 'user') return { kind: 'none' };
  const session = readStoredSession(storedSession);
  if (!session || isExpired(session, now)) return { kind: 'none' };
  const memory = parseDutyMemory(storedMemory);
  if (memory && memory.sub === session.sub && memory.day === todayInWarsaw(now)) {
    return { kind: 'remembered', duty: memory.duty };
  }
  return { kind: 'ask', sub: session.sub, accessToken: session.accessToken };
}

/**
 * Odpowiedź `POST /rest/v1/rpc/is_range_duty_officer` → `true` / `false`; `null` — błąd (sieć, 401, 5xx, inna treść),
 * którego nie zapamiętujemy (AC-5).
 */
export function dutyFromResponse(ok: boolean, body: unknown): boolean | null {
  if (!ok) return null;
  return typeof body === 'boolean' ? body : null;
}

/** Widoczność „Książka”: tylko stan `user` z wynikiem `duty: true` (§6). */
export function showDutyLink(storedSession: string | null, duty: boolean): boolean {
  return duty && headerState(storedSession) === 'user';
}
