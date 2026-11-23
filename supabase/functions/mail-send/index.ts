import { handle } from './handler.ts';
import { createSmtpMailer } from './smtp.ts';

/** Klucz secret: `SUPABASE_SECRET_KEY` albo domyślny klucz z `SUPABASE_SECRET_KEYS` (JSON ustawiany przez Supabase). */
function secretKey(): string | undefined {
  const single = Deno.env.get('SUPABASE_SECRET_KEY');
  if (single) return single;
  try {
    return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
  } catch {
    return undefined;
  }
}

// SUPABASE_URL i klucze secret ustawia Supabase; pozostałe sekrety — właściciel (#166, ADR-0009).
Deno.serve((request) =>
  handle(request, {
    fetch,
    createMailer: createSmtpMailer,
    config: {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      secretKey: secretKey(),
      invokeSecret: Deno.env.get('MAIL_INVOKE_SECRET'),
      mailFrom: Deno.env.get('MAIL_FROM'),
      siteUrl: Deno.env.get('SITE_URL'),
      smtpHost: Deno.env.get('SMTP_HOST'),
      smtpPort: Deno.env.get('SMTP_PORT'),
      smtpUser: Deno.env.get('SMTP_USER'),
      smtpPassword: Deno.env.get('SMTP_PASSWORD'),
    },
  })
);
