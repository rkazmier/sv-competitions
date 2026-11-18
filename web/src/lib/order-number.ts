/**
 * Numer zamówienia (SPEC-006) — logika bez DOM. Format `SV-RRRR-NNNNNN` nadaje baza (wyzwalacz na `orders`).
 * Rozpoznanie formy numeru jak `public.normalize_order_number` w bazie (AC-10, AC-11):
 * wielkość liter, spacje na brzegach i zera wiodące bez znaczenia; inny tekst → `null` (wyszukiwanie po osobie).
 */
const ORDER_NUMBER = /^SV-([0-9]{4})-([0-9]+)$/;

/** Tekst w formie numeru zamówienia → numer w postaci z bazy (`SV-2026-000123`); inaczej `null`. */
export function normalizeOrderNumber(text: string): string | null {
  const match = ORDER_NUMBER.exec(text.trim().toUpperCase());
  if (!match) return null;
  const counter = match[2]!.replace(/^0+/, '') || '0';
  return `SV-${match[1]}-${counter.padStart(6, '0')}`;
}
