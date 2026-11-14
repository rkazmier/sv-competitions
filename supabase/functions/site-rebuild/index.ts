import { handle } from './handler.ts';

// SUPABASE_URL i SUPABASE_ANON_KEY ustawia Supabase; GITHUB_DISPATCH_TOKEN i SITE_ENV — właściciel (owner-task #13).
Deno.serve((request) =>
  handle(request, {
    fetch,
    config: {
      supabaseUrl: Deno.env.get('SUPABASE_URL'),
      supabaseKey: Deno.env.get('SUPABASE_ANON_KEY'),
      githubToken: Deno.env.get('GITHUB_DISPATCH_TOKEN'),
      siteEnv: Deno.env.get('SITE_ENV'),
    },
  }),
);
