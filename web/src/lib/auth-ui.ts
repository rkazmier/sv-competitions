/**
 * Wyspy stron logowania (SPEC-002 AC-1…AC-6): `/rejestracja/`, `/logowanie/`, `/logowanie/nowe-haslo/`, `/konto/`
 * oraz linki konta w nagłówku strony publicznej. Logika bez DOM: lib/auth.ts.
 *
 * Linki z e-maili Supabase (szablony w supabase/templates/) niosą `token_hash` — działa także na innym urządzeniu
 * niż to, na którym założono konto; domyślny link z `?code=` (PKCE) obsługuje sam klient Supabase.
 */
import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js';
import { t } from '../i18n';
import {
  ACCOUNT_HOME,
  LOGIN_PAGE,
  NEW_PASSWORD_PAGE,
  PASSWORD_MIN,
  afterSignInPath,
  safeNextPath,
  signInFailure,
  validateEmail,
  validateNewPassword,
  withNext,
  type FieldErrors,
} from './auth';
import { ACCOUNT_COLUMNS, renderAccount } from './account-ui';
import type { AccountProfile } from './profile';
import { getSupabase } from './supabase';

const nextParam = () => new URLSearchParams(window.location.search).get('next');
const safeNext = () => safeNextPath(nextParam(), window.location.origin);
const absolute = (path: string) => new URL(path, window.location.origin).href;
/** Powrót z Google i z linku potwierdzającego: `/konto/` (klauzula, potem `?next=`). */
const accountRedirect = () => absolute(withNext(ACCOUNT_HOME, safeNext()));

function client(): SupabaseClient | null {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

const field = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement;
const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string) => root.querySelector<T>(selector)!;

function showErrors(form: HTMLFormElement, errors: FieldErrors): boolean {
  for (const message of form.querySelectorAll<HTMLElement>('[data-error-for]')) {
    const name = message.dataset.errorFor as keyof FieldErrors;
    const code = errors[name];
    message.hidden = !code;
    message.textContent = code ? t(`auth.${code}`, { min: PASSWORD_MIN }) : '';
    field(form, name).setAttribute('aria-invalid', String(Boolean(code)));
  }
  const first = Object.keys(errors)[0];
  if (first) field(form, first).focus();
  return Boolean(first);
}

function showFormError(form: HTMLFormElement, text: string | null): void {
  const box = el(form, '[data-form-error]');
  box.hidden = !text;
  box.textContent = text ?? '';
}

const failureText = (error: { code?: string; status?: number } | null) => t(`auth.${signInFailure(error)}`);

function bindCommon(supabase: SupabaseClient | null): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[data-keep-next]')) {
    link.href = withNext(link.getAttribute('href')!, safeNext());
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-google]')) {
    button.addEventListener('click', async () => {
      if (!supabase) return;
      button.disabled = true;
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: accountRedirect() } });
      if (error) button.disabled = false;
    });
  }
}

/** Link z e-maila z `token_hash` → sesja; parametry znikają z paska adresu. */
async function verifyFromUrl(supabase: SupabaseClient): Promise<void> {
  const url = new URL(window.location.href);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  if (!tokenHash || !type) return;
  url.searchParams.delete('token_hash');
  url.searchParams.delete('type');
  window.history.replaceState(null, '', url.pathname + url.search);
  await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
}

/** `/rejestracja/` — AC-1, AC-2. */
export function mountRegister(): void {
  const supabase = client();
  bindCommon(supabase);
  const form = el<HTMLFormElement>(document, 'form[data-register]');
  const submit = el<HTMLButtonElement>(form, '[data-submit]');
  const ack = field(form, 'ack');
  const sync = () => (submit.disabled = !ack.checked);
  ack.addEventListener('change', sync);
  sync();
  el(form, '[data-open-notice]').addEventListener('click', (event) => {
    event.preventDefault();
    el<HTMLDialogElement>(document, 'dialog[data-notice]').showModal();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError(form, null);
    const email = field(form, 'email').value.trim();
    const password = field(form, 'password').value;
    const errors = { ...validateEmail(email), ...validateNewPassword(password, field(form, 'password2').value) };
    if (showErrors(form, errors) || !ack.checked) return;
    if (!supabase) return showFormError(form, t('auth.genericError'));
    submit.disabled = true;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      // Potwierdzenie klauzuli zapisuje wyzwalacz handle_new_user (privacy_notice_ack_at).
      options: { emailRedirectTo: accountRedirect(), data: { privacy_notice_ack: true } },
    });
    submit.disabled = false;
    if (error) return showFormError(form, failureText(error));
    form.hidden = true;
    el(document, '[data-done]').hidden = false;
  });
}

