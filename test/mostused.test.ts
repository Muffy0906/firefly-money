import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const g = globalThis as any;
let calls: { method: string, body?: any }[], top: string[], prefetch: ReturnType<typeof vi.fn>;
async function load() {
  vi.resetModules();
  document.body.innerHTML = '<div id="app" hidden></div><div id="toast"></div>';
  const base = await import('../app/src/core/base');
  base.S.signedIn = true;
  base.App.prefetch = prefetch as unknown as (name: string) => void;
  return import('../app/src/features/mostused');
}
beforeEach(() => {
  vi.useFakeTimers();
  calls = []; top = ['budgets', 'overview', 'bills', 'piggy']; prefetch = vi.fn();
  localStorage.clear(); delete g.MONEY_DEMO; location.hash = '#/transactions';
  g.fetch = vi.fn(async (_u: string, o: any) => {
    calls.push({ method: o.method || 'GET', body: o.body && JSON.parse(o.body) });
    return { ok: true, status: 200, json: async () => ({ top: top.map(p => ({ p, n: 1 })) }) };
  });
  Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
});
afterEach(() => { vi.useRealTimers(); delete g.MONEY_DEMO; });

describe('most-used pages (client)', () => {
  it('counts a page after a few seconds on it, once a minute at most', async () => {
    await load();
    await vi.advanceTimersByTimeAsync(3000 + 4000);
    expect(calls.filter(c => c.method === 'POST')).toEqual([{ method: 'POST', body: { p: 'transactions' } }]);
    location.hash = '#/transactions'; dispatchEvent(new HashChangeEvent('hashchange'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.filter(c => c.method === 'POST').length).toBe(1);
  });
  it('does not count a page you only passed through, or one that can not be loaded ahead', async () => {
    await load();
    location.hash = '#/bills'; dispatchEvent(new HashChangeEvent('hashchange'));
    await vi.advanceTimersByTimeAsync(2000);
    location.hash = '#/settings'; dispatchEvent(new HashChangeEvent('hashchange'));
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls.filter(c => c.method === 'POST')).toEqual([]);
  });
  it('loads the top pages ahead one at a time, skipping the page you are on', async () => {
    const m = await load();
    location.hash = '#/budgets';
    const done = m.preload();
    await vi.advanceTimersByTimeAsync(10000);
    await done;
    expect(prefetch.mock.calls.map(c => c[0])).toEqual(['', 'bills', 'piggy']);
  });
  it('does nothing when switched off, in the demo, or with Data Saver', async () => {
    let m = await load();
    localStorage.setItem('money.mostUsed', 'false');
    await m.preload();
    expect(calls).toEqual([]);
    localStorage.clear(); g.MONEY_DEMO = true;
    m = await load();
    await m.preload();
    expect(calls).toEqual([]);
    delete g.MONEY_DEMO;
    Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true });
    m = await load();
    await m.preload();
    expect(calls).toEqual([]);
    expect(prefetch).not.toHaveBeenCalled();
  });
  it('loads nothing when the server fails', async () => {
    const m = await load();
    g.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    await m.preload();
    await vi.advanceTimersByTimeAsync(10000);
    expect(prefetch).not.toHaveBeenCalled();
    g.fetch = vi.fn(async () => { throw new Error('down'); });
    await m.preload();
    expect(prefetch).not.toHaveBeenCalled();
  });
  it('ignores page names it does not know', async () => {
    top = ['settings', '../x', 'budgets'];
    const m = await load();
    const done = m.preload();
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    expect(prefetch.mock.calls.map(c => c[0])).toEqual(['budgets']);
  });
});
