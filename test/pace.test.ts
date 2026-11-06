import { describe, expect, it } from 'vitest';
import { goalPace } from '../app/src/features/pace';
import { monthEnds } from '../app/src/core/helpers';

describe('goalPace', () => {
  it('works out the monthly amount still needed', () => {
    const p = goalPace({ target: 2400, current: 600, targetDate: '2027-04-20' }, '2026-10-20');
    expect(p).toMatchObject({ status: 'on', left: 1800, monthsLeft: 6, perMonth: 300 });
  });
  it('says behind when savings trail an even pace from the start date', () => {
    const p = goalPace({ target: 1200, current: 200, startDate: '2026-04-20', targetDate: '2027-04-20' }, '2026-10-20');
    expect(p.status).toBe('behind');
    expect(Math.round(p.gap)).toBe(402);     // 183 of 365 days have passed, so about $602 should be saved
  });
  it('says on track when ahead of that pace', () => {
    expect(goalPace({ target: 1200, current: 700, startDate: '2026-04-20', targetDate: '2027-04-20' }, '2026-10-20').status).toBe('on');
  });
  it('handles goals that are reached, undated or past their date', () => {
    expect(goalPace({ target: 500, current: 500, targetDate: '2027-01-01' }, '2026-10-20').status).toBe('done');
    expect(goalPace({ target: 500, current: 100 }, '2026-10-20').status).toBe('open');
    expect(goalPace({ target: 500, current: 100, targetDate: '2026-10-01' }, '2026-10-20')).toMatchObject({ status: 'late', perMonth: 400 });
  });
});

describe('monthEnds', () => {
  it('lists month ends before today, oldest first', () => {
    expect(monthEnds('2026-03-15', 4)).toEqual(['2025-12-31', '2026-01-31', '2026-02-28', '2026-03-15']);
  });
  it('steps by quarters', () => {
    expect(monthEnds('2026-10-20', 3, 3)).toEqual(['2026-06-30', '2026-09-30', '2026-10-20']);
  });
});

import { paceForecast } from '../app/src/features/projections';
describe('paceForecast', () => {
  // last month: $2,959 by day 6 of $7,200 (rent and bills early)
  const prev = [...Array(30)].map((_, i) => i === 0 ? 2000 : i < 6 ? 191.8 : 4241 / 24);
  it('does not extrapolate a front-loaded start in a straight line', () => {
    const p = paceForecast(2386, 6, 30, prev);
    expect(p).toBeGreaterThan(2386);
    expect(p).toBeLessThan(7500);
  });
  it('matches last month when this month tracks it exactly', () => {
    const total = prev.reduce((s, v) => s + v, 0), then = prev.slice(0, 6).reduce((s, v) => s + v, 0);
    expect(paceForecast(then, 6, 30, prev)).toBeCloseTo(total, 0);
  });
  it('falls back to a line only after a week, and never goes below what is spent', () => {
    expect(paceForecast(300, 5, 30, [])).toBe(0);
    expect(paceForecast(700, 7, 30, [])).toBeCloseTo(3000, 0);
    expect(paceForecast(5000, 10, 30, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100])).toBeGreaterThanOrEqual(5000);
  });
  it('gives nothing for a finished or not-started month', () => {
    expect(paceForecast(100, 30, 30, prev)).toBe(0);
    expect(paceForecast(0, 0, 30, prev)).toBe(0);
  });
});
