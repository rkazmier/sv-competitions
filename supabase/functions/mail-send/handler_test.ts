// Testy Deno: `deno test supabase/functions/` (SPEC-012 AC-9…AC-12, §8; ADR-0009). Klient SMTP podstawiony.
import { BATCH, type Config, handle, type Mail, type Mailer } from './handler.ts';
import { formatDayRange, type OutboxRow } from './templates.ts';

const SECRET = 'sb_secret_SECRET_VALUE';
const INVOKE = 'mail-invoke-secret';
const PASSWORD = 'smtp-password-value';
const CONFIG: Config = {
  supabaseUrl: 'https://project.supabase.co',
  secretKey: SECRET,
  invokeSecret: INVOKE,
  mailFrom: 'sklep@steel-valley.pl',
  siteUrl: 'https://events.steel-valley.pl/',
  smtpHost: 'smtp.steel-valley.pl',
  smtpPort: '465',
  smtpUser: 'sklep@steel-valley.pl',
  smtpPassword: PASSWORD,
};
const PDF = new TextEncoder().encode('%PDF-1.7 regulamin');

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ROW: OutboxRow = {
  id: '11111111-0000-0000-0000-000000000001',
  kind: 'order_paid',
  attempts: 0,
  order_id: '22222222-0000-0000-0000-000000000001',
  order_number: 'SV-2027-000123',
  item_name: 'Karnet 10 wejść',
  amount: 12000,
  paid_at: '2027-01-02T13:05:00Z',
  terms_version: '2027-01-01',
  early_performance_consent_at: '2027-01-02T13:04:00Z',
  pass_kind: 'entries',
  expires_on: '2028-01-02',
  event_starts_on: null,
  event_ends_on: null,
  email: 'klient@example.test',
};

interface Mock {
  batches?: OutboxRow[][];
  pdfStatus?: number;
  pdfBody?: Uint8Array;
  claimStatus?: number;
  /** Stan zwracany przez `mail_outbox_result` dla błędu. */
  errorState?: string;
}

function mockFetch({ batches = [], pdfStatus = 200, pdfBody = PDF, claimStatus = 200, errorState = 'pending' }: Mock = {}) {
  const results: { p_id: string; p_error: string | null }[] = [];
  const urls: string[] = [];
  let batch = 0;
  const fetch = (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/rest/v1/rpc/mail_outbox_claim')) {
      const headers = init.headers as Record<string, string>;
      assert(headers.Authorization === `Bearer ${SECRET}`, 'claim kluczem secret');
      return Promise.resolve(new Response(JSON.stringify(batches[batch++] ?? []), { status: claimStatus }));
    }
    if (url.endsWith('/rest/v1/rpc/mail_outbox_result')) {
      const body = JSON.parse(String(init.body));
      results.push(body);
      return Promise.resolve(new Response(JSON.stringify(body.p_error === null ? 'sent' : errorState)));
    }
    if (url.includes('/regulamin-sprzedazy/')) {
      return Promise.resolve(new Response(pdfStatus === 200 ? new Blob([pdfBody as Uint8Array<ArrayBuffer>]) : 'Not found', { status: pdfStatus }));
    }
    return Promise.resolve(new Response('unexpected', { status: 500 }));
  };
  return { results, urls, fetch: fetch as typeof globalThis.fetch };
}

function mockMailer(fail = false) {
  const sent: Mail[] = [];
  let created = 0;
  let closed = 0;
  const createMailer = (): Mailer => {
    created++;
    return {
      send(mail) {
        if (fail) return Promise.reject(new Error(`SMTP 550 ${mail.to}`));
        sent.push(mail);
        return Promise.resolve();
      },
      close() {
        closed++;
      },
    };
  };
  return { sent, createMailer, stats: () => ({ created, closed }) };
}

const post = (authorization: string | null = `Bearer ${INVOKE}`) =>
  new Request('http://localhost/mail-send', {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : {},
    body: '{}',
  });

Deno.test('ADR-0009: bez sekretu wywołania — 401, nic nie jest wysyłane', async () => {
  for (const authorization of [null, 'Bearer zly', INVOKE, `Bearer ${SECRET}`]) {
    const { urls, fetch } = mockFetch({ batches: [[ROW]] });
    const mailer = mockMailer();
    const response = await handle(post(authorization), { fetch, config: CONFIG, createMailer: mailer.createMailer, log: () => {} });
    assert(response.status === 401, `status ${response.status}`);
    assert(urls.length === 0 && mailer.sent.length === 0, 'bez wywołań');
  }
});

