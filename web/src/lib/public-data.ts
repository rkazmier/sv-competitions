/**
 * Dane stron publicznych pobierane przy budowaniu (SPEC-001 §8, ADR-0003) kluczem publishable —
 * RLS zwraca tylko opublikowane wpisy (AC-37), filtr `status` jest dodatkowym zabezpieczeniem.
 *
 * Błąd pobrania = błąd buildu (§7: nie publikujemy pustego kalendarza zamiast prawdziwego).
 * Brak konfiguracji Supabase jest dozwolony tylko poza wdrożeniem (lint/test/build w CI bez bazy):
 * gdy ustawione jest `PUBLIC_APP_ENV` (staging, produkcja), brak zmiennych też kończy build błędem.
 */
import { createClient } from '@supabase/supabase-js';
import { COMPETITION_PAGE_COLUMNS, EVENT_COLUMNS, type CompetitionRow, type EventRow, type PublicUrl } from './competition-page';
import { STORAGE_BUCKET } from './rulebooks';

export interface PublicData {
  competitions: CompetitionRow[];
  events: EventRow[];
  publicUrl: PublicUrl;
}

let cached: Promise<PublicData> | undefined;

/** Jedno pobranie na build (kalendarz i strony zawodów korzystają z tych samych danych). */
export function loadPublicData(): Promise<PublicData> {
  cached ??= fetchPublicData();
  return cached;
}

async function fetchPublicData(): Promise<PublicData> {
  const url = import.meta.env.PUBLIC_SUPABASE_URL;
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    if (import.meta.env.PUBLIC_APP_ENV) {
      throw new Error('Brak PUBLIC_SUPABASE_URL lub PUBLIC_SUPABASE_ANON_KEY — nie można zbudować stron publicznych');
    }
    console.warn('[public-data] Brak konfiguracji Supabase — strony publiczne bez danych (build lokalny/CI).');
    return { competitions: [], events: [], publicUrl: (path) => path };
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const [competitions, events] = await Promise.all([
    supabase.from('competitions').select(COMPETITION_PAGE_COLUMNS).eq('status', 'published'),
    supabase.from('calendar_events').select(EVENT_COLUMNS).eq('status', 'published'),
  ]);
  const error = competitions.error ?? events.error;
  if (error) throw new Error(`Nie udało się pobrać danych z Supabase: ${error.message}`);

  const storage = supabase.storage.from(STORAGE_BUCKET);
  return {
    // Bez wygenerowanych typów bazy klient zakłada tablicę dla osadzenia; relacja wiele-do-jednego zwraca obiekt.
    competitions: (competitions.data ?? []) as unknown as CompetitionRow[],
    events: (events.data ?? []) as unknown as EventRow[],
    publicUrl: (path) => storage.getPublicUrl(path).data.publicUrl,
  };
}
