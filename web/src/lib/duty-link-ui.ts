/**
 * Link „Książka” w nagłówku dla dyżurnego Prowadzącego (SPEC-009, ADR-0008) — pamięć w `sessionStorage`, nagłówek i
 * zapytanie `fetch` do `rpc/is_range_duty_officer`. Bez `@supabase/supabase-js` (nagłówek stron publicznych).
 * Logika: lib/duty-link.ts.
 */
import { AUTH_STORAGE_KEY } from './auth';
import { DUTY_LINK_KEY, dutyDecision, dutyFromResponse, serializeDutyMemory, showDutyLink } from './duty-link';

function sessionStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null; // tryb prywatny, blokada — nagłówek pyta przy każdym załadowaniu (§7)
  }
}

function storedSession(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(AUTH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setHeaderLink(duty: boolean): void {
  if (typeof document === 'undefined') return;
  const visible = showDutyLink(storedSession(), duty);
  for (const item of document.querySelectorAll<HTMLElement>('[data-header-auth="duty"]')) item.hidden = !visible;
}

/**
 * AC-9: zapisuje wynik `is_range_duty_officer` (`/konto/`, bramka panelu, nagłówek) i od razu pokazuje / ukrywa
 * „Książka” w nagłówku tej strony.
 */
export function rememberDuty(sub: string, duty: boolean): void {
  try {
    sessionStore()?.setItem(DUTY_LINK_KEY, serializeDutyMemory(sub, duty));
  } catch {
    // pełna lub zablokowana pamięć — bez zapamiętania
  }
  setHeaderLink(duty);
}

/** AC-10: wylogowanie usuwa zapamiętany wynik. */
export function forgetDuty(): void {
  try {
    sessionStore()?.removeItem(DUTY_LINK_KEY);
  } catch {
    // brak pamięci — nic do usunięcia
  }
}

/** Nagłówek strony publicznej: pamięć tej karty albo jedno zapytanie (AC-1…AC-8). */
export async function mountHeaderDutyLink(): Promise<void> {
  let memory: string | null;
  try {
    memory = sessionStore()?.getItem(DUTY_LINK_KEY) ?? null;
  } catch {
    memory = null;
  }
  const decision = dutyDecision(storedSession(), memory);
  if (decision.kind === 'none') return;
  if (decision.kind === 'remembered') return setHeaderLink(decision.duty);

  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  let duty: boolean | null;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/is_range_duty_officer`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${decision.accessToken}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    duty = dutyFromResponse(response.ok, response.ok ? await response.json() : null);
  } catch {
    duty = null;
  }
  // AC-5: błąd — bez linku, bez zapamiętania, bez komunikatu.
  if (duty === null) return;
  rememberDuty(decision.sub, duty);
}
