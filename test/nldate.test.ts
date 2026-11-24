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
  it('ignores words that are not dates', () => {
    expect(read('coffee')).toBeNull();
    expect(read('12')).toBeNull();
    expect(read('mo')).toBeNull();
  });
});
