import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Page } from '@playwright/test';

/**
 * Lokalny Supabase dla testów panelu (`supabase start`). Zmienne PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY
 * i SUPABASE_SECRET_KEY ustawia playwright.config.ts z `supabase status`.
 * Klucz secret — tylko lokalny (domyślny klucz CLI), nigdy klucz projektu staging/produkcja.
 *
 * Logowanie w testach bez Google: użytkownicy z hasłem tworzeni API administratora lokalnej instancji,
 * sesja wstrzykiwana do localStorage pod kluczem klienta aplikacji (`sv-auth`, web/src/lib/supabase.ts).
 */
const url = process.env.PUBLIC_SUPABASE_URL ?? '';
const publishableKey = process.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
const secretKey = process.env.SUPABASE_SECRET_KEY ?? '';

export const hasLocalSupabase = Boolean(url && publishableKey && secretKey);
export const AUTH_STORAGE_KEY = 'sv-auth';
const PASSWORD = 'local-e2e-only-password';

const options = { auth: { persistSession: false, autoRefreshToken: false } };

export function admin(): SupabaseClient {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error('Testy panelu działają tylko na lokalnym Supabase');
  }
  return createClient(url, secretKey, options);
}

export type Role = 'competitor' | 'organizer';

/** Tworzy (jeśli trzeba) użytkownika testowego z rolą i zwraca jego e-mail. */
export async function ensureUser(role: Role): Promise<string> {
  const email = `e2e-${role}@example.test`;
  const db = admin();
  const created = await db.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  let id = created.data.user?.id;
  if (!id) {
    const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    id = data.users.find((user) => user.email === email)?.id;
  }
  if (!id) throw created.error ?? new Error(`Nie udało się utworzyć ${email}`);
  const { error } = await db.from('profiles').update({ role }).eq('id', id);
  if (error) throw error;
  return email;
}

/** Loguje użytkownika hasłem (lokalnie) i wstrzykuje sesję przed załadowaniem strony. */
export async function signIn(page: Page, role: Role): Promise<void> {
  const email = await ensureUser(role);
  const client = createClient(url, publishableKey, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw error ?? new Error('Brak sesji');
  // Tylko przy pierwszym załadowaniu karty — po „Wyloguj się” sesja nie wraca.
  await page.addInitScript(
    ([key, value]) => {
      if (window.sessionStorage.getItem('e2e-session-injected')) return;
      window.sessionStorage.setItem('e2e-session-injected', '1');
      window.localStorage.setItem(key, value);
    },
    [AUTH_STORAGE_KEY, JSON.stringify(data.session)] as const,
  );
}

/** Unikalny sufiks nazw (baza lokalna nie jest czyszczona między uruchomieniami). */
export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
