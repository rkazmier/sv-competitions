import { describe, expect, it, vi } from 'vitest';
import { rebuildAndDescribe, rebuildMessage, requestSiteRebuild, type FunctionsClient } from './site-rebuild';

const client = (invoke: FunctionsClient['functions']['invoke']): FunctionsClient => ({ functions: { invoke } });

describe('site-rebuild (US-7)', () => {
  it('AC-29: wywołuje Edge Function site-rebuild metodą POST', async () => {
    const invoke = vi.fn().mockResolvedValue({ error: null });
    expect(await requestSiteRebuild(client(invoke))).toBe(true);
    expect(invoke).toHaveBeenCalledWith('site-rebuild', { method: 'POST' });
  });

  it('§7: błąd funkcji lub sieci → false, bez wyjątku', async () => {
    expect(await requestSiteRebuild(client(vi.fn().mockResolvedValue({ error: new Error('502') })))).toBe(false);
    expect(await requestSiteRebuild(client(vi.fn().mockRejectedValue(new TypeError('offline'))))).toBe(false);
  });

  it('AC-25: komunikat po publikacji', () => {
    expect(rebuildMessage(true, 'Opublikowano.')).toBe(
      'Opublikowano. Strona publiczna odświeży się w ciągu kilku minut.',
    );
  });

  it('AC-34 / §7: komunikaty ręcznego odświeżenia', async () => {
    const ok = client(vi.fn().mockResolvedValue({ error: null }));
    const failed = client(vi.fn().mockResolvedValue({ error: new Error('500') }));
    expect(await rebuildAndDescribe(ok)).toBe('Strona publiczna odświeży się w ciągu kilku minut.');
    expect(await rebuildAndDescribe(failed, 'Zapisano.')).toBe(
      'Zapisano. Nie udało się uruchomić odświeżenia strony. Spróbuj „Odśwież stronę publiczną” za chwilę.',
    );
  });
});
