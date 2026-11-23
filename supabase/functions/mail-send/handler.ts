/**
 * Edge Function `mail-send` (SPEC-012 US-3: AC-9…AC-12, §8; ADR-0009). Wysyła e-maile z kolejki `email_outbox`.
 * Wywołują ją: `payments-notify` po realizacji zamówienia, `pg_cron` `mail-send-retry` co 10 min (`invoke_mail_send()`)
 * i „Wyślij ponownie” w panelu — zawsze POST z `Authorization: Bearer <MAIL_INVOKE_SECRET>` (bez JWT).
 * 1. bez `SMTP_HOST` (lokalnie, CI, staging bez sekretów) → `503 mail_not_configured`, wpisy czekają;
 * 2. `rpc/mail_outbox_claim` (klucz secret) — wpisy do wysłania z danymi zamówienia i adresem konta (bez konta → `skipped` w bazie);
 * 3. `order_paid`: PDF regulaminu (`terms_version`) z `SITE_URL` — bez załącznika e-mail nie wychodzi (AC-11);
 *    `event_cancelled` (AC-27): bez załącznika;
 * 4. SMTP (TLS, port 465), potem `rpc/mail_outbox_result` — `sent` albo kod błędu (ponowienia z odstępem liczy baza).
 * Logi i `last_error`: tylko rodzaj, id wpisu i kod błędu — bez adresu i treści (§8, §9).
 */
import { eventCancelledEmail, type OutboxRow, orderPaidEmail, termsPdfName } from './templates.ts';
import { t } from './i18n.ts';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface Config {
  supabaseUrl?: string;
  /** Klucz secret — RPC kolejki tylko dla `service_role`. */
  secretKey?: string;
  /** Sekret wywołania (`MAIL_INVOKE_SECRET`, ten sam w Vault jako `mail_invoke_secret`). */
  invokeSecret?: string;
  mailFrom?: string;
  siteUrl?: string;
  smtpHost?: string;
  smtpPort?: string;
  smtpUser?: string;
  smtpPassword?: string;
}

export interface Attachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

export interface Mail {
  from: { name: string; address: string };
  replyTo: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: Attachment[];
}

/** Klient SMTP (w testach podstawiony). */
export interface Mailer {
  send(mail: Mail): Promise<void>;
  close(): Promise<void> | void;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  createMailer: (smtp: SmtpConfig) => Mailer;
  log?: (message: string) => void;
}

/** Wpisy pobierane naraz i maksymalna liczba partii w jednym wywołaniu (limit czasu Edge Function). */
export const BATCH = 20;
export const MAX_BATCHES = 5;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Porównanie w stałym czasie (jak `retention`, ADR-0006). */
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Błąd wysyłki wpisu z kodem do `last_error` (bez adresu i treści). */
class MailError extends Error {}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const c = deps.config;
  if (!c.supabaseUrl || !c.secretKey || !c.invokeSecret) {
    log('mail-send: brak konfiguracji (SUPABASE_URL, klucz secret lub MAIL_INVOKE_SECRET)');
    return json(500, { error: 'not_configured' });
  }
  if (!safeEqual(request.headers.get('Authorization') ?? '', `Bearer ${c.invokeSecret}`)) {
    return json(401, { error: 'unauthorized' });
  }
  const port = Number(c.smtpPort || '465');
  if (!c.smtpHost || !c.smtpUser || !c.smtpPassword || !c.mailFrom || !c.siteUrl || !Number.isInteger(port)) {
    log('mail-send: poczta nieskonfigurowana (SMTP_*, MAIL_FROM, SITE_URL) — wpisy czekają w kolejce');
    return json(503, { error: 'mail_not_configured' });
  }
  const siteUrl = c.siteUrl.replace(/\/+$/, '');
  const mailFrom = c.mailFrom;
  const headers = { apikey: c.secretKey, Authorization: `Bearer ${c.secretKey}`, 'Content-Type': 'application/json' };

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const response = await deps.fetch(`${c.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`${name}: odpowiedź ${response.status}`);
    }
    return (await response.json()) as T;
  }

  // PDF każdej wersji pobierany raz na wywołanie.
  const pdfs = new Map<string, Promise<Uint8Array>>();
  function termsPdf(version: string): Promise<Uint8Array> {
    if (!pdfs.has(version)) {
      pdfs.set(version, (async () => {
        let response: Response;
        try {
          response = await deps.fetch(`${siteUrl}/regulamin-sprzedazy/${termsPdfName(version)}`);
        } catch {
          throw new MailError('pdf_unavailable');
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new MailError('pdf_unavailable');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!PDF_MAGIC.every((byte, i) => bytes[i] === byte)) throw new MailError('pdf_invalid');
        return bytes;
      })());
    }
    return pdfs.get(version)!;
  }

  async function compose(row: OutboxRow): Promise<Mail> {
    if (row.kind !== 'order_paid' && row.kind !== 'event_cancelled') throw new MailError('unsupported_kind');
    if (!row.email) throw new MailError('no_recipient');
    const from = { name: t('email.senderName'), address: mailFrom };
    // SPEC-012 AC-27: e-mail o odwołaniu wydarzenia — bez załącznika (regulamin dołączamy tylko do potwierdzenia zamówienia).
    if (row.kind === 'event_cancelled') {
      return { from, replyTo: mailFrom, to: row.email, ...eventCancelledEmail(row), attachments: [] };
    }
    if (!row.terms_version) throw new MailError('no_terms_version');
    const pdf = await termsPdf(row.terms_version);
    const content = orderPaidEmail(row, siteUrl);
    return {
      from,
      replyTo: mailFrom,
      to: row.email,
      ...content,
      attachments: [{ filename: termsPdfName(row.terms_version), content: pdf, contentType: 'application/pdf' }],
    };
  }

  const result = { sent: 0, retry: 0, failed: 0 };
  let mailer: Mailer | null = null;
  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const rows = await rpc<OutboxRow[]>('mail_outbox_claim', { p_limit: BATCH });
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        let error: string | null = null;
        try {
          const mail = await compose(row);
          mailer ??= deps.createMailer({ host: c.smtpHost, port, user: c.smtpUser, password: c.smtpPassword });
          try {
            await mailer.send(mail);
          } catch {
            throw new MailError('smtp_error');
          }
        } catch (e) {
          error = e instanceof MailError ? e.message : 'unexpected_error';
        }
        const state = await rpc<string>('mail_outbox_result', { p_id: row.id, p_error: error });
        if (state === 'sent') result.sent++;
        else if (state === 'failed') result.failed++;
        else result.retry++;
        log(`mail-send: ${row.kind} ${row.id} — ${error ?? 'sent'}${error ? ` (${state})` : ''}`);
      }
      if (rows.length < BATCH) break;
    }
  } catch (e) {
    log(`mail-send: ${e instanceof Error && !(e instanceof MailError) ? e.message.slice(0, 100) : 'nieoczekiwany błąd'}`);
    return json(500, { error: 'mail_send_failed', ...result });
  } finally {
    try {
      await mailer?.close();
    } catch {
      // zamknięcie połączenia nie wpływa na wynik
    }
  }
  return json(200, result);
}
