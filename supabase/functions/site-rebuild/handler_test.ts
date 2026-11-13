// Testy Deno: `deno test supabase/functions/` (SPEC-001 AC-29, AC-30, §7).
import { handle, type Config } from './handler.ts';

const TOKEN = 'github_pat_SECRET_VALUE';
const CONFIG: Config = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseKey: 'sb_publishable_test',
  githubToken: TOKEN,
  siteEnv: 'staging',
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Call {
  url: string;
  init: RequestInit;
}

/** Zamockowany fetch: `is_organizer` zwraca `organizer`, GitHub odpowiada `githubStatus`. */
function mockFetch(organizer: unknown, githubStatus = 204, rpcStatus = 200) {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/rest/v1/rpc/is_organizer')) {
      return Promise.resolve(new Response(JSON.stringify(organizer), { status: rpcStatus }));
    }
    return Promise.resolve(new Response(githubStatus === 204 ? null : 'error', { status: githubStatus }));
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const post = (authorization?: string) =>
  new Request('http://localhost/site-rebuild', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
  });

const githubCalls = (calls: Call[]) => calls.filter((call) => call.url.startsWith('https://api.github.com/'));

Deno.test('AC-30: bez zalogowania — 403 i brak wywołania GitHub API', async () => {
  const { calls, fetch } = mockFetch(true);
  const response = await handle(post(), { fetch, config: CONFIG });
  assert(response.status === 403, `status ${response.status}`);
  assert(calls.length === 0, 'nie powinno być żadnych wywołań');
});

Deno.test('AC-30: zalogowany nie-organizator — 403 i brak wywołania GitHub API', async () => {
  const { calls, fetch } = mockFetch(false);
  const response = await handle(post('Bearer user-jwt'), { fetch, config: CONFIG });
  assert(response.status === 403, `status ${response.status}`);
  assert(githubCalls(calls).length === 0, 'GitHub API nie powinno być wywołane');
  assert(calls[0].url === 'https://project.supabase.co/rest/v1/rpc/is_organizer', calls[0].url);
  const headers = new Headers(calls[0].init.headers);
  assert(headers.get('Authorization') === 'Bearer user-jwt', 'JWT użytkownika przekazany do is_organizer()');
  assert(headers.get('apikey') === 'sb_publishable_test', 'apikey');
});

Deno.test('AC-30: nieważny JWT (błąd PostgREST) — 403', async () => {
  const { calls, fetch } = mockFetch({ message: 'JWT expired' }, 204, 401);
  const response = await handle(post('Bearer expired'), { fetch, config: CONFIG });
  assert(response.status === 403, `status ${response.status}`);
  assert(githubCalls(calls).length === 0, 'GitHub API nie powinno być wywołane');
});

Deno.test('AC-29: organizator — workflow_dispatch rebuild-site.yml z ref main i target z SITE_ENV', async () => {
  for (const siteEnv of ['staging', 'production']) {
    const { calls, fetch } = mockFetch(true);
    const response = await handle(post('Bearer organizer-jwt'), { fetch, config: { ...CONFIG, siteEnv } });
    assert(response.status === 202, `status ${response.status}`);
    const [call] = githubCalls(calls);
    assert(
      call.url === 'https://api.github.com/repos/rkazmier/sv-competitions/actions/workflows/rebuild-site.yml/dispatches',
      call.url,
    );
    assert(call.init.method === 'POST', 'POST');
    const headers = new Headers(call.init.headers);
    assert(headers.get('Authorization') === `Bearer ${TOKEN}`, 'token w nagłówku');
    assert(headers.get('Accept') === 'application/vnd.github+json', 'Accept');
    const body = JSON.parse(String(call.init.body));
    assert(body.ref === 'main' && body.inputs.target === siteEnv, JSON.stringify(body));
    const text = await response.text();
    assert(!text.includes(TOKEN), 'token nie trafia do odpowiedzi');
  }
});

Deno.test('§7: błąd GitHub API — 502, token nie trafia do odpowiedzi ani logów', async () => {
  const logs: string[] = [];
  const { fetch } = mockFetch(true, 401);
  const response = await handle(post('Bearer organizer-jwt'), { fetch, config: CONFIG, log: (m) => logs.push(m) });
  assert(response.status === 502, `status ${response.status}`);
  assert(!(await response.text()).includes(TOKEN), 'token w odpowiedzi');
  assert(logs.length === 1 && !logs.join().includes(TOKEN), 'token w logach');
});

Deno.test('§7: brak tokenu lub nieznane SITE_ENV — 500 bez wywołania GitHub API', async () => {
  for (const config of [{ ...CONFIG, githubToken: undefined }, { ...CONFIG, siteEnv: 'dev' }]) {
    const { calls, fetch } = mockFetch(true);
    const response = await handle(post('Bearer organizer-jwt'), { fetch, config, log: () => {} });
    assert(response.status === 500, `status ${response.status}`);
    assert(githubCalls(calls).length === 0, 'GitHub API nie powinno być wywołane');
  }
});

Deno.test('CORS: OPTIONS — 204 z nagłówkami, GET — 405', async () => {
  const { fetch } = mockFetch(true);
  const options = await handle(new Request('http://localhost/', { method: 'OPTIONS' }), { fetch, config: CONFIG });
  assert(options.status === 204, `status ${options.status}`);
  assert(options.headers.get('Access-Control-Allow-Origin') === '*', 'CORS');
  const get = await handle(new Request('http://localhost/'), { fetch, config: CONFIG });
  assert(get.status === 405, `status ${get.status}`);
});
