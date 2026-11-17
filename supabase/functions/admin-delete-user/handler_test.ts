// Testy Deno: `deno test supabase/functions/` (SPEC-002 AC-24, AC-25, §5).
import { handle, type Config } from './handler.ts';

const SECRET = 'sb_secret_SECRET_VALUE';
const CONFIG: Config = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseKey: 'sb_publishable_test',
  secretKey: SECRET,
};
const TARGET = '00000000-0000-0000-0000-0000000000c1';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Call {
  url: string;
  init: RequestInit;
}

interface Mock {
  admin?: unknown;
  log?: { status: number; body: unknown };
  deleteStatus?: number;
  revertStatus?: number;
}

/** Zamockowany fetch: `is_admin`, `admin_log_account_delete`, Auth Admin API i wycofanie wpisu. */
function mockFetch({ admin = true, log = { status: 200, body: 42 }, deleteStatus = 200, revertStatus = 204 }: Mock = {}) {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/rest/v1/rpc/is_admin')) return Promise.resolve(new Response(JSON.stringify(admin)));
    if (url.endsWith('/rest/v1/rpc/admin_log_account_delete')) {
      return Promise.resolve(new Response(JSON.stringify(log.body), { status: log.status }));
    }
    if (url.includes('/auth/v1/admin/users/')) return Promise.resolve(new Response('{}', { status: deleteStatus }));
    if (url.includes('/rest/v1/audit_log')) return Promise.resolve(new Response(null, { status: revertStatus }));
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const post = (body: unknown, authorization: string | null = 'Bearer admin-jwt') =>
  new Request('http://localhost/admin-delete-user', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: JSON.stringify(body),
  });

const deleteCalls = (calls: Call[]) => calls.filter((call) => call.url.includes('/auth/v1/admin/users/'));
const revertCalls = (calls: Call[]) => calls.filter((call) => call.url.includes('/rest/v1/audit_log'));

Deno.test('AC-24: bez zalogowania — 403, nic nie jest usuwane', async () => {
  const { calls, fetch } = mockFetch();
  const response = await handle(post({ user_id: TARGET }, null), { fetch, config: CONFIG });
  assert(response.status === 403, `status ${response.status}`);
  assert(calls.length === 0, 'nie powinno być żadnych wywołań');
});

Deno.test('AC-24: nie-admin — 403, is_admin() z JWT wywołującego, bez wpisu i usunięcia', async () => {
  const { calls, fetch } = mockFetch({ admin: false });
  const response = await handle(post({ user_id: TARGET }, 'Bearer staff-jwt'), { fetch, config: CONFIG });
  assert(response.status === 403, `status ${response.status}`);
  assert(calls.length === 1 && calls[0].url === 'https://project.supabase.co/rest/v1/rpc/is_admin', calls[0]?.url);
  const headers = new Headers(calls[0].init.headers);
  assert(headers.get('Authorization') === 'Bearer staff-jwt', 'JWT wywołującego');
  assert(headers.get('apikey') === 'sb_publishable_test', 'klucz publishable, nie secret');
});

Deno.test('AC-24: admin — wpis account_delete z JWT admina, potem usunięcie kluczem secret, 204', async () => {
  const { calls, fetch } = mockFetch();
  const response = await handle(post({ user_id: TARGET.toUpperCase() }), { fetch, config: CONFIG });
  assert(response.status === 204, `status ${response.status}`);
  const urls = calls.map((call) => call.url);
  assert(
    JSON.stringify(urls) ===
      JSON.stringify([
        'https://project.supabase.co/rest/v1/rpc/is_admin',
        'https://project.supabase.co/rest/v1/rpc/admin_log_account_delete',
        `https://project.supabase.co/auth/v1/admin/users/${TARGET}`,
      ]),
    urls.join(', '),
  );
  const logCall = calls[1];
  assert(new Headers(logCall.init.headers).get('Authorization') === 'Bearer admin-jwt', 'wpis z JWT admina (autor)');
  assert(JSON.parse(String(logCall.init.body)).user_id === TARGET, String(logCall.init.body));
  const deleteCall = calls[2];
  assert(deleteCall.init.method === 'DELETE', 'DELETE');
  const headers = new Headers(deleteCall.init.headers);
  assert(headers.get('apikey') === SECRET && headers.get('Authorization') === `Bearer ${SECRET}`, 'klucz secret');
  assert(revertCalls(calls).length === 0, 'bez wycofania wpisu');
});

Deno.test('AC-25: własne konto — 409, bez usunięcia', async () => {
  const { calls, fetch } = mockFetch({ log: { status: 400, body: { code: 'P0001', message: 'own_account' } } });
  const response = await handle(post({ user_id: TARGET }), { fetch, config: CONFIG });
  assert(response.status === 409, `status ${response.status}`);
  assert(deleteCalls(calls).length === 0, 'Auth Admin API nie powinno być wywołane');
});

Deno.test('AC-24: nieistniejące konto lub zły identyfikator — 404, bez usunięcia', async () => {
  const { calls, fetch } = mockFetch({ log: { status: 404, body: { code: 'P0002', message: 'not_found' } } });
  const response = await handle(post({ user_id: TARGET }), { fetch, config: CONFIG });
  assert(response.status === 404, `status ${response.status}`);
  assert(deleteCalls(calls).length === 0, 'Auth Admin API nie powinno być wywołane');
  for (const body of [{}, { user_id: 'abc' }, { user_id: 1 }, 'nie-json']) {
    const mock = mockFetch();
    const bad = await handle(post(body), { fetch: mock.fetch, config: CONFIG });
    assert(bad.status === 404, `status ${bad.status} dla ${JSON.stringify(body)}`);
    assert(deleteCalls(mock.calls).length === 0, 'Auth Admin API nie powinno być wywołane');
  }
});

Deno.test('§7: błąd Auth Admin API — 500, wpis wycofany, klucz secret nie trafia do odpowiedzi ani logów', async () => {
  const logs: string[] = [];
  const { calls, fetch } = mockFetch({ deleteStatus: 500 });
  const response = await handle(post({ user_id: TARGET }), { fetch, config: CONFIG, log: (m) => logs.push(m) });
  assert(response.status === 500, `status ${response.status}`);
  const [revert] = revertCalls(calls);
  assert(revert?.url === 'https://project.supabase.co/rest/v1/audit_log?id=eq.42', revert?.url);
  assert(revert.init.method === 'DELETE', 'DELETE');
  assert(!(await response.text()).includes(SECRET), 'klucz w odpowiedzi');
  assert(logs.length === 1 && !logs.join().includes(SECRET), 'klucz w logach');
});

Deno.test('§7: brak konfiguracji — 500 bez wywołań', async () => {
  for (const config of [{ ...CONFIG, secretKey: undefined }, { ...CONFIG, supabaseUrl: undefined }]) {
    const { calls, fetch } = mockFetch();
    const response = await handle(post({ user_id: TARGET }), { fetch, config, log: () => {} });
    assert(response.status === 500, `status ${response.status}`);
    assert(calls.length === 0, 'nie powinno być wywołań');
  }
});

Deno.test('CORS: OPTIONS — 204 z nagłówkami, GET — 405', async () => {
  const { fetch } = mockFetch();
  const options = await handle(new Request('http://localhost/', { method: 'OPTIONS' }), { fetch, config: CONFIG });
  assert(options.status === 204, `status ${options.status}`);
  assert(options.headers.get('Access-Control-Allow-Origin') === '*', 'CORS');
  const get = await handle(new Request('http://localhost/'), { fetch, config: CONFIG });
  assert(get.status === 405, `status ${get.status}`);
});
