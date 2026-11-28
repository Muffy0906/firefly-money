// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import pages from '../app/pages.js';

// nginx's shared dictionary, as a plain map
function dictionary() {
  const m = new Map<string, number>();
  return { get: (k: string) => m.get(k), set: (k: string, v: number) => { m.set(k, v); }, delete: (k: string) => m.delete(k),
    incr: (k: string, by: number, init: number) => { const n = (m.has(k) ? m.get(k)! : init) + by; m.set(k, n); return n; } };
}
const g = globalThis as any;
let dir = '', n = 0;
function req(method: string, body: unknown = '') {
  const r: any = { method, requestText: typeof body === 'string' ? body : JSON.stringify(body), headersOut: {}, status: 0, text: '' };
  r.return = (s: number, t = '') => { r.status = s; r.text = t; };
  return r;
}
const visit = (p: unknown) => { const r = req('POST', { p }); pages.endpoint(r); return r; };
const top = () => { const r = req('GET'); pages.endpoint(r); return JSON.parse(r.text).top as { p: string, n: number }[]; };
const onDisk = () => JSON.parse(readFileSync(dir + '/pages.json', 'utf8'));

beforeEach(() => { dir = '/tmp/money-pages-test-' + Date.now() + '-' + (n++); g.ngx = { shared: { money_pages: dictionary() } }; g.process.env.MONEY_DATA = dir; vi.useRealTimers(); });

describe('pages.js', () => {
  it('counts visits and answers with the top three, most visited first', () => {
    ['budgets', 'bills', 'budgets', 'overview', 'budgets', 'bills', 'transactions'].forEach(visit);
    expect(top()).toEqual([{ p: 'budgets', n: 3 }, { p: 'bills', n: 2 }, { p: 'overview', n: 1 }]);
  });
  it('knows only the pages the app can load ahead, and stores nothing else', () => {
    expect(visit('settings').status).toBe(400);
    expect(visit('../../etc/passwd').status).toBe(400);
    expect(visit(7).status).toBe(400);
    expect(visit('__proto__').status).toBe(400);
    expect(req('PUT').status).toBe(0);
    const put = req('PUT'); pages.endpoint(put); expect(put.status).toBe(405);
    const bad = req('POST', 'not json'); pages.endpoint(bad); expect(bad.status).toBe(400);
    expect(top()).toEqual([]);
  });
  it('answers an empty list when there is no history', () => { expect(top()).toEqual([]); });
  it('never lets a response be cached', () => {
    const r = req('GET'); pages.endpoint(r);
    expect(r.headersOut['Cache-Control']).toBe('no-store');
  });
  it('saves the counts to disk (page names and numbers only) and reads them back after a restart', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    visit('bills'); visit('bills'); visit('piggy');
    vi.setSystemTime(new Date('2026-01-01T00:00:20Z')); top();
    expect(onDisk()).toEqual({ bills: 2, piggy: 1 });
    g.ngx = { shared: { money_pages: dictionary() } };      // a fresh start: empty memory, same folder
    expect(top()).toEqual([{ p: 'bills', n: 2 }, { p: 'piggy', n: 1 }]);
  });
  it('writes at most once every 15 seconds, and the next request catches up', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    visit('loans');
    visit('loans'); visit('loans');
    expect(onDisk()).toEqual({ loans: 1 });
    vi.setSystemTime(new Date('2026-01-01T00:00:20Z'));
    top();
    expect(onDisk()).toEqual({ loans: 3 });
  });
  it('forgets everything on DELETE, in memory and on disk', () => {
    visit('bills');
    const r = req('DELETE'); pages.endpoint(r);
    expect(r.status).toBe(204);
    expect(top()).toEqual([]);
    expect(onDisk()).toEqual({});
  });
  it('keeps working when the folder can not be written', () => {
    g.process.env.MONEY_DATA = '/dev/null/money';
    expect(visit('forecast').status).toBe(204);
    expect(top()).toEqual([{ p: 'forecast', n: 1 }]);
  });
  it('halves the counts once they pass 5000 so old habits fade', () => {
    const d = g.ngx.shared.money_pages; d.set('_loaded', 1); d.set('bills', 4000); d.set('budgets', 1000);
    visit('bills');
    expect(top()).toEqual([{ p: 'bills', n: 2000 }, { p: 'budgets', n: 500 }]);
  });
  it('lists the same pages as the app', () => {
    const src = readFileSync('app/src/features/mostused.ts', 'utf8');
    const list = /PRELOAD = \[([^\]]*)\]/.exec(src)![1].split(',').map(x => x.trim().replace(/'/g, '')).map(x => x || 'overview');
    expect(list.sort()).toEqual([...pages.PAGES].sort());
  });
});
