import { beforeEach, describe, expect, it } from 'vitest';
import { HIDE, hideGroups, hideParams } from '../app/src/core/api';

const set = (v: boolean) => localStorage.setItem('money.hideInactive', JSON.stringify(v));
const grp = (id: string, src: string, dst: string) => ({ id, attributes: { transactions: [{ source_id: src, destination_id: dst }] } });
const res = { data: [grp('1', '10', '90'), grp('2', '11', '90'), grp('3', '90', '11')] };

describe('leave out closed accounts (#224)', () => {
  beforeEach(() => { HIDE.inactive = new Set(['11']); HIDE.active = ['10', '12']; set(true); });
  it('drops transaction groups touching a closed account', () => {
    expect(hideGroups('/transactions', res).data.map((g: any) => g.id)).toEqual(['1']);
    expect(hideGroups('/categories/5/transactions', res).data.length).toBe(1);
  });
  it('keeps a closed account’s own page whole', () => {
    expect(hideGroups('/accounts/11/transactions', res).data.length).toBe(3);
  });
  it('asks insight totals for the open accounts only', () => {
    const u = new URL('http://x/api/v1/insight/expense/category?start=a&end=b');
    hideParams('/insight/expense/category', u);
    expect(u.searchParams.getAll('accounts[]')).toEqual(['10', '12']);
    const t = new URL('http://x/api/v1/transactions'); hideParams('/transactions', t);
    expect(t.searchParams.has('accounts[]')).toBe(false);
  });
  it('does nothing when off', () => {
    set(false);
    expect(hideGroups('/transactions', res).data.length).toBe(3);
  });
});
