import { beforeEach, describe, expect, it } from 'vitest';
import { hoursText } from '../app/src/core/worklens';
import { movers, scrubIndex } from '../app/src/features/networth';
import { yearStats } from '../app/src/pages/year';

const buy = (date: string, payee: string, amount: number) => ({ date: date + 'T12:00:00Z', amount, payee, description: payee });

describe('year in money', () => {
  it('finds your usual place, biggest purchase, no-spend days and longest run', () => {
    const st = yearStats([
      buy('2026-01-01', 'Blue Bottle', 5), buy('2026-01-02', 'Blue Bottle', 6), buy('2026-01-03', 'blue bottle ', 4),
      buy('2026-01-03', 'Grocer', 80), buy('2026-01-08', 'Airline', 420),
    ], '2026-01-01', '2026-01-10');
    expect(st.often).toEqual({ name: 'Blue Bottle', n: 3, v: 15 });
    expect(st.top.map(p => p.name)).toEqual(['Airline', 'Grocer', 'Blue Bottle']);
    expect(st.biggest!.amount).toBe(420);
    expect(st.free).toBe(6);                  // the 4th–7th, 9th and 10th
    expect(st.streak).toBe(4);
    expect(st.streakEnd).toBe('2026-01-07');
    expect(st.days).toBe(10);
    expect(st.count).toBe(5);
  });
  it('has nothing to say about a year without purchases', () => {
    const st = yearStats([], '2026-01-01', '2026-01-05');
    expect(st.often).toBeNull(); expect(st.biggest).toBeNull(); expect(st.free).toBe(5); expect(st.weekday).toBe('');
  });
});

describe('hours of work', () => {
  beforeEach(() => localStorage.clear());
  it('shows minutes, hours and workdays', () => {
    expect(hoursText(-10, false, 40)).toBe('15 min');
    expect(hoursText(-39.9, true, 40)).toBe('1 h');
    expect(hoursText(-60, false, 40)).toBe('1.5 hours');
    expect(hoursText(-40, false, 40)).toBe('1 hour');
    expect(hoursText(-60, true, 40)).toBe('1.5 h');
    expect(hoursText(-1000, false, 40)).toBe('3.1 workdays');   // 25 hours, 8-hour days
    expect(hoursText(-1000, true, 40)).toBe('3.1 d');
  });
  it('says nothing without a rate', () => {
    expect(hoursText(-50)).toBe('');
  });
  it('uses the rate you set', () => {
    localStorage.setItem('money.workRate', '20');
    expect(hoursText(-30)).toBe('1.5 hours');
  });
});

describe('net worth scrubber', () => {
  it('snaps to the nearest point', () => {
    expect(scrubIndex(0, [6, 36, 66])).toBe(0);
    expect(scrubIndex(50, [6, 36, 66])).toBe(1);
    expect(scrubIndex(999, [6, 36, 66])).toBe(2);
  });
  it('lists the accounts that moved most since then', () => {
    expect(movers({ a: 100, b: -500, c: 10 }, { a: 1100, b: -200, c: 10, d: 50 }, { a: 'Checking', b: 'Visa', d: 'Savings' }))
      .toEqual([['Checking', 1000], ['Visa', 300], ['Savings', 50]]);
  });
});