Deno.test('ADR-0009: tylko POST; brak MAIL_INVOKE_SECRET — 500', async () => {
  const { fetch } = mockFetch();
  const { createMailer } = mockMailer();
  const get = await handle(new Request('http://localhost/mail-send'), { fetch, config: CONFIG, createMailer });
  assert(get.status === 405, `status ${get.status}`);
  const missing = await handle(post(), { fetch, config: { ...CONFIG, invokeSecret: undefined }, createMailer, log: () => {} });
  assert(missing.status === 500, `status ${missing.status}`);
});

Deno.test('§8: bez SMTP_HOST — 503 mail_not_configured, kolejka nietknięta', async () => {
  const { urls, fetch } = mockFetch({ batches: [[ROW]] });
  const { createMailer } = mockMailer();
  const response = await handle(post(), { fetch, config: { ...CONFIG, smtpHost: undefined }, createMailer, log: () => {} });
  assert(response.status === 503, `status ${response.status}`);
  assert((await response.json()).error === 'mail_not_configured', 'kod błędu');
  assert(urls.length === 0, 'bez claim — wpisy zostają pending');
});

Deno.test('AC-10: potwierdzenie zamówienia z PDF regulaminu, nadawca MAIL_FROM, link do /konto/', async () => {
  const { results, urls, fetch } = mockFetch({ batches: [[ROW]] });
  const mailer = mockMailer();
  const logs: string[] = [];
  const response = await handle(post(), { fetch, config: CONFIG, createMailer: mailer.createMailer, log: (m) => logs.push(m) });
  assert(response.status === 200, `status ${response.status}`);
  assert((await response.json()).sent === 1, 'sent = 1');
  assert(mailer.sent.length === 1, 'jeden e-mail');
  const mail = mailer.sent[0];
  assert(mail.to === 'klient@example.test', 'adres z auth.users (claim)');
  assert(mail.from.address === CONFIG.mailFrom && mail.from.name === 'Steel Valley', 'nadawca');
  assert(mail.replyTo === CONFIG.mailFrom, 'Reply-To = MAIL_FROM');
  assert(mail.subject === 'Potwierdzenie zamówienia SV-2027-000123 — Steel Valley', mail.subject);
  for (
    const expected of [
      'SV-2027-000123',
      'Karnet 10 wejść',
      '120,00 zł',
      'Data zakupu: 2.01.2027 14:05',
      'Ważny do 2.01.2028',
      'Chcę korzystać z karnetu przed upływem 14 dni na odstąpienie od umowy.',
      '(złożona 2.01.2027 14:04)',
      'W załączniku regulamin sprzedaży obowiązujący od 1.01.2027, zaakceptowany przy zakupie.',
      'https://events.steel-valley.pl/konto/',
    ]
  ) {
    assert(mail.text.includes(expected), `tekst: ${expected}`);
    assert(mail.html.includes(expected), `HTML: ${expected}`);
  }
  assert(mail.attachments.length === 1, 'załącznik');
  assert(mail.attachments[0].filename === 'regulamin-sprzedazy-2027-01-01.pdf', mail.attachments[0].filename);
  assert(mail.attachments[0].contentType === 'application/pdf', 'PDF');
  assert(urls.includes('https://events.steel-valley.pl/regulamin-sprzedazy/regulamin-sprzedazy-2027-01-01.pdf'), 'PDF z SITE_URL');
  assert(results.length === 1 && results[0].p_error === null, 'wynik sent');
  assert(mailer.stats().closed === 1, 'połączenie zamknięte');
  const logged = logs.join('\n');
  assert(!logged.includes('klient@example.test') && !logged.includes(PASSWORD) && !logged.includes('Karnet'), 'log bez adresu i treści');
});