/** `/logowanie/` — AC-5, AC-6. */
export async function mountLogin(): Promise<void> {
  const supabase = client();
  bindCommon(supabase);
  const form = el<HTMLFormElement>(document, 'form[data-login]');
  const reset = el<HTMLFormElement>(document, 'form[data-reset]');
  const resend = el<HTMLButtonElement>(form, '[data-resend]');
  const forgot = el<HTMLButtonElement>(document, '[data-forgot]');
  const goNext = () => window.location.assign(afterSignInPath(nextParam(), window.location.origin));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError(form, null);
    resend.hidden = true;
    el(form, '[data-resent]').hidden = true;
    const email = field(form, 'email').value.trim();
    if (showErrors(form, validateEmail(email))) return;
    if (!supabase) return showFormError(form, t('auth.genericError'));
    const submit = el<HTMLButtonElement>(form, '[data-submit]');
    submit.disabled = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password: field(form, 'password').value });
    submit.disabled = false;
    if (!error) return goNext();
    showFormError(form, failureText(error));
    resend.hidden = signInFailure(error) !== 'emailNotConfirmed';
  });

  resend.addEventListener('click', async () => {
    resend.disabled = true;
    const email = field(form, 'email').value.trim();
    const { error } = await supabase!.auth.resend({ type: 'signup', email, options: { emailRedirectTo: accountRedirect() } });
    resend.disabled = false;
    if (error) return showFormError(form, failureText(error));
    resend.hidden = true;
    el(form, '[data-resent]').hidden = false;
  });

  forgot.addEventListener('click', () => {
    reset.hidden = !reset.hidden;
    forgot.setAttribute('aria-expanded', String(!reset.hidden));
    if (reset.hidden) return;
    field(reset, 'email').value ||= field(form, 'email').value;
    field(reset, 'email').focus();
  });

  reset.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError(reset, null);
    const email = field(reset, 'email').value.trim();
    if (showErrors(reset, validateEmail(email))) return;
    if (!supabase) return showFormError(reset, t('auth.genericError'));
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: absolute(NEW_PASSWORD_PAGE) });
    // Ten sam komunikat dla istniejącego i nieistniejącego konta (AC-6).
    if (error) return showFormError(reset, failureText(error));
    el(reset, '[data-done]').hidden = false;
  });

  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  if (data.session) goNext();
}

/** `/logowanie/nowe-haslo/` — AC-6. */
export async function mountNewPassword(): Promise<void> {
  const form = el<HTMLFormElement>(document, 'form[data-new-password]');
  const supabase = client();
  if (supabase) await verifyFromUrl(supabase);
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  if (!supabase || !data.session) {
    el(document, '[data-invalid]').hidden = false;
    return;
  }
  form.hidden = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormError(form, null);
    const password = field(form, 'password').value;
    if (showErrors(form, validateNewPassword(password, field(form, 'password2').value))) return;
    const submit = el<HTMLButtonElement>(form, '[data-submit]');
    submit.disabled = true;
    const { error } = await supabase.auth.updateUser({ password });
    submit.disabled = false;
    if (error) return showFormError(form, failureText(error));
    form.hidden = true;
    el(document, '[data-done]').hidden = false;
  });
}

function showAccountState(state: 'ack' | 'ready' | 'error'): void {
  for (const section of document.querySelectorAll<HTMLElement>('[data-account-state]')) {
    section.hidden = section.dataset.accountState !== state;
  }
}

/** `/konto/` — klauzula przy pierwszym logowaniu Google (AC-3), potem `?next=` (AC-5) albo panel konta (AC-9…AC-15). */
export async function mountAccount(): Promise<void> {
  const supabase = client();
  if (!supabase) return showAccountState('error');
  await verifyFromUrl(supabase);
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return window.location.replace(withNext(LOGIN_PAGE, safeNext() ?? ACCOUNT_HOME));

  const proceed = (profile: AccountProfile) => {
    const next = safeNext();
    if (next && new URL(next, window.location.origin).pathname !== ACCOUNT_HOME) return window.location.replace(next);
    el(document, '[data-signed-in-as]').textContent = t('account.signedInAs', { email: user.email ?? '' });
    renderAccount(supabase, user, profile);
    showAccountState('ready');
  };
  el(document, '[data-sign-out]').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.assign('/');
  });

  const { data: profile, error } = await supabase.from('profiles').select(ACCOUNT_COLUMNS).eq('id', user.id).maybeSingle<AccountProfile>();
  if (error || !profile) return showAccountState('error');
  if (profile.privacy_notice_ack_at) return proceed(profile);

  showAccountState('ack');
  const ackButton = el<HTMLButtonElement>(document, '[data-ack]');
  ackButton.addEventListener('click', async () => {
    ackButton.disabled = true;
    const { error: ackError } = await supabase
      .from('profiles')
      .update({ privacy_notice_ack_at: new Date().toISOString() })
      .eq('id', user.id);
    ackButton.disabled = false;
    const box = el(document, '[data-account-state="ack"] [data-form-error]');
    box.hidden = !ackError;
    box.textContent = ackError ? t('auth.genericError') : '';
    if (!ackError) proceed(profile);
  });
}
