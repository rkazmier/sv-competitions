/**
 * Dane użytkownika do książki rejestru pobytu (SPEC-002 US-2, AC-7…AC-11) — logika bez DOM, testowana w Vitest.
 * Limity i wzorce takie same jak `check` w `profiles` (migracja 20261117190000); baza i tak odrzuci złe dane.
 * Interfejs: lib/account-ui.ts.
 */

/** Kolumny `profiles`, które użytkownik zmienia sam (uprawnienia kolumnowe, AC-7). */
export const PROFILE_FIELDS = ['full_name', 'phone', 'permit_number', 'permit_authority', 'address'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

export type ProfileData = Record<ProfileField, string | null>;

/** Profil z bazy, jakim go pokazuje `/konto/`. */
export interface AccountProfile extends ProfileData {
  is_range_ready: boolean;
  qr_token: string;
  privacy_notice_ack_at: string | null;
}

/** Limity długości po `trim` (SPEC-002 §5). */
export const LIMITS: Record<Exclude<ProfileField, 'phone'>, { min: number; max: number }> = {
  full_name: { min: 2, max: 150 },
  permit_number: { min: 1, max: 50 },
  permit_authority: { min: 2, max: 150 },
  address: { min: 5, max: 300 },
};

/** Wzorzec telefonu (SPEC-002 §5, `check` w bazie). */
export const PHONE = /^\+?[0-9 ]{9,20}$/;

export type ProfileError = 'length' | 'phone' | 'permitPair';
export type ProfileErrors = Partial<Record<ProfileField, ProfileError>>;

/** Wartości z formularza → zapis: `trim`, pusty ciąg → `null` (SPEC-002 §5, tak samo `profiles_normalize`). */
export function normalizeProfile(input: Partial<Record<ProfileField, string | null | undefined>>): ProfileData {
  return Object.fromEntries(
    PROFILE_FIELDS.map((name) => [name, input[name]?.trim() || null]),
  ) as ProfileData;
}

/** Walidacja przed zapisem (AC-8, AC-11). Pusta mapa = można zapisać. */
export function validateProfile(data: ProfileData): ProfileErrors {
  const errors: ProfileErrors = {};
  for (const [name, { min, max }] of Object.entries(LIMITS) as [keyof typeof LIMITS, { min: number; max: number }][]) {
    const value = data[name];
    // Długość w znakach (jak `length()` w PostgreSQL), nie w jednostkach UTF-16.
    if (value !== null && ([...value].length < min || [...value].length > max)) errors[name] = 'length';
  }
  if (data.phone !== null && !PHONE.test(data.phone)) errors.phone = 'phone';
  // AC-8: numer decyzji tylko razem z organem wydającym — komunikat przy pustym polu pary.
  if ((data.permit_number === null) !== (data.permit_authority === null)) {
    errors[data.permit_number === null ? 'permit_number' : 'permit_authority'] = 'permitPair';
  }
  return errors;
}

export type MissingItem = 'fullName' | 'permitOrAddress';

/**
 * Braki do wpisu do książki (AC-9). Status gotowości pokazujemy z `is_range_ready` liczonego w bazie (AC-10);
 * ta lista tylko opisuje, czego brakuje — warunek taki sam jak kolumna generowana.
 */
export function missingForRangeEntry(data: ProfileData): MissingItem[] {
  const missing: MissingItem[] = [];
  if (!data.full_name) missing.push('fullName');
  if (!(data.permit_number && data.permit_authority) && !data.address) missing.push('permitOrAddress');
  return missing;
}
