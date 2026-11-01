import { describe, expect, it } from 'vitest';
import { NotFound, createMockApi } from '../app/src/demo/mockapi';

describe('demo API', () => {
  const now = new Date(2026, 9, 20);
  it('makes the same data on every visit', () => {
    expect(createMockApi(now)('/transactions', { limit: '500' })).toEqual(createMockApi(now)('/transactions', { limit: '500' }));
  });
  it('has a year of transactions, newest first, none after today', () => {
    const { data } = createMockApi(now)('/transactions', { limit: '1000' }) as any;
    const dates = data.map((g: any) => g.attributes.transactions[0].date.slice(0, 10));
    expect(dates[0] <= '2026-10-20').toBe(true);
    expect(dates.at(-1)).toBe('2025-10-01');
    expect([...dates].sort().reverse()).toEqual(dates);
  });
  it('pages lists and filters by date', () => {
    const api = createMockApi(now);
    const r = api('/transactions', { limit: '10', page: '2', start: '2026-10-01', end: '2026-10-20' }) as any;
    expect(r.data).toHaveLength(10);
    expect(r.meta.pagination.current_page).toBe(2);
    expect(r.data.every((g: any) => g.attributes.transactions[0].date >= '2026-10-01')).toBe(true);
  });
  it('category totals add up to total spending', () => {
    const api = createMockApi(now), q = { start: '2026-10-01', end: '2026-10-31' };
    const cats = (api('/insight/expense/category', q) as any[]).reduce((s, c) => s + c.difference_float, 0);
    const none = (api('/insight/expense/no-category', q) as any[]).reduce((s, c) => s + c.difference_float, 0);
    expect(cats + none).toBeCloseTo(-(api('/insight/expense/total', q) as any)[0].difference_float, 2);
  });
  it('fills this month even on its first day', () => {
    const api = createMockApi(new Date(2026, 10, 1)), q = { start: '2026-11-01', end: '2026-11-01' };
    expect((api('/insight/expense/category', q) as any[]).length).toBeGreaterThan(3);
    expect((api('/insight/income/total', q) as any)[0].difference_float).toBeGreaterThan(0);
  });
  it('works balances out from the history, so cards owe a little and the bank never goes negative', () => {
    const api = createMockApi(now), bal = (q: Record<string, string>) => (api('/accounts', q) as any).data.slice(0, 4).map((a: any) => +a.attributes.current_balance);
    expect(bal({ date: '2025-09-30' }).map((v: number) => v + 0)).toEqual([2000, 6000, 0, 0]);
    for (let d = new Date(2025, 9, 1); d <= now; d.setDate(d.getDate() + 1)) {
      const [checking, savings, rewards, cashback] = bal({ date: d.toLocaleDateString('sv') });
      expect(checking).toBeGreaterThan(0); expect(savings).toBeGreaterThan(0);
      expect(rewards).toBeLessThanOrEqual(0.001); expect(cashback).toBeLessThanOrEqual(0.001);
    }
  });
  it('deletes a transaction', () => {
    const api = createMockApi(now);
    expect(api('/transactions/1', {}, 'DELETE')).toBeNull();
    expect(api('/transactions/1', {})).toEqual({ data: undefined });
  });
  it('keeps preferences, and answers 404 for one never saved', () => {
    const api = createMockApi(now);
    expect(() => api('/preferences/money_settings', {})).toThrow(NotFound);
    api('/preferences', {}, 'POST', { name: 'money_settings', data: { a: 1 } });
    expect((api('/preferences/money_settings', {}) as any).data.attributes.data).toEqual({ a: 1 });
  });
  it('gives balances as of a past date', () => {
    const api = createMockApi(now);
    const bal = (q: Record<string, string>) => +(api('/accounts', q) as any).data[0].attributes.current_balance;
    expect(bal({ date: '2026-10-20' })).toBeCloseTo(bal({}), 2);
    expect(bal({ date: '2026-06-01' })).not.toBeCloseTo(bal({}), 2);
  });
  it('has bills, marked paid by the charges linked to them', () => {
    const api = createMockApi(now);
    const bills = (api('/bills', { start: '2026-10-01', end: '2026-10-31' }) as any).data.map((b: any) => b.attributes);
    expect(bills.map((b: any) => b.name)).toEqual(['StreamFlix', 'Tunes Plus', 'City Power & Light', 'Car insurance']);
    expect(bills[0].pay_dates).toEqual(['2026-10-11']);
    expect(bills[0].paid_dates).toHaveLength(1);
    expect(bills[3].pay_dates).toEqual([]);
    expect(bills[3].next_expected_match).toBe('2026-11-07');
    expect((api('/bills/1/transactions', {}) as any).data.length).toBeGreaterThan(3);
  });
});
