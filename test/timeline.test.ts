import { describe, expect, it } from 'vitest';
import { crossed } from '../app/src/pages/timeline';

describe('timeline moments', () => {
  it('names the biggest round number net worth passed, or dipped below', () => {
    expect(crossed(48_000, 51_200)).toBe('Net worth passed $50k');
    expect(crossed(9_000, 26_000)).toBe('Net worth passed $25k');
    expect(crossed(980_000, 1_020_000)).toBe('Net worth passed $1m');
    expect(crossed(52_000, 49_000)).toBe('Dipped below $50k');
    expect(crossed(-1_200, 300)).toBe('Net worth turned positive');
    expect(crossed(51_000, 53_000)).toBe('');
  });
});
