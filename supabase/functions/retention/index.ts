import { handle } from './handler.ts';

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

// SUPABASE_URL i klucze secret ustawia Supabase; RETENTION_INVOKE_SECRET — właściciel (ten sam co w Vault, ADR-0006).
Deno.serve((request) =>
  handle(request, {
    fetch,
    config: {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      secretKey: secretKey(),
      invokeSecret: Deno.env.get('RETENTION_INVOKE_SECRET'),
    },
  })
);
