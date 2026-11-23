/**
 * Blokada karnetów w dniach wydarzeń i zawodów (SPEC-012 US-8, AC-40…AC-45). Logika bez DOM.
 * Ważność liczy baza (`pass_valid_on`, `range_blocked_on`) — tu tylko odczyt listy blokad dnia i teksty dla obsługi.
 */

/** Wiersz `range_blocked_on(date)` (AC-41) — publiczny. */
export interface RangeBlock {
  kind: 'competition' | 'event';
  id: string;
  name: string;
}

/** Wycinek klienta Supabase potrzebny tutaj (ułatwia testy). */
export interface RpcClient {
  rpc: (fn: 'range_blocked_on', args: { p_date: string }) => PromiseLike<{ data: unknown; error: unknown }>;
}

/** Blokady dnia `YYYY-MM-DD`; błąd odczytu → `[]` (ostateczna kontrola i tak w bazie). */
export async function loadRangeBlocks(supabase: RpcClient, day: string): Promise<RangeBlock[]> {
  try {
    const { data, error } = await supabase.rpc('range_blocked_on', { p_date: day });
    return error ? [] : ((data ?? []) as RangeBlock[]);
  } catch {
    return [];
  }
}

/** Nazwy blokujących wpisów do komunikatu (kilka wpisów tego samego dnia — po przecinku). */
export function blockNames(blocks: readonly RangeBlock[]): string {
  return blocks.map((block) => block.name).join(', ');
}

/**
 * AC-42: „Sprzedaj na miejscu” w dzień blokady proponuje wejściówkę — pierwsza pozycja `event:<id>`
 * dla blokującego wydarzenia (jeśli jest płatne i w sprzedaży), inaczej `null`.
 */
export function proposedTicket(blocks: readonly RangeBlock[], itemValues: readonly string[]): string | null {
  const events = new Set(blocks.filter((block) => block.kind === 'event').map((block) => `event:${block.id}`));
  return itemValues.find((value) => events.has(value)) ?? null;
}
