/**
 * Rejestracja i logowanie e-mail + hasło (SPEC-002 US-1, AC-1…AC-6) — logika bez DOM, testowana w Vitest.
 * Interfejs: lib/auth-ui.ts.
 */

/** Klucz sesji w localStorage (stały, niezależny od hosta — używany też przez testy E2E i nagłówek). */
export const AUTH_STORAGE_KEY = 'sv-auth';

/** Minimalna długość hasła (AC-1; tak samo `minimum_password_length` w Supabase Auth). */
export const PASSWORD_MIN = 8;

/** Strona po zalogowaniu, gdy nie podano `?next=` (AC-5). */
export const ACCOUNT_HOME = '/konto/';
export const LOGIN_PAGE = '/logowanie/';
export const NEW_PASSWORD_PAGE = '/logowanie/nowe-haslo/';

/**
 * `?next=` — tylko ścieżka tej aplikacji (AC-5): zaczyna się od `/`, bez innego hosta (`//host`, `/\host`).
 * Zwraca ścieżkę z zapytaniem i kotwicą albo `null`.
 */
export function safeNextPath(raw: string | null | undefined, origin: string): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;
  return url.pathname + url.search + url.hash;
}

/** Dokąd po zalogowaniu (AC-5): bezpieczny `next` albo `/konto/`. */
export function afterSignInPath(rawNext: string | null | undefined, origin: string): string {
  return safeNextPath(rawNext, origin) ?? ACCOUNT_HOME;
}

/** Adres strony z przekazanym dalej `?next=` (np. link „Załóż konto” z `/logowanie/?next=…`). */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}

export type FieldErrors = Partial<Record<'email' | 'password' | 'password2', 'emailInvalid' | 'passwordTooShort' | 'passwordMismatch'>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): FieldErrors {
  return EMAIL.test(email.trim()) ? {} : { email: 'emailInvalid' };
}

/** Nowe hasło i jego powtórzenie (rejestracja, `/logowanie/nowe-haslo/`). */
export function validateNewPassword(password: string, password2: string): FieldErrors {
  if (password.length < PASSWORD_MIN) return { password: 'passwordTooShort' };
  if (password !== password2) return { password2: 'passwordMismatch' };
  return {};
}

export type SignInFailure = 'invalidCredentials' | 'emailNotConfirmed' | 'rateLimited' | 'genericError';

/** Błąd Supabase Auth → komunikat (AC-5). */
export function signInFailure(error: { code?: string; status?: number } | null): SignInFailure {
  if (error?.code === 'email_not_confirmed') return 'emailNotConfirmed';
  if (error?.code === 'invalid_credentials') return 'invalidCredentials';
  if (error?.status === 429 || error?.code?.startsWith('over_')) return 'rateLimited';
  return 'genericError';
}

export type HeaderState = 'guest' | 'user' | 'staff';

/**
 * Linki konta w nagłówku strony publicznej (SPEC-002 §6): z zapisanej sesji (localStorage, bez zapytań).
 * Rola z claimu `app_role` (Custom Access Token Hook — tylko UI; uprawnienia sprawdza RLS).
 */
export function headerState(storedSession: string | null): HeaderState {
  if (!storedSession) return 'guest';
  try {
    const session = JSON.parse(storedSession) as { access_token?: string };
    const payload = session.access_token?.split('.')[1];
    if (!payload) return 'guest';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const role = (JSON.parse(json) as { app_role?: string }).app_role;
    return role === 'staff' || role === 'admin' ? 'staff' : 'user';
  } catch {
    return 'guest';
  }
}
