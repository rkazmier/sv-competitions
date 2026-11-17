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

// SUPABASE_URL, SUPABASE_ANON_KEY i klucze secret ustawia Supabase.
Deno.serve((request) =>
  handle(request, {
    fetch,
    config: {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      supabaseKey: Deno.env.get('SUPABASE_ANON_KEY'),
      secretKey: secretKey(),
    },
  }),
);
