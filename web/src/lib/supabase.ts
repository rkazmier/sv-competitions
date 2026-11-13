import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Klient Supabase dla wysp w przeglądarce (panel). URL i klucz publishable ze zmiennych `PUBLIC_*`
 * (docs/architecture.md) — frontend nie zna żadnych sekretów.
 * Klient tworzony leniwie, więc build stron bez zmiennych (np. lint/test w CI) działa.
 */

/** Klucz sesji w localStorage (stały, niezależny od hosta — używany też przez testy E2E). */
export const AUTH_STORAGE_KEY = 'sv-auth';

let client: SupabaseClient | undefined;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.PUBLIC_SUPABASE_URL;
    const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Brak PUBLIC_SUPABASE_URL lub PUBLIC_SUPABASE_ANON_KEY');
    client = createClient(url, key, {
      auth: { flowType: 'pkce', storageKey: AUTH_STORAGE_KEY, persistSession: true, detectSessionInUrl: true },
    });
  }
  return client;
}
