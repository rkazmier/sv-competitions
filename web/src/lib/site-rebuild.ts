/**
 * Wyzwalacz przebudowy strony publicznej z panelu (SPEC-001 US-7, AC-29, AC-34, §7, ADR-0003).
 * Edge Function `site-rebuild` sprawdza rolę organizatora i uruchamia workflow `rebuild-site.yml`.
 */
import { t } from '../i18n';

export const SITE_REBUILD_FUNCTION = 'site-rebuild';

/** Wycinek klienta Supabase potrzebny tutaj (ułatwia testy). */
export interface FunctionsClient {
  functions: { invoke: (name: string, options?: { method?: 'POST' }) => PromiseLike<{ error: unknown }> };
}

/** `true`, gdy przebudowa została uruchomiona; błąd sieci lub funkcji → `false` (bez wyjątku). */
export async function requestSiteRebuild(supabase: FunctionsClient): Promise<boolean> {
  try {
    const { error } = await supabase.functions.invoke(SITE_REBUILD_FUNCTION, { method: 'POST' });
    return !error;
  } catch {
    return false;
  }
}

/** Komunikat po zmianie: „<prefix> Strona publiczna odświeży się…” albo §7 przy nieudanym uruchomieniu. */
export function rebuildMessage(started: boolean, prefix = ''): string {
  const tail = started ? t('rebuild.started') : t('rebuild.failed');
  return prefix ? `${prefix} ${tail}` : tail;
}

/** Uruchamia przebudowę i zwraca komunikat do pokazania w panelu. */
export async function rebuildAndDescribe(supabase: FunctionsClient, prefix = ''): Promise<string> {
  return rebuildMessage(await requestSiteRebuild(supabase), prefix);
}
