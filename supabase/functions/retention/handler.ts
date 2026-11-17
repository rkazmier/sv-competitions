/**
 * Edge Function `retention` (SPEC-005 AC-30, AC-31, §8; ADR-0006).
 * Wywołuje ją codziennie `pg_cron` + `pg_net` (`public.invoke_retention()`) z nagłówkiem
 * `Authorization: Bearer <RETENTION_INVOKE_SECRET>`. Kolejność — najpierw pliki, potem wiersze:
 * 1. `rpc/retention_signatures` — ścieżki podpisów wpisów starszych niż `range_log_retention()` i osieroconych
 *    starszych niż 24 h (partiami);
 * 2. Storage API `DELETE /storage/v1/object/signatures` (klucz secret), po 100 plików;
 * 3. `rpc/purge_range_log` — usuwa wpisy, których plik już nie istnieje (adnotacje kaskadą, `pass_usages` zostaje).
 * W logu i odpowiedzi tylko liczby — bez ścieżek i danych osobowych. Idempotentna: błąd nadrabia kolejne uruchomienie.
 */

export interface Config {
  supabaseUrl?: string;
  /** Klucz secret — RPC tylko dla `service_role` i Storage API. */
  secretKey?: string;
  /** Sekret wywołania z `pg_net` (ten sam w Vault bazy). */
  invokeSecret?: string;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  log?: (message: string) => void;
}

export interface Result {
  signatures_deleted: number;
  orphans_deleted: number;
  signatures_failed: number;
  entries_deleted: number;
}

/** Rozmiar partii z bazy i maksymalna liczba partii w jednym uruchomieniu. */
export const BATCH = 1000;
export const MAX_BATCHES = 20;
/** Liczba plików w jednym żądaniu usunięcia do Storage API. */
export const STORAGE_CHUNK = 100;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Porównanie w stałym czasie (bez wycieku długości wspólnego prefiksu). */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

class StepError extends Error {}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const { supabaseUrl, secretKey, invokeSecret } = deps.config;
  if (!supabaseUrl || !secretKey || !invokeSecret) {
    log('retention: brak konfiguracji (SUPABASE_URL, klucz secret lub RETENTION_INVOKE_SECRET)');
    return json(500, { error: 'not_configured' });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!safeEqual(authorization, `Bearer ${invokeSecret}`)) return json(401, { error: 'unauthorized' });

  const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' };

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await deps.fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(args),
      });
    } catch {
      throw new StepError(`${name}: błąd połączenia`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new StepError(`${name}: odpowiedź ${response.status}`);
    }
    return (await response.json()) as T;
  }

  /** Usuwa pliki; zwraca liczbę usuniętych (nieudane partie zostają na następne uruchomienie). */
  async function removeFiles(names: string[]): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < names.length; i += STORAGE_CHUNK) {
      const chunk = names.slice(i, i + STORAGE_CHUNK);
      try {
        const response = await deps.fetch(`${supabaseUrl}/storage/v1/object/signatures`, {
          method: 'DELETE',
          headers,
          body: JSON.stringify({ prefixes: chunk }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          log(`retention: Storage API odpowiedziało ${response.status} (${chunk.length} plików pominięto)`);
          continue;
        }
        const removed = await response.json().catch(() => null);
        deleted += Array.isArray(removed) ? removed.length : chunk.length;
      } catch {
        log(`retention: błąd połączenia ze Storage API (${chunk.length} plików pominięto)`);
      }
    }
    return deleted;
  }

  const result: Result = { signatures_deleted: 0, orphans_deleted: 0, signatures_failed: 0, entries_deleted: 0 };
  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await rpc<{ name: string; orphan: boolean }[]>('retention_signatures', { p_limit: BATCH });
      if (!Array.isArray(rows) || rows.length === 0) break;
      const expired = rows.filter((row) => !row.orphan).map((row) => row.name);
      const orphans = rows.filter((row) => row.orphan).map((row) => row.name);
      const deletedExpired = await removeFiles(expired);
      const deletedOrphans = await removeFiles(orphans);
      result.signatures_deleted += deletedExpired;
      result.orphans_deleted += deletedOrphans;
      const failed = rows.length - deletedExpired - deletedOrphans;
      result.signatures_failed += failed;
      // Nic nie usunięto — kolejna partia zwróciłaby te same pliki.
      if (failed > 0 || rows.length < BATCH) break;
    }
    result.entries_deleted = Number(await rpc<number>('purge_range_log', {}));
  } catch (error) {
    log(`retention: ${error instanceof StepError ? error.message : 'nieoczekiwany błąd'}`);
    return json(500, { error: 'retention_failed', ...result });
  }

  log(
    `retention: podpisy wpisów ${result.signatures_deleted}, osierocone ${result.orphans_deleted}, ` +
      `nieusunięte ${result.signatures_failed}, wpisy ${result.entries_deleted}`,
  );
  return json(200, result);
}