Deno.test('AC-10: wejściówka — „Ważna w dniach wydarzenia”, bez zgody', async () => {
  const ticket: OutboxRow = {
    ...ROW,
    item_name: 'Wejściówka: Zawody <IPSC>',
    pass_kind: 'event_ticket',
    event_starts_on: '2027-03-14',
    event_ends_on: '2027-03-15',
    early_performance_consent_at: null,
  };
  const { fetch } = mockFetch({ batches: [[ticket]] });
  const mailer = mockMailer();
  await handle(post(), { fetch, config: CONFIG, createMailer: mailer.createMailer, log: () => {} });
  const mail = mailer.sent[0];
  assert(mail.text.includes('Ważna w dniach wydarzenia: 14–15.03.2027'), mail.text);
  assert(!mail.text.includes('Ważny do') && !mail.text.includes('Zgoda'), 'bez ważności karnetu i zgody');
  assert(mail.html.includes('Zawody &lt;IPSC&gt;') && !mail.html.includes('<IPSC>'), 'HTML escapowany');
});

Deno.test('AC-10: zakres dni wydarzenia', () => {
  assert(formatDayRange('2027-03-14', null) === '14.03.2027', 'jeden dzień');
  assert(formatDayRange('2027-03-31', '2027-04-01') === '31.03–1.04.2027', 'różne miesiące');
  assert(formatDayRange('2027-12-31', '2028-01-01') === '31.12.2027–1.01.2028', 'różne lata');
});

Deno.test('AC-11: brak PDF — e-mail nie wychodzi bez załącznika, wpis do ponowienia', async () => {
  for (const mock of [{ pdfStatus: 404 }, { pdfBody: new TextEncoder().encode('<html>404</html>') }]) {
    const { results, fetch } = mockFetch({ batches: [[ROW]], ...mock });
    const mailer = mockMailer();
    const response = await handle(post(), { fetch, config: CONFIG, createMailer: mailer.createMailer, log: () => {} });
    assert(response.status === 200, `status ${response.status}`);
    assert(mailer.sent.length === 0, 'nic nie wysłano');
    assert(['pdf_unavailable', 'pdf_invalid'].includes(results[0].p_error ?? ''), `kod ${results[0].p_error}`);
    assert((await response.json()).retry === 1, 'retry');
  }
});

Deno.test('AC-11: błąd SMTP — kod smtp_error bez adresu, po 5. próbie failed', async () => {
  const { results, fetch } = mockFetch({ batches: [[ROW]], errorState: 'failed' });
  const mailer = mockMailer(true);
  const logs: string[] = [];
  const response = await handle(post(), { fetch, config: CONFIG, createMailer: mailer.createMailer, log: (m) => logs.push(m) });
  assert(response.status === 200, `status ${response.status}`);
  assert(results[0].p_error === 'smtp_error', `kod ${results[0].p_error}`);
  assert((await response.json()).failed === 1, 'failed');
  assert(!logs.join('\n').includes('klient@example.test'), 'log bez adresu');
});

Deno.test('AC-9: wpisy w partiach, PDF pobierany raz na wersję', async () => {
  const full = Array.from({ length: BATCH }, (_, i) => ({ ...ROW, id: `11111111-0000-0000-0000-${String(i).padStart(12, '0')}` }));
  const { urls, results, fetch } = mockFetch({ batches: [full, [ROW]] });
  const mailer = mockMailer();
  const response = await handle(post(), { fetch, config: CONFIG, createMailer: mailer.createMailer, log: () => {} });
  assert((await response.json()).sent === BATCH + 1, 'wszystkie wysłane');
  assert(results.length === BATCH + 1, 'wynik dla każdego wpisu');
  assert(urls.filter((url) => url.includes('/regulamin-sprzedazy/')).length === 1, 'PDF raz');
  assert(mailer.stats().created === 1, 'jedno połączenie SMTP');
});

Deno.test('AC-12: brak adresu — bez wysyłki (konto bez e-maila)', async () => {
  const { results, fetch } = mockFetch({ batches: [[{ ...ROW, email: null }]] });
  const mailer = mockMailer();
  await handle(post(), { fetch, config: CONFIG, createMailer: mailer.createMailer, log: () => {} });
  assert(mailer.sent.length === 0, 'nic nie wysłano');
  assert(results[0].p_error === 'no_recipient', `kod ${results[0].p_error}`);
});

Deno.test('ADR-0009: błąd bazy — 500, bez wysyłki', async () => {
  const { fetch } = mockFetch({ batches: [[ROW]], claimStatus: 500 });
  const mailer = mockMailer();
  const response = await handle(post(), { fetch, config: CONFIG, createMailer: mailer.createMailer, log: () => {} });
  assert(response.status === 500, `status ${response.status}`);
  assert(mailer.sent.length === 0, 'nic nie wysłano');
});
