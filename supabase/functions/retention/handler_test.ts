// Testy Deno: `deno test supabase/functions/` (SPEC-005 AC-30, AC-31, §8; ADR-0006).
import { BATCH, type Config, handle, STORAGE_CHUNK } from './handler.ts';

const SECRET = 'sb_secret_SECRET_VALUE';
const INVOKE = 'invoke-secret-value';
const CONFIG: Config = { supabaseUrl: 'https://project.supabase.co', secretKey: SECRET, invokeSecret: INVOKE };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Call {
  url: string;
  init: RequestInit;
}

interface Row {
  name: string;
  orphan: boolean;
}

interface Mock {
  /** Kolejne odpowiedzi `retention_signatures`. */
  batches?: Row[][];
  listStatus?: number;
  storageStatus?: number;
  purged?: number;
  purgeStatus?: number;
}

/** Zamockowany fetch: RPC `retention_signatures`, `purge_range_log` i Storage API. */
function mockFetch({ batches = [], listStatus = 200, storageStatus = 200, purged = 0, purgeStatus = 200 }: Mock = {}) {
  const calls: Call[] = [];
  let batch = 0;
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/rest/v1/rpc/retention_signatures')) {
      const rows = batches[batch++] ?? [];
      return Promise.resolve(new Response(JSON.stringify(rows), { status: listStatus }));
    }
    if (url.endsWith('/storage/v1/object/signatures')) {
      const { prefixes } = JSON.parse(String(init.body));
      const removed = (prefixes as string[]).map((name) => ({ name }));
      return Promise.resolve(new Response(JSON.stringify(removed), { status: storageStatus }));
    }
    if (url.endsWith('/rest/v1/rpc/purge_range_log')) {
      return Promise.resolve(new Response(JSON.stringify(purged), { status: purgeStatus }));
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const post = (authorization: string | null = `Bearer ${INVOKE}`) =>
  new Request('http://localhost/retention', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: '{}',
  });

const storageCalls = (calls: Call[]) => calls.filter((call) => call.url.includes('/storage/v1/'));
const purgeIndex = (calls: Call[]) => calls.findIndex((call) => call.url.endsWith('/rpc/purge_range_log'));

Deno.test('ADR-0006: bez sekretu wywołania — 401, nic nie jest usuwane', async () => {
  for (const authorization of [null, 'Bearer zly-sekret', INVOKE, `Bearer ${SECRET}`]) {
    const { calls, fetch } = mockFetch();
    const response = await handle(post(authorization), { fetch, config: CONFIG, log: () => {} });
    assert(response.status === 401, `status ${response.status} dla ${authorization}`);
    assert(calls.length === 0, 'nie powinno być żadnych wywołań');
  }
});

Deno.test('ADR-0006: brak konfiguracji — 500 bez wywołań', async () => {
  const { calls, fetch } = mockFetch();
  const response = await handle(post(), { fetch, config: { ...CONFIG, invokeSecret: undefined }, log: () => {} });
  assert(response.status === 500, `status ${response.status}`);
  assert(calls.length === 0, 'nie powinno być żadnych wywołań');
});

Deno.test('ADR-0006: tylko POST', async () => {
  const { fetch } = mockFetch();
  const response = await handle(new Request('http://localhost/retention'), { fetch, config: CONFIG });
  assert(response.status === 405, `status ${response.status}`);
});

Deno.test('AC-30, AC-31: najpierw pliki podpisów (klucz secret), potem wiersze; w logu tylko liczby', async () => {
  const { calls, fetch } = mockFetch({
    batches: [
      [
        { name: '2025/10/aaaaaaaa-0000-0000-0000-000000000001.png', orphan: false },
        { name: '2025/10/aaaaaaaa-0000-0000-0000-000000000002.png', orphan: false },
        { name: '2026/11/bbbbbbbb-0000-0000-0000-000000000001.png', orphan: true },
      ],
    ],
    purged: 2,
  });
  const logs: string[] = [];
  const response = await handle(post(), { fetch, config: CONFIG, log: (m) => logs.push(m) });
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.json();
  assert(body.signatures_deleted === 2, `signatures_deleted ${body.signatures_deleted}`);
  assert(body.orphans_deleted === 1, `orphans_deleted ${body.orphans_deleted}`);
  assert(body.entries_deleted === 2, `entries_deleted ${body.entries_deleted}`);
  assert(body.signatures_failed === 0, 'bez błędów');

  const storage = storageCalls(calls);
  assert(storage.length === 2, `wywołania Storage ${storage.length}`);
  for (const call of storage) {
    assert(call.init.method === 'DELETE', 'DELETE');
    const headers = call.init.headers as Record<string, string>;
    assert(headers.Authorization === `Bearer ${SECRET}`, 'klucz secret w Storage API');
  }
  const lastStorage = calls.lastIndexOf(storage[storage.length - 1]);
  assert(purgeIndex(calls) > lastStorage, 'purge_range_log po usunięciu plików');
  const logged = logs.join('\n');
  assert(
    !logged.includes('.png') && !logged.includes(SECRET) && !logged.includes(INVOKE),
    'log bez ścieżek i sekretów',
  );
});

Deno.test('AC-30: Storage API zwraca błąd — wiersze i tak przez purge_range_log (usuwa tylko wpisy bez pliku)', async () => {
  const { calls, fetch } = mockFetch({
    batches: [[{ name: '2025/10/aaaaaaaa-0000-0000-0000-000000000001.png', orphan: false }]],
    storageStatus: 503,
  });
  const response = await handle(post(), { fetch, config: CONFIG, log: () => {} });
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.json();
  assert(body.signatures_deleted === 0 && body.signatures_failed === 1, JSON.stringify(body));
  assert(purgeIndex(calls) >= 0, 'purge_range_log wywołane');
  const lists = calls.filter((call) => call.url.endsWith('/rpc/retention_signatures'));
  assert(lists.length === 1, 'bez ponownego pobierania tych samych plików');
});

Deno.test('AC-30: pliki usuwane po maks. 100 w żądaniu; kolejne partie aż do pustej', async () => {
  const full = Array.from({ length: BATCH }, (_, i) => ({
    name: `2025/10/${String(i).padStart(8, '0')}-0000-0000-0000-000000000000.png`,
    orphan: false,
  }));
  const { calls, fetch } = mockFetch({ batches: [full, []], purged: BATCH });
  const response = await handle(post(), { fetch, config: CONFIG });
  const body = await response.json();
  assert(body.signatures_deleted === BATCH, `signatures_deleted ${body.signatures_deleted}`);
  const storage = storageCalls(calls);
  assert(storage.length === BATCH / STORAGE_CHUNK, `wywołania Storage ${storage.length}`);
  assert(calls.filter((call) => call.url.endsWith('/rpc/retention_signatures')).length === 2, 'dwie partie');
});

Deno.test('ADR-0006: błąd bazy — 500, bez usuwania wierszy', async () => {
  const { calls, fetch } = mockFetch({ listStatus: 500 });
  const response = await handle(post(), { fetch, config: CONFIG, log: () => {} });
  assert(response.status === 500, `status ${response.status}`);
  assert(purgeIndex(calls) === -1, 'purge_range_log nie wywołane');
  assert(storageCalls(calls).length === 0, 'Storage nie wywołane');
});
