/**
 * Edge Function `site-rebuild` (SPEC-001 §8, AC-29, AC-30, ADR-0003).
 * Sprawdza, czy wywołujący jest organizatorem (`is_organizer()` z jego JWT — to samo źródło co RLS),
 * i uruchamia workflow `rebuild-site.yml` dla środowiska z sekretu `SITE_ENV`.
 * Token GitHub (`GITHUB_DISPATCH_TOKEN`) nigdy nie trafia do logów ani odpowiedzi.
 */

export const REPO = 'rkazmier/sv-competitions';
export const WORKFLOW = 'rebuild-site.yml';
export const TARGETS = ['staging', 'production'] as const;

export interface Config {
  supabaseUrl?: string;
  supabaseKey?: string;
  githubToken?: string;
  siteEnv?: string;
}

export interface Deps {
  fetch: typeof fetch;
  config: Config;
  log?: (message: string) => void;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** `is_organizer()` wywołane z JWT użytkownika; każdy błąd (brak/nieważny token) = brak uprawnień. */
async function isOrganizer(authorization: string, deps: Deps): Promise<boolean> {
  const { supabaseUrl, supabaseKey } = deps.config;
  if (!supabaseUrl || !supabaseKey) return false;
  try {
    const response = await deps.fetch(`${supabaseUrl}/rest/v1/rpc/is_organizer`, {
      method: 'POST',
      headers: { apikey: supabaseKey, Authorization: authorization, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return response.ok && (await response.json()) === true;
  } catch {
    return false;
  }
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer \S+$/.test(authorization) || !(await isOrganizer(authorization, deps))) {
    return json(403, { error: 'forbidden' });
  }

  const { githubToken, siteEnv } = deps.config;
  const target = TARGETS.find((value) => value === siteEnv);
  if (!githubToken || !target) {
    log('site-rebuild: brak konfiguracji (GITHUB_DISPATCH_TOKEN lub SITE_ENV)');
    return json(500, { error: 'not_configured' });
  }

  try {
    const response = await deps.fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'sv-competitions-site-rebuild',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { target } }),
      },
    );
    await response.body?.cancel();
    if (!response.ok) {
      log(`site-rebuild: GitHub API odpowiedziało ${response.status}`);
      return json(502, { error: 'dispatch_failed' });
    }
  } catch {
    log('site-rebuild: błąd połączenia z GitHub API');
    return json(502, { error: 'dispatch_failed' });
  }
  return json(202, { ok: true, target });
}
