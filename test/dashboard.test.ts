import { beforeEach, describe, expect, it } from 'vitest';
import { tileOn, tileOpt } from '../app/src/features/dashboard';

const save = (v: unknown) => localStorage.setItem('money.dash', JSON.stringify(v));

describe('which Overview cards are on', () => {
  beforeEach(() => localStorage.clear());
  it('starts a new Overview with the bento tiles', () => {
    expect(['networth', 'safe', 'spent', 'earned', 'insights', 'spending', 'budgets', 'bills', 'attention', 'cashflow'].every(tileOn)).toBe(true);
    expect(['payees', 'heatmap', 'pace', 'trends'].some(tileOn)).toBe(false);
  });
  it('starts a layout from before the bento over, keeping each tile’s settings', () => {
    save({ v: 2, order: ['safe', 'payees'], hidden: ['spending'], shown: ['payees'], opts: { recent: { count: 5 } } });
    expect(tileOn('payees')).toBe(false);
    expect(tileOn('spending')).toBe(true);
    expect(tileOn('spent')).toBe(true);
    expect(tileOpt('recent', 'count')).toBe(5);
  });
  it('follows what was added and hidden', () => {
    save({ v: 3, order: [], hidden: ['bills'], shown: ['pace'] });
    expect(tileOn('pace')).toBe(true);
    expect(tileOn('bills')).toBe(false);
    expect(tileOn('payees')).toBe(false);
  });
});
