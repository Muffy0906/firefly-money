import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nlDate } from '../app/src/features/nldate';

// Each case: the words typed, where the date starts, the date read, and how many words it used
const read = (text: string, i = 0) => nlDate(text.split(' '), i);

describe('quick add dates', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 20, 9)); });   // Tue 20 Oct 2026
  afterEach(() => vi.useRealTimers());

  it('leaves merchant names that only start like a month alone', () => {
    ['Market 20', 'Decathlon 25', 'Marshalls 30', 'Junction 15', 'Octane 30'].forEach(t => expect(read(t)).toBeNull());
    expect(read('Sept 9')).toEqual(['2026-09-09', 2]);
    expect(read('october 3rd')).toEqual(['2026-10-03', 2]);
  });
  it('reads relative days', () => {
    expect(read('today')).toEqual(['2026-10-20', 1]);
    expect(read('Yesterday,')).toEqual(['2026-10-19', 1]);
    expect(read('tomorrow')).toEqual(['2026-10-21', 1]);
    expect(read('3 days ago')).toEqual(['2026-10-17', 3]);
  });
  it('reads weekdays as the latest one, and "last" for a week back', () => {
    expect(read('mon')).toEqual(['2026-10-19', 1]);
    expect(read('friday')).toEqual(['2026-10-16', 1]);
    expect(read('tue')).toEqual(['2026-10-20', 1]);
    expect(read('last tue', 1)).toEqual(['2026-10-13', 1]);
  });
  it('reads month/day and month names, never in the future', () => {
    expect(read('9/12')).toEqual(['2026-09-12', 1]);
    expect(read('12/25')).toEqual(['2025-12-25', 1]);
    expect(read('1/5/24')).toEqual(['2024-01-05', 1]);
    expect(read('sep 12th')).toEqual(['2026-09-12', 2]);
    expect(read('november 3')).toEqual(['2025-11-03', 2]);
  });
  it('reads an obvious day/month order whatever the locale', () => {
    expect(read('13/9')).toEqual(['2026-09-13', 1]);     // 13 can't be a month
    expect(read('9/13')).toEqual(['2026-09-13', 1]);
    expect(read('25/12/2025')).toEqual(['2025-12-25', 1]);
  });
  it('follows the selected date locale when both orders are possible', () => {
    localStorage.setItem('money.locale', JSON.stringify('en-US'));
    expect(read('8/9')).toEqual(['2026-08-09', 1]);
    expect(read('1/5/24')).toEqual(['2024-01-05', 1]);
    expect(read('11/12')).toEqual(['2025-11-12', 1]);   // 12 Nov is still ahead, so last year's
    localStorage.setItem('money.locale', JSON.stringify('en-GB'));
    expect(read('8/9')).toEqual(['2026-09-08', 1]);     // day first
    expect(read('1/5/24')).toEqual(['2024-05-01', 1]);
    localStorage.removeItem('money.locale');
  });
  it('rejects dates that do not exist', () => {
    ['0/5', '5/0', '13/13', '2/30', '31/4', '4/31', '32/1', '30/2/2024'].forEach(t => expect(read(t)).toBeNull());
    expect(read('2/29/24')).toEqual(['2024-02-29', 1]);   // a real leap day
  });
  it('ignores words that are not dates', () => {
    expect(read('coffee')).toBeNull();
    expect(read('12')).toBeNull();
    expect(read('mo')).toBeNull();
  });
});
