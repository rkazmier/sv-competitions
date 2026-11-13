interface ImportMetaEnv {
  readonly PUBLIC_SITE_URL?: string;
  readonly PUBLIC_SUPABASE_URL?: string;
  /** Klucz publishable (`sb_publishable_…`) */
  readonly PUBLIC_SUPABASE_ANON_KEY?: string;
  /** `staging` / `production` w workflowach wdrożenia; puste lokalnie i w CI */
  readonly PUBLIC_APP_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
