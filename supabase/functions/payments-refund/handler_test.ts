// Testy Deno: `deno test supabase/functions/` (SPEC-003 AC-25…AC-27).
import { type Config, handle } from './handler.ts';

const SECRET = 'sb_secret_SECRET_VALUE';
const TPAY_SECRET = 'TPAY_CLIENT_SECRET_VALUE';
const CONFIG: Config = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseKey: 'sb_publishable_test',
  secretKey: SECRET,
  tpayApiUrl: 'https://openapi.sandbox.tpay.com',
  tpayClientId: 'client-id',
  tpayClientSecret: TPAY_SECRET,
};
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const ORDER = '00000000-0000-0000-0000-00000000d001';
const JWT = 'Bearer admin.jwt.token';

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
  refund?: { status: number; body: unknown } | 'network';
}

/** Zamockowany fetch: Auth, `cancel_order`, odczyt zamówienia, `revert_order_refund`, OAuth i zwrot Tpay. */
function mockFetch({ user = 200, cancel = { status: 200, body: 'refund_pending' }, refund }: Mock = {}) {
  const calls: Call[] = [];
  const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/auth/v1/user')) return reply(user, user === 200 ? { id: ADMIN, email: 'admin@example.test' } : {});
    if (url.endsWith('/rpc/cancel_order')) return reply(cancel.status, cancel.body);
    if (url.includes('/rest/v1/orders?')) return reply(200, [{ tpay_transaction_id: '01TPAY/TX' }]);
    if (url.endsWith('/rpc/revert_order_refund')) return reply(200, true);
    if (url.endsWith('/oauth/auth')) return reply(200, { access_token: 'tpay-token' });
    if (url.includes('/refunds')) {
      if (refund === 'network') return Promise.reject(new TypeError('network'));
      const r = refund ?? { status: 200, body: { result: 'success', status: 'correct' } };
      return reply(r.status, r.body);
    }
    return reply(500, 'unexpected');
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

function request(body: unknown = { order_id: ORDER }, authorization = JWT) {
  return new Request('http://localhost/payments-refund', {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const find = (calls: Call[], suffix: string) => calls.find((call) => call.url.includes(suffix));

Deno.test('AC-25: zamówienie Tpay — cancel_order z JWT admina, zwrot pełnej kwoty w Tpay, refund_pending', async () => {
  const logs: string[] = [];
  const { calls, fetch } = mockFetch();
  const response = await handle(request({ order_id: ORDER, refund_note: ' Na prośbę klienta ' }), {
    fetch,
    config: CONFIG,
    log: (m) => logs.push(m),
  });
  assert(response.status === 200, `status ${response.status}`);
  assert((await response.json()).status === 'refund_pending', 'stan');
  const cancel = find(calls, '/rpc/cancel_order')!;
  assert(new Headers(cancel.init.headers).get('Authorization') === JWT, 'cancel_order z JWT wywołującego (rola w bazie)');
  assert(JSON.stringify(JSON.parse(String(cancel.init.body))) ===
    JSON.stringify({ p_order_id: ORDER, p_refund_note: 'Na prośbę klienta' }), String(cancel.init.body));
  const order = find(calls, '/rest/v1/orders?')!;
  assert(new Headers(order.init.headers).get('Authorization') === `Bearer ${SECRET}`, 'odczyt transakcji kluczem secret');
  const refund = find(calls, '/refunds')!;
  assert(refund.url === 'https://openapi.sandbox.tpay.com/transactions/01TPAY%2FTX/refunds', refund.url);
  assert(new Headers(refund.init.headers).get('Authorization') === 'Bearer tpay-token', 'token OAuth');
  assert(String(refund.init.body) === '{}', 'bez kwoty = zwrot pełnej kwoty');
  assert(!find(calls, '/rpc/revert_order_refund'), 'bez cofania');
  assert(!logs.join().includes(SECRET) && !logs.join().includes(TPAY_SECRET), logs.join());
});

Deno.test('AC-25: zamówienie „na miejscu” — od razu refunded, bez Tpay', async () => {
  const { calls, fetch } = mockFetch({ cancel: { status: 200, body: 'refunded' } });
  const response = await handle(request(), { fetch, config: CONFIG, log: () => {} });
  assert(response.status === 200 && (await response.json()).status === 'refunded', `status ${response.status}`);
  assert(!find(calls, 'tpay.com'), 'bez wywołań Tpay');
});

Deno.test('AC-25: Tpay odrzucił zwrot albo nie odpowiedział — revert_order_refund kluczem secret, 502', async () => {
  const cases: Mock['refund'][] = [{ status: 400, body: { result: 'failed' } }, { status: 200, body: { result: 'failed' } }, 'network'];
  for (const refund of cases) {
    const { calls, fetch } = mockFetch({ refund });
    const response = await handle(request(), { fetch, config: CONFIG, log: () => {} });
    assert(response.status === 502 && (await response.json()).error === 'refund_failed', `status ${response.status}`);
    const revert = find(calls, '/rpc/revert_order_refund')!;
    assert(new Headers(revert.init.headers).get('Authorization') === `Bearer ${SECRET}`, 'klucz secret');
    const args = JSON.parse(String(revert.init.body));
    assert(args.p_order_id === ORDER && args.p_actor_id === ADMIN, 'AC-27: kto cofnął');
  }
});

Deno.test('AC-26: odmowy bazy (pass_used, order_not_paid, forbidden, order_not_found) — bez Tpay', async () => {
  const cases = [['pass_used', 409], ['order_not_paid', 409], ['forbidden', 403], ['order_not_found', 404]] as const;
  for (const [code, status] of cases) {
    const { calls, fetch } = mockFetch({ cancel: { status: 400, body: { code: 'P0001', message: code } } });
    const response = await handle(request(), { fetch, config: CONFIG, log: () => {} });
    assert(response.status === status && (await response.json()).error === code, `${code}: ${response.status}`);
    assert(!find(calls, 'tpay.com'), 'bez wywołań Tpay');
  }
});

Deno.test('AC-25: brak sesji, zły JWT, złe body, brak konfiguracji — bez zmian w bazie', async () => {
  const run = async (req: Request, mock: Mock = {}, config: Config = CONFIG) => {
    const { calls, fetch } = mockFetch(mock);
    const response = await handle(req, { fetch, config, log: () => {} });
    assert(!find(calls, '/rpc/cancel_order'), 'bez cancel_order');
    return response.status;
  };
  assert(await run(request({ order_id: ORDER }, '')) === 401, 'bez nagłówka');
  assert(await run(request(), { user: 401 }) === 401, 'zły JWT');
  assert(await run(request({ order_id: 'abc' })) === 400, 'zły order_id');
  assert(await run(request({ order_id: ORDER, refund_note: 'x'.repeat(301) })) === 400, 'za długa notatka');
  assert(await run(request(), {}, { ...CONFIG, tpayClientSecret: undefined }) === 500, 'brak konfiguracji');
  const { fetch } = mockFetch();
  const get = await handle(new Request('http://localhost/payments-refund'), { fetch, config: CONFIG, log: () => {} });
  assert(get.status === 405, 'tylko POST');
});
