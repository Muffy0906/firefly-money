import { describe, expect, it } from 'vitest';
import { barChart, paceChart, sparkBars } from '../app/src/features/charts';

const clean = (h: unknown) => { const s = String(h); expect(s).not.toMatch(/NaN|Infinity|undefined/); return s; };

describe('paceChart', () => {
  it('draws this month up to today against all of last month', () => {
    const s = clean(paceChart([10, 0, 25], Array(30).fill(5), 31, ['Oct', 'Sep']));
    expect(s.match(/class="draw/g)).toHaveLength(2);
    expect(s).toContain('class="pace-dot"');
  });
  it('copes with a first day, an empty month and nothing last month', () => {
    clean(paceChart([12], [], 31, ['Oct', 'Sep']));
    clean(paceChart([], [], 30, ['Nov', 'Oct']));
    clean(paceChart([0, 0, 0], [0, 0], 28, ['Feb', 'Jan']));
  });
});

describe('barChart', () => {
  it('puts losing months below the line and leaves months without income empty', () => {
    const s = clean(barChart([{ label: 'May', v: 40 }, { label: 'Jun', v: -15 }, { label: 'Jul', v: null }], v => v + '%', 'Savings rate'));
    expect(s.match(/class="bar /g)).toHaveLength(1);
    expect(s).toContain('class="bar neg"');
    expect(s).toContain('Jul · no income');
  });
  it('copes with every month at zero', () => { clean(barChart([{ label: 'A', v: 0 }, { label: 'B', v: 0 }], v => v + '%', 'x')); });
});

describe('sparkBars', () => {
  it('marks the last month and survives all zeros', () => {
    expect(clean(sparkBars([5, 10, 0, 20], 20))).toContain('class="bar now"');
    clean(sparkBars([0, 0, 0], 0));
  });
});
