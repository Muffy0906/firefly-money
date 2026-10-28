import { beforeEach, describe, expect, it } from 'vitest';
import { tileOn } from '../app/src/features/dashboard';

const save = (v: unknown) => localStorage.setItem('money.dash', JSON.stringify(v));

describe('which Overview cards are on', () => {
  beforeEach(() => localStorage.clear());
  it('starts a new Overview with a few cards', () => {
    expect(['safe', 'attention', 'spending', 'budgets', 'bills', 'cashflow'].every(tileOn)).toBe(true);
    expect(['payees', 'heatmap', 'networth', 'pace', 'trends'].some(tileOn)).toBe(false);
  });
  it('keeps every card for someone who arranged their Overview before, except the newer charts', () => {
    save({ order: ['safe', 'payees'], hidden: ['heatmap'] });
    expect(tileOn('payees')).toBe(true);
    expect(tileOn('networth')).toBe(true);
    expect(tileOn('heatmap')).toBe(false);
    expect(tileOn('pace')).toBe(false);
  });
  it('follows what was added and hidden', () => {
    save({ v: 2, order: [], hidden: ['bills'], shown: ['pace'] });
    expect(tileOn('pace')).toBe(true);
    expect(tileOn('bills')).toBe(false);
    expect(tileOn('payees')).toBe(false);
  });
});
