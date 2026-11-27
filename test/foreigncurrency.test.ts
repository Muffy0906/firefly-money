import { afterEach, describe, expect, it, vi } from 'vitest';

// A transfer between accounts in different currencies needs the destination's currency as the foreign currency,
// which is often the primary one: the Foreign currency list must include it
describe('foreign currency on cross-currency transfers', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  async function listsWith(codes: [string, boolean][]) {
    vi.stubGlobal('location', { origin: 'http://x', href: 'http://x/', hash: '' });
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('dispatchEvent', () => true);
    vi.stubGlobal('fetch', (url: string) => Promise.resolve(new Response(JSON.stringify({ data: String(url).includes('/currencies')
      ? codes.map(([code, enabled], i) => ({ id: String(i + 1), attributes: { code, enabled, name: code, symbol: code, decimal_places: 2 } })) : [],
      meta: { pagination: { total_pages: 1 } } }), { status: 200 })));
    const { S } = await import('../app/src/core/base');
    S.currency = 'PHP';
    const { lists } = await import('../app/src/core/lists');
    return (await lists(true)).foreign.map(c => c.code);
  }
  it('lists the primary currency when another currency is enabled', async () => {
    expect(await listsWith([['PHP', true], ['AUD', true], ['EUR', false]])).toEqual(['PHP', 'AUD']);
  });
  it('is empty when only the primary currency is enabled', async () => {
    expect(await listsWith([['PHP', true], ['AUD', false]])).toEqual([]);
  });
  it('save defaults the foreign currency to the destination account on a transfer', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync('app/src/features/txform.ts', 'utf8')).toMatch(/f\.type === 'transfer' && s\.fa && num\(s\.fa\) > 0 && !s\.fc && srcCur && dstCur && srcCur !== dstCur\) s\.fc = dstCur/);
  });
});
