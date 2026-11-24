import { describe, expect, it } from 'vitest';
import { CAL_DAYS, RISK, cashCalendar } from '../app/src/features/cashcal';
import { cashBands } from '../app/src/features/predict';
import { addDays } from '../app/src/core/helpers';
import { readFileSync } from 'node:fs';

const dates = (n: number) => Array.from({ length: n }, (_, i) => addDays('2026-11-08', i));
const ev = (day: number, amount: number, kind = 'Bill') => ({ date: addDays('2026-11-08', day), amount, kind, label: kind });

describe('cash flow calendar', () => {
  const bal = dates(40).map((_, i) => 1000 - i * 10);
  it('covers 30 days with money in and out per day', () => {
    const d = cashCalendar({ dates: dates(40), bal, events: [ev(2, 500, 'Payday'), ev(2, -120), ev(5, -80)] });
    expect(d).toHaveLength(CAL_DAYS);
    expect(d[2]).toMatchObject({ inn: 500, out: 120 });
    expect(d[5]).toMatchObject({ inn: 0, out: 80 });
    expect(d[0].events).toEqual([]);
  });
  it('ignores events switched off', () => {
    const d = cashCalendar({ dates: dates(5), bal: [1, 1, 1, 1, 1], events: [{ ...ev(1, -50), off: true }] });
    expect(d[1].out).toBe(0);
  });
  it('marks the lowest balance as the tightest day (earliest on a tie)', () => {
    const d = cashCalendar({ dates: dates(5), bal: [500, 200, 200, 400, 600], events: [] });
    expect(d.filter(x => x.tightest).map(x => x.i)).toEqual([1]);
  });
  it('flags days projected below zero, or with at least a 1 in 10 chance', () => {
    const d = cashCalendar({ dates: dates(4), bal: [100, -20, 50, 300], events: [], pNeg: [0, 0.4, RISK, 0.05] });
    expect(d.map(x => x.risk)).toEqual([false, true, true, false]);
    expect(d[1].pNeg).toBeGreaterThanOrEqual(.5);
  });
  it('without a band, only days projected below zero are at risk', () => {
    const d = cashCalendar({ dates: dates(3), bal: [10, -5, 10], events: [] });
    expect(d.map(x => x.risk)).toEqual([false, true, false]);
  });
  it('uses the simulated chance per day from the balance band', () => {
    const events = [{ day: 3, amount: -900, kind: 'Card' }, { day: 6, amount: -50, kind: 'Bill' }, { day: 9, amount: -50, kind: 'Bill' }];
    const b = cashBands(1000, 30, events)!;
    expect(b.pNeg).toHaveLength(31);
    expect(b.pNeg[0]).toBe(0);
    expect(Math.max(...b.pNeg)).toBeGreaterThan(0);
    b.pNeg.forEach((p, i) => { if (i) expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); });
    const d = cashCalendar({ dates: dates(31), bal: b.p50, events: [], pNeg: b.pNeg, p10: b.p10 });
    expect(d.some(x => x.risk)).toBe(true);
    expect(d[0].risk).toBe(false);
  });
});

describe('cash flow calendar markup', () => {
  const src = readFileSync('app/src/pages/forecast.ts', 'utf8'), css = readFileSync('app/assets/money.css', 'utf8');
  it('is on the Forecast page, built on the Daily spending cells', () => {
    expect(src).toContain('${cashCalPanel(m)}');
    expect(src).toContain('hm-cell cc-cell');
  });
  it('has styles for risk, tightest day and dots, with no scaled SVG', () => {
    ['.cc-cell.tight', '.cc-dots', '.cc-key'].forEach(c => expect(css).toContain(c));
    expect(src.slice(src.indexOf('function cashCalPanel'), src.indexOf('VIEWS.forecast'))).not.toContain('<svg');
  });
  it('scales to the card: no fixed width cap on wide cards, side column, one wording for the span', () => {
    expect(css).toMatch(/@container \(min-width: 840px\)[\s\S]*?\.cc-body \{ grid-template-columns/);
    expect(css).toMatch(/\.cc-main \.hm-cell \{ aspect-ratio: auto; height: 80px/);
    expect(src).toContain('cc-side');
    expect(src).toContain('days of this forecast');
    expect(css).not.toContain('.cc .hm, .cc .hm-foot, .cc-key { max-width: 640px');
  });
});
