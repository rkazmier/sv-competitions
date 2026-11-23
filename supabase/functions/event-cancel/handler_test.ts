// Testy Deno: `deno test supabase/functions/` (SPEC-012 AC-24, AC-51, §7).
import { type Config, handle, REFUND_BATCH } from './handler.ts';

const SECRET = 'sb_secret_SECRET_VALUE';
const TPAY_SECRET = 'TPAY_CLIENT_SECRET_VALUE';
const INVOKE = 'mail-invoke-secret';
const CONFIG: Config = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseKey: 'sb_publishable_test',
  secretKey: SECRET,
  invokeSecret: INVOKE,
  tpayApiUrl: 'https://openapi.sandbox.tpay.com',
  tpayClientId: 'client-id',
  tpayClientSecret: TPAY_SECRET,
};
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const EVENT = '00000000-0000-0000-0000-00000000e001';
const JWT = 'Bearer admin.jwt.token';
const SUMMARY = { event_id: EVENT, online: 2, on_site: 1, gifts: 0, unpaid: 0, emails: 3, refund_total: 15000 };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

interface Call {
  url: string;
  init: RequestInit;
}

interface Mock {
  user?: number;
  cancel?: { status: number; body: unknown };
  /** Kolejne zamówienia zwracane przez `event_refund_claim` (potem pusto). */
  claims?: { id: string; tpay_transaction_id: string | null; amount: number }[];
  /** Wynik zwrotu Tpay dla kolejnych zamówień (domyślnie sukces). */
  refunds?: ({ status: number; body: unknown } | 'network')[];
  token?: number;
}

