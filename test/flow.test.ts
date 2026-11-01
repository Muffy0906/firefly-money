import { describe, expect, it } from 'vitest';
import { flowCols, flowPlace } from '../app/src/features/flow';
import { BENTO_SUB, bentoSpans } from '../app/src/features/dashboard';

describe('flowCols', () => {
  it('fits as many columns as the minimum width allows', () => {
    expect(flowCols(2248, 380, 20, 9)).toBe(5);
    expect(flowCols(788, 380, 20, 9)).toBe(2);
    expect(flowCols(361, 360, 20, 9)).toBe(1);
  });
  it('never makes more columns than there are cards to fill them', () => {
    expect(flowCols(2248, 380, 20, 4)).toBe(4);
    expect(flowCols(2248, 380, 20, 0)).toBe(1);
  });
});

describe('flowPlace', () => {
  it('puts each card under the shortest column', () => {
    const ps = flowPlace([{ h: 400 }, { h: 100 }, { h: 100 }, { h: 50 }], 2, 20);
    expect(ps.map(p => [p.c, p.y])).toEqual([[0, 0], [1, 0], [1, 120], [1, 240]]);
  });
  it('starts a full-width card below everything above it', () => {
    const ps = flowPlace([{ h: 400 }, { h: 100 }, { h: 30, full: true }, { h: 10 }], 2, 20);
    expect(ps[2]).toEqual({ c: -1, y: 420, span: 50 });
    expect(ps[3].y).toBe(470);
  });
});

describe('bentoSpans', () => {
  it('leaves full rows alone', () => {
    expect(bentoSpans([['a', 'm'], ['b', 's'], ['c', 's']], 4)).toEqual({});
  });
  it('stretches the tiles of a row with room left over to fill it', () => {
    const s = bentoSpans([['a', 'm'], ['b', 's'], ['c', 'm'], ['d', 'm']], 4);     // a+b leave a unit free, c+d fill theirs
    expect(s).toEqual({ a: 16, b: 8 });
    expect(s.a + s.b).toBe(4 * BENTO_SUB);
  });
  it('gives a lone small tile the whole row', () => {
    expect(bentoSpans([['a', 'l'], ['b', 's']], 6)).toEqual({ b: 36 });
  });
  it('rounds so a row always adds up exactly', () => {
    const s = bentoSpans([['a', 'm'], ['b', 'm'], ['c', 's'], ['d', 'm']], 6);
    expect(s.a + s.b + s.c).toBe(36);
  });
});
