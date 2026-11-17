/**
 * Edge Function `admin-delete-user` (SPEC-002 US-6, AC-24, AC-25, §5).
 * POST `{ user_id }` z JWT admina:
 * 1. `rpc/is_admin` z JWT wywołującego (to samo źródło co RLS) — inaczej 403;
 * 2. `rpc/admin_log_account_delete` z JWT wywołującego — wpis `account_delete` (autor = auth.uid()),
 *    odmowa dla własnego konta (409) i nieistniejącego konta (404);
 * 3. `auth.admin.deleteUser` (DELETE /auth/v1/admin/users/:id) kluczem secret — kaskada w bazie usuwa `profiles`
 *    i karnety, `orders.user_id` / `created_by` dostają `null`. Gdy usunięcie się nie uda, wpis z punktu 2 jest wycofywany.
 * Klucz secret nigdy nie trafia do logów ani odpowiedzi. Identyfikator konta w logach — bez danych osobowych.
 */

export interface Config {
  supabaseUrl?: string;
  /** Klucz publishable — zapytania z JWT wywołującego. */
  supabaseKey?: string;
  /** Klucz secret — tylko Auth Admin API i wycofanie wpisu. */
  secretKey?: string;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  log?: (message: string) => void;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function readUserId(request: Request): Promise<string | null> {
  try {
    const body = await request.json();
    const id = body?.user_id;
    return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Wywołanie RPC z JWT wywołującego. */
function rpc(name: string, args: Record<string, unknown>, authorization: string, deps: Deps): Promise<Response> {
  const { supabaseUrl, supabaseKey } = deps.config;
  return deps.fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: supabaseKey!, Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
}

async function isAdmin(authorization: string, deps: Deps): Promise<boolean> {
  try {
    const response = await rpc('is_admin', {}, authorization, deps);
    return response.ok && (await response.json()) === true;
  } catch {
    return false;
  }
}

const secretHeaders = (secretKey: string) => ({ apikey: secretKey, Authorization: `Bearer ${secretKey}` });

/** Wycofanie wpisu `account_delete`, gdy konto nie zostało usunięte. Błąd tylko w logu. */
async function revertLog(entryId: number, deps: Deps, log: (m: string) => void): Promise<void> {
  const { supabaseUrl, secretKey } = deps.config;
  try {
    const response = await deps.fetch(`${supabaseUrl}/rest/v1/audit_log?id=eq.${entryId}`, {
      method: 'DELETE',
      headers: secretHeaders(secretKey!),
    });
    await response.body?.cancel();
    if (!response.ok) log(`admin-delete-user: nie wycofano wpisu audit_log ${entryId} (${response.status})`);
  } catch {
    log(`admin-delete-user: nie wycofano wpisu audit_log ${entryId} (błąd połączenia)`);
  }
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const { supabaseUrl, supabaseKey, secretKey } = deps.config;
  if (!supabaseUrl || !supabaseKey || !secretKey) {
    log('admin-delete-user: brak konfiguracji (SUPABASE_URL, klucz publishable lub secret)');
    return json(500, { error: 'not_configured' });
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization) || !(await isAdmin(authorization, deps))) {
    return json(403, { error: 'forbidden' });
  }

  const userId = await readUserId(request);
  if (!userId) return json(404, { error: 'not_found' });

  // Wpis account_delete (sprawdza też admina, własne konto i istnienie konta w bazie).
  let entryId: number;
  try {
    const response = await rpc('admin_log_account_delete', { user_id: userId }, authorization, deps);
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (body?.message === 'own_account') return json(409, { error: 'own_account' });
      if (body?.code === 'P0002') return json(404, { error: 'not_found' });
      if (body?.code === '42501') return json(403, { error: 'forbidden' });
      log(`admin-delete-user: admin_log_account_delete odpowiedziało ${response.status}`);
      return json(500, { error: 'delete_failed' });
    }
    entryId = Number(body);
  } catch {
    log('admin-delete-user: błąd połączenia z bazą');
    return json(500, { error: 'delete_failed' });
  }

  try {
    const response = await deps.fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: secretHeaders(secretKey),
    });
    await response.body?.cancel();
    if (!response.ok) {
      await revertLog(entryId, deps, log);
      if (response.status === 404) return json(404, { error: 'not_found' });
      log(`admin-delete-user: Auth Admin API odpowiedziało ${response.status} dla konta ${userId}`);
      return json(500, { error: 'delete_failed' });
    }
  } catch {
    await revertLog(entryId, deps, log);
    log(`admin-delete-user: błąd połączenia z Auth Admin API dla konta ${userId}`);
    return json(500, { error: 'delete_failed' });
  }
  return new Response(null, { status: 204, headers: CORS });
}