function mockFetch({ user = 200, cancel = { status: 200, body: SUMMARY }, claims = [], refunds = [], token = 200 }: Mock = {}) {
  const calls: Call[] = [];
  let claim = 0;
  let refund = 0;
  const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return reply(user, user === 200 ? { id: ADMIN } : {});
    if (url.endsWith('/rpc/cancel_calendar_event')) return reply(cancel.status, cancel.body);
    if (url.endsWith('/rpc/event_refund_claim')) return reply(200, claims[claim] ? [claims[claim++]] : []);
    if (url.endsWith('/rpc/revert_order_refund')) return reply(200, true);
    if (url.endsWith('/oauth/auth')) return reply(token, token === 200 ? { access_token: 'tpay-token' } : {});
    if (url.includes('/refunds')) {
      const r = refunds[refund++] ?? { status: 200, body: { result: 'success' } };
      if (r === 'network') return Promise.reject(new TypeError('network'));
      return reply(r.status, r.body);
    }
    return reply(500, 'unexpected');
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

function request(body: unknown = { event_id: EVENT, reason: ' Awaria kulochwytu ' }, authorization = JWT) {
  return new Request('http://localhost/event-cancel', {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const order = (n: number) => ({ id: `00000000-0000-0000-0000-00000000d00${n}`, tpay_transaction_id: `01TPAY/${n}`, amount: 5000 });
const all = (calls: Call[], suffix: string) => calls.filter((call) => call.url.includes(suffix));

Deno.test('AC-24: cancel_calendar_event z JWT admina, potem pełne zwroty Tpay po kolei (bez kwoty)', async () => {
  const logs: string[] = [];
  const { calls, fetch } = mockFetch({ claims: [order(1), order(2)] });
  const response = await handle(request(), { fetch, config: CONFIG, log: (m) => logs.push(m) });
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.json();
  assert(body.status === 'cancelled' && body.summary.online === 2, JSON.stringify(body));
  assert(body.refunds.requested === 2 && body.refunds.failed === 0, JSON.stringify(body.refunds));

  const cancel = all(calls, '/rpc/cancel_calendar_event')[0];
  assert(new Headers(cancel.init.headers).get('Authorization') === JWT, 'odwołanie z JWT wywołującego (rola w bazie)');
  assert(String(cancel.init.body) === JSON.stringify({ p_event_id: EVENT, p_reason: 'Awaria kulochwytu' }), String(cancel.init.body));
  const claim = all(calls, '/rpc/event_refund_claim')[0];
  assert(new Headers(claim.init.headers).get('Authorization') === `Bearer ${SECRET}`, 'claim kluczem secret');
  const tpay = all(calls, '/refunds');
  assert(tpay.length === 2 && tpay[0].url.endsWith('/transactions/01TPAY%2F1/refunds'), tpay.map((c) => c.url).join());
  assert(String(tpay[0].init.body) === '{}', 'pełny zwrot — bez kwoty');
  assert(all(calls, '/oauth/auth').length === 1, 'jeden token na wywołanie');
  assert(all(calls, 'revert_order_refund').length === 0, 'bez cofania');
  assert(!logs.join().includes(SECRET) && !logs.join().includes(TPAY_SECRET), 'bez sekretów w logach');
});

Deno.test('AC-51: Tpay odrzuca zwrot → revert_order_refund (kluczem secret, aktor = admin), kolejne zwroty dalej', async () => {
  const { calls, fetch } = mockFetch({
    claims: [order(1), order(2), order(3)],
    refunds: [{ status: 400, body: { result: 'failed' } }, 'network'],
  });
  const response = await handle(request(), { fetch, config: CONFIG, log: () => {} });
  const body = await response.json();
  assert(response.status === 200 && body.refunds.requested === 1 && body.refunds.failed === 2, JSON.stringify(body));
  const reverts = all(calls, '/rpc/revert_order_refund');
  assert(reverts.length === 2, `cofnięcia ${reverts.length}`);
  assert(new Headers(reverts[0].init.headers).get('Authorization') === `Bearer ${SECRET}`, 'revert kluczem secret');
  assert(String(reverts[0].init.body) === JSON.stringify({ p_order_id: order(1).id, p_actor_id: ADMIN }), String(reverts[0].init.body));
});

Deno.test('AC-51: brak tokenu Tpay — pobrane zamówienie wraca do paid, reszta czeka na zadanie cykliczne', async () => {
  const { calls, fetch } = mockFetch({ claims: [order(1), order(2)], token: 401 });
  const body = await (await handle(request(), { fetch, config: CONFIG, log: () => {} })).json();
  assert(body.refunds.requested === 0 && body.refunds.failed === 1, JSON.stringify(body.refunds));
  assert(all(calls, '/rpc/event_refund_claim').length === 1, 'bez pobierania kolejnych');
  assert(all(calls, '/refunds').length === 0, 'bez zwrotów');
});

Deno.test('§7: zamówienie bez transakcji Tpay — zwrot nieudany (revert), bez wywołania Tpay', async () => {
  const { calls, fetch } = mockFetch({ claims: [{ ...order(1), tpay_transaction_id: null }] });
  const body = await (await handle(request(), { fetch, config: CONFIG, log: () => {} })).json();
  assert(body.refunds.failed === 1 && all(calls, '/refunds').length === 0, JSON.stringify(body.refunds));
});

Deno.test('§7: najwyżej REFUND_BATCH zwrotów na wywołanie', async () => {
  const claims = Array.from({ length: REFUND_BATCH + 5 }, (_, i) => order(i));
  const { calls, fetch } = mockFetch({ claims });
  const body = await (await handle(request(), { fetch, config: CONFIG, log: () => {} })).json();
  assert(body.refunds.requested === REFUND_BATCH, JSON.stringify(body.refunds));
  assert(all(calls, '/refunds').length === REFUND_BATCH, 'partia');
});

Deno.test('§7: zadanie cykliczne (sekret wywołania) — tylko dokończenie zwrotów, aktor null, bez odwołania', async () => {
  const { calls, fetch } = mockFetch({ claims: [order(1), order(2)], refunds: [{ status: 400, body: {} }] });
  const response = await handle(
    new Request('http://localhost/event-cancel', { method: 'POST', headers: { Authorization: `Bearer ${INVOKE}` }, body: '{}' }),
    { fetch, config: CONFIG, log: () => {} },
  );
  const body = await response.json();
  assert(response.status === 200 && body.refunds.requested === 1 && body.refunds.failed === 1, JSON.stringify(body));
  assert(all(calls, '/auth/v1/user').length === 0 && all(calls, 'cancel_calendar_event').length === 0, 'bez JWT i odwołania');
  const revert = all(calls, '/rpc/revert_order_refund')[0];
  assert(String(revert.init.body) === JSON.stringify({ p_order_id: order(1).id, p_actor_id: null }), String(revert.init.body));
});

Deno.test('AC-23, AC-29: odmowy bazy → kody HTTP, bez zwrotów', async () => {
  const cases: [string, number][] = [
    ['forbidden', 403],
    ['event_not_found', 404],
    ['invalid_cancel_reason', 400],
    ['event_already_cancelled', 409],
    ['event_not_published', 409],
    ['event_ended', 409],
  ];
  for (const [code, status] of cases) {
    const { calls, fetch } = mockFetch({ cancel: { status: 400, body: { message: code } }, claims: [order(1)] });
    const response = await handle(request(), { fetch, config: CONFIG, log: () => {} });
    assert(response.status === status, `${code}: ${response.status}`);
    assert((await response.json()).error === code, code);
    assert(all(calls, 'event_refund_claim').length === 0, `${code}: bez zwrotów`);
  }
});

Deno.test('AC-23: walidacja — powód 3–200 znaków, poprawne id; bez JWT — 401; tylko POST; brak konfiguracji — 500', async () => {
  const { calls, fetch } = mockFetch();
  for (const body of [{ event_id: EVENT, reason: ' ab ' }, { event_id: EVENT, reason: 'x'.repeat(201) }, { event_id: 'x', reason: 'Powód' }, {}]) {
    const response = await handle(request(body), { fetch, config: CONFIG, log: () => {} });
    assert(response.status === 400, `walidacja ${JSON.stringify(body)}: ${response.status}`);
  }
  assert(calls.length === 0, 'bez wywołań przy błędnym żądaniu');
  const noAuth = await handle(request(undefined, ''), { fetch, config: CONFIG, log: () => {} });
  assert(noAuth.status === 401, `bez JWT: ${noAuth.status}`);
  const badUser = mockFetch({ user: 401 });
  const unauthorized = await handle(request(), { fetch: badUser.fetch, config: CONFIG, log: () => {} });
  assert(unauthorized.status === 401 && all(badUser.calls, 'cancel_calendar_event').length === 0, 'nieważny JWT');
  const get = await handle(new Request('http://localhost/event-cancel'), { fetch, config: CONFIG });
  assert(get.status === 405, `GET: ${get.status}`);
  const missing = await handle(request(), { fetch, config: { ...CONFIG, tpayClientSecret: undefined }, log: () => {} });
  assert(missing.status === 500, `konfiguracja: ${missing.status}`);
});
