import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { blockNames, loadRangeBlocks, proposedTicket, type RangeBlock } from './pass-blocking';

const blocks: RangeBlock[] = [
  { kind: 'competition', id: 'c1', name: 'Puchar SV' },
  { kind: 'event', id: 'e1', name: 'Piknik' },
];

describe('blokada karnetów (SPEC-012 US-8)', () => {
  it('AC-41: range_blocked_on dla dnia; błąd odczytu → brak blokad (kontrola w bazie)', async () => {
    const calls: unknown[] = [];
    const ok = { rpc: (fn: string, args: unknown) => (calls.push([fn, args]), Promise.resolve({ data: blocks, error: null })) };
    expect(await loadRangeBlocks(ok, '2027-03-13')).toEqual(blocks);
    expect(calls).toEqual([['range_blocked_on', { p_date: '2027-03-13' }]]);
    const failed = { rpc: () => Promise.resolve({ data: null, error: { message: 'x' } }) };
    expect(await loadRangeBlocks(failed, '2027-03-13')).toEqual([]);
    const thrown = { rpc: () => Promise.reject(new Error('network')) };
    expect(await loadRangeBlocks(thrown, '2027-03-13')).toEqual([]);
  });

  it('AC-42: komunikat w książce z nazwami blokujących wpisów', () => {
    expect(t('passBlocking.rangeEntry', { name: blockNames(blocks.slice(1)) })).toBe(
      'Dziś: Piknik — karnety i wejścia jednorazowe nie obowiązują. Wejście na zasadach wydarzenia (wejściówka).',
    );
    expect(blockNames(blocks)).toBe('Puchar SV, Piknik');
  });

  it('AC-42: sprzedaż proponuje wejściówkę na blokujące wydarzenie, jeśli jest w sprzedaży', () => {
    expect(proposedTicket(blocks, ['product:p1', 'event:e2', 'event:e1'])).toBe('event:e1');
    expect(proposedTicket(blocks, ['product:p1', 'event:e2'])).toBeNull();
    expect(proposedTicket([], ['event:e1'])).toBeNull();
  });

  it('AC-43: ostrzeżenie przy sprzedaży karnetu osobie z kontem', () => {
    expect(t('passBlocking.saleWarning', { name: 'Puchar SV' })).toBe('Karnet nie obowiązuje dziś (Puchar SV).');
    expect(t('sales.errorRangeBlocked')).toBe('Dziś karnety i wejścia jednorazowe nie obowiązują.');
  });

  it('AC-40: etykieta pola w formularzach zawodów i wydarzeń', () => {
    expect(t('passBlocking.label')).toBe('Karnety i wejścia jednorazowe nie obowiązują w dniach tego wpisu');
  });
});
