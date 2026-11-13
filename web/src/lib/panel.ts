/**
 * Bramka panelu organizatora (SPEC-001 US-2, AC-4, AC-5). Działa w przeglądarce.
 *
 * Stany (elementy `[data-panel-state]` w PanelLayout):
 * - `signedOut` — przycisk „Zaloguj się przez Google”, powrót do `/panel/` (AC-4),
 * - `forbidden` — konto bez roli `organizer`: komunikat i „Wyloguj się”, bez pobierania danych (AC-5),
 * - `organizer` — treść strony i menu panelu,
 * - `error` — błąd sieci przy sprawdzaniu roli.
 *
 * Rola z `profiles` (to samo źródło co RLS — `is_organizer()`), nie z claimu JWT.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export type PanelState = 'loading' | 'signedOut' | 'forbidden' | 'organizer' | 'error';

/** Strona startowa panelu — tu wraca logowanie Google. */
export const PANEL_HOME = '/panel/';

export async function resolvePanelState(supabase: SupabaseClient): Promise<PanelState> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return 'error';
  const session = sessionData.session;
  if (!session) return 'signedOut';
  const { data, error } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
  if (error) return 'error';
  return data?.role === 'organizer' ? 'organizer' : 'forbidden';
}

function show(state: PanelState): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-panel-state]')) {
    element.hidden = element.dataset.panelState !== state;
  }
  for (const menu of document.querySelectorAll<HTMLElement>('[data-panel-menu]')) {
    menu.hidden = state !== 'organizer';
  }
}

function bindButtons(supabase: SupabaseClient): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sign-in]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: new URL(PANEL_HOME, window.location.origin).href },
      });
      if (error) {
        button.disabled = false;
        show('error');
      }
    });
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sign-out]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      await supabase.auth.signOut();
      window.location.assign(PANEL_HOME);
    });
  }
}

let ready: Promise<SupabaseClient> | undefined;

/**
 * Uruchamia bramkę (raz na stronę) i zwraca klienta tylko organizatorowi.
 * Dla pozostałych stanów obietnica się nie spełnia — strona nie pobiera danych.
 */
export function requireOrganizer(): Promise<SupabaseClient> {
  ready ??= (async () => {
    let supabase: SupabaseClient;
    try {
      supabase = getSupabase();
    } catch {
      show('error');
      return new Promise<never>(() => {});
    }
    bindButtons(supabase);
    const state = await resolvePanelState(supabase).catch((): PanelState => 'error');
    show(state);
    if (state !== 'organizer') return new Promise<never>(() => {});
    return supabase;
  })();
  return ready;
}

/** Pokazuje stan błędu wczytywania (np. gdy zapytanie strony się nie powiodło). */
export function showLoadError(): void {
  show('error');
}
