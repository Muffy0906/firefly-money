import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detailHas, detailKeys, detailSet, shareList } from '../app/src/features/carddrawer';

const css = readFileSync('app/assets/money.css', 'utf8'), ov = readFileSync('app/src/pages/overview.ts', 'utf8');

describe('Overview card drawers', () => {
  it('a card without data has no drawer, and one with data does', () => {
    detailSet('t1', 'T', () => shareList([], 0, false)); expect(detailHas('t1')).toBe(true);
    detailSet('t1', 'T', null); expect(detailHas('t1')).toBe(false);
    expect(detailKeys()).not.toContain('t1');
  });
  it('lists every row biggest first with share, change against last month, and a link that closes the drawer', () => {
    const h = String(shareList([{ name: 'Fun', amt: 10, prev: 30 }, { name: 'Rent', amt: 90, prev: 0, href: '#/transactions?category=1' }, { name: 'Zero', amt: 0 }], 100, true));
    expect(h.indexOf('Rent')).toBeLessThan(h.indexOf('Fun')); expect(h).not.toContain('Zero');
    expect(h).toContain('90% of the total'); expect(h).toContain('new'); expect(h).toContain('$20 less than last month');
    expect(h).toContain('data-onclick="App.closeDrawer()"');
  });
  it('shows an empty message and no comparison when off', () => {
    expect(String(shareList([], 0, true))).toContain('Nothing recorded');
    expect(String(shareList([{ name: 'A', amt: 5, prev: 1 }], 5, false))).not.toContain('last month');
  });
  it('registers spending, payees, income, budgets and cash flow, and only pointer-opens them outside Customize', () => {
    for (const k of ['spending', 'payees', 'income', 'budgets', 'cashflow']) { expect(ov).toContain("detailSet('" + k + "'"); expect(css).toContain('.w[data-w="' + k + '"]'); }
    expect(css).toContain('#dash:not(.editing)');
    expect(readFileSync('app/src/features/carddrawer.ts', 'utf8')).toContain('S.dashEdit');
  });
});
