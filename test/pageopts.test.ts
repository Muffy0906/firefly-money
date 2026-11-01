import { beforeEach, describe, expect, it } from 'vitest';
import { PAGE_OPTS, pageCard, pageOpt } from '../app/src/features/pageopts';
import { tileOpt } from '../app/src/features/dashboard';
import { changeBars, pairBars } from '../app/src/features/charts';

const save = (v: unknown) => localStorage.setItem('money.pageOpts', JSON.stringify(v));

describe('page options (Customize on each page)', () => {
  beforeEach(() => localStorage.clear());
  it('gives the defaults when nothing is saved', () => {
    expect(pageOpt('reports', 'trend')).toBe('lines');
    expect(pageOpt('recap', 'usual')).toBe(3);
    expect(pageCard('reports', 'weekday')).toBe(false);
    expect(pageCard('reports', 'balances')).toBe(true);
    expect(pageCard('reports', 'nothing-like-this')).toBe(true);
  });
  it('keeps a choice and falls back when it is no longer one of them', () => {
    save({ reports: { trend: 'bars', rows: 7, 'show.balances': false }, recap: { usual: 6 } });
    expect(pageOpt('reports', 'trend')).toBe('bars');
    expect(pageOpt('reports', 'rows')).toBe(12);
    expect(pageCard('reports', 'balances')).toBe(false);
    expect(pageOpt('recap', 'usual')).toBe(6);
  });
  it('keeps a select option apart from a card of the same name', () => {
    save({ recap: { top: 10, 'show.buys': false } });
    expect(pageOpt('recap', 'top')).toBe(10);
    expect(pageCard('recap', 'buys')).toBe(false);
  });
  it('lists every option with a default among its choices', () => {
    Object.values(PAGE_OPTS).forEach(P => P.opts.forEach(o => { if (o.choices) expect(o.choices.map(c => c[0])).toContain(o.def); }));
  });
  it('lets an Overview tile pick its chart style', () => {
    expect(tileOpt('cashflow', 'style')).toBe('bars');
    localStorage.setItem('money.dash', JSON.stringify({ v: 3, opts: { cashflow: { style: 'lines' }, spending: { style: 'nope' } } }));
    expect(tileOpt('cashflow', 'style')).toBe('lines');
    expect(tileOpt('spending', 'style')).toBe('donut');
  });
});

describe('new charts', () => {
  it('draws change bars biggest move first, skipping what did not move', () => {
    const h = String(changeBars([{ name: 'A', now: 10, prev: 10 }, { name: 'B', now: 50, prev: 10 }, { name: 'C', now: 0, prev: 100 }]));
    expect(h.indexOf('>C<')).toBeLessThan(h.indexOf('>B<'));
    expect(h).not.toContain('>A<');
    expect(String(changeBars([{ name: 'A', now: 1, prev: 1 }]))).toBe('');
  });
  it('gives every pair of bars a tip', () => {
    const h = String(pairBars([{ label: 'Jan', a: 5, b: 3 }, { label: 'A very long budget name', a: 1, b: 2 }], ['In', 'Out'], ['red', 'blue'], 'x'));
    expect(h.match(/data-tip=/g)!.length).toBe(2);
    expect(h).toContain('A very lo…');
  });
});
