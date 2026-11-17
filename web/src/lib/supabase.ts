import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY } from './auth';

/**
 * Klient Supabase dla wysp w przeglądarce (panel). URL i klucz publishable ze zmiennych `PUBLIC_*`
 * (docs/architecture.md) — frontend nie zna żadnych sekretów.
 * Klient tworzony leniwie, więc build stron bez zmiennych (np. lint/test w CI) działa.
 */

export { AUTH_STORAGE_KEY };

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
