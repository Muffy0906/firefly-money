import { afterEach, describe, expect, it } from 'vitest';
import { S, fmtDate, fmtDay, fmtNum, leadDays, money, monthRange, parseAmount, weekOrder, weekStart } from '../app/src/core/base';
import { parsePlan } from '../app/src/core/lists';

const use = (tag: string) => localStorage.setItem('money.locale', JSON.stringify(tag));
afterEach(() => { localStorage.removeItem('money.locale'); S.currency = 'USD'; });

describe('regional formats', () => {
  it('follows the browser when nothing is picked', () => {
    expect(money(1234.5)).toBe('$1,234.50');
    expect(fmtDate('2026-11-01')).toBe('Nov 1, 2026');
    expect(weekStart()).toBe(0);
  });
  it('writes amounts, numbers and dates the picked way', () => {
    use('de-DE'); S.currency = 'EUR';
    expect(money(1234.5).replace(/\s/g, ' ')).toBe('1.234,50 €');
    expect(fmtNum(12345)).toBe('12.345');
    expect(fmtDay('2026-11-01')).toBe('1. Nov.');
    expect(monthRange(2026, 10).label).toBe('November 2026');
    use('en-GB');
    expect(fmtDate('2026-11-01')).toBe('1 Nov 2026');
  });
  it('starts the week on the locale’s day', () => {
    use('de-DE');
    expect(weekStart()).toBe(1);
    expect(weekOrder(['S', 'M', 'T', 'W', 'T', 'F', 'S'])).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(leadDays(new Date(2026, 10, 1))).toBe(6);     // Nov 1 2026 is a Sunday
    use('en-US');
    expect(leadDays(new Date(2026, 10, 1))).toBe(0);
  });
  it('ignores a picked value that isn’t a locale', () => {
    use('not a locale!');
    expect(money(5)).toBe('$5.00');
  });
});

describe('parseAmount', () => {
  it('reads both decimal marks and any currency symbol', () => {
    expect(parseAmount('5.40')).toBe(5.4);
    expect(parseAmount('5,40')).toBe(5.4);
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56€')).toBe(1234.56);
    expect(parseAmount('£12')).toBe(12);
  });
  it('lets the locale decide a lone mark before three digits', () => {
    expect(parseAmount('1,234')).toBe(1234);
    expect(parseAmount('1.234')).toBe(1.234);
    use('de-DE');
    expect(parseAmount('1.234')).toBe(1234);
    expect(parseAmount('1,234')).toBe(1.234);
  });
  it('turns down what isn’t an amount', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1,,2')).toBeNull();
    expect(parseAmount('5.')).toBeNull();
    expect(parseAmount('1.2.3,4,5')).toBeNull();
  });
});

describe('loan plans in any currency', () => {
  it('reads a plan with another symbol, or none', () => {
    expect(parsePlan('Monthly payment: €1.250,50 on day 15')).toEqual({ amount: 1250.5, day: 15, from: '' });
    expect(parsePlan('Monthly payment: 300.00 from Checking')).toEqual({ amount: 300, day: null, from: 'Checking' });
  });
});
