import { describe, expect, it } from 'vitest';
import {
  afterSignInPath,
  headerState,
  safeNextPath,
  signInFailure,
  validateEmail,
  validateNewPassword,
  withNext,
} from './auth';

const ORIGIN = 'https://events.steel-valley.pl';
const jwt = (claims: object) => `x.${btoa(JSON.stringify(claims)).replace(/=+$/, '')}.y`;

describe('rejestracja i logowanie (SPEC-002 US-1)', () => {
  it('AC-1: e-mail i hasło min. 8 znaków, powtórzenie takie samo', () => {
    expect(validateEmail(' jan@example.com ')).toEqual({});
    expect(validateEmail('jan@')).toEqual({ email: 'emailInvalid' });
    expect(validateNewPassword('1234567', '1234567')).toEqual({ password: 'passwordTooShort' });
    expect(validateNewPassword('12345678', '12345679')).toEqual({ password2: 'passwordMismatch' });
    expect(validateNewPassword('12345678', '12345678')).toEqual({});
  });

  it('AC-5: ?next= tylko ścieżki tej aplikacji, domyślnie /konto/', () => {
    expect(safeNextPath('/panel/zawody/edytuj/?id=5#a', ORIGIN)).toBe('/panel/zawody/edytuj/?id=5#a');
    for (const bad of [null, '', 'panel/', '//evil.example/', '/\\evil.example/', 'https://evil.example/', 'javascript:alert(1)']) {
      expect(safeNextPath(bad, ORIGIN)).toBeNull();
    }
    expect(afterSignInPath('/panel/', ORIGIN)).toBe('/panel/');
    expect(afterSignInPath('//evil.example/', ORIGIN)).toBe('/konto/');
    expect(afterSignInPath(null, ORIGIN)).toBe('/konto/');
    expect(withNext('/rejestracja/', '/panel/?a=1')).toBe('/rejestracja/?next=%2Fpanel%2F%3Fa%3D1');
    expect(withNext('/rejestracja/', null)).toBe('/rejestracja/');
  });

  it('AC-5: złe dane, niepotwierdzony e-mail, limit prób', () => {
    expect(signInFailure({ code: 'invalid_credentials', status: 400 })).toBe('invalidCredentials');
    expect(signInFailure({ code: 'email_not_confirmed', status: 400 })).toBe('emailNotConfirmed');
    expect(signInFailure({ code: 'over_email_send_rate_limit', status: 429 })).toBe('rateLimited');
    expect(signInFailure({ status: 500 })).toBe('genericError');
  });

  it('nagłówek: „Zaloguj się” / „Moje konto” / „Panel” z zapisanej sesji (§6)', () => {
    expect(headerState(null)).toBe('guest');
    expect(headerState('nie-json')).toBe('guest');
    expect(headerState(JSON.stringify({ access_token: jwt({ app_role: 'user' }) }))).toBe('user');
    expect(headerState(JSON.stringify({ access_token: jwt({ app_role: 'staff' }) }))).toBe('staff');
    expect(headerState(JSON.stringify({ access_token: jwt({ app_role: 'admin' }) }))).toBe('staff');
  });
});
