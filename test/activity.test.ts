import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACTIVITY_RANGES, activityCell, activityDays, activityPanel, activityRange } from '../app/src/features/charts';
import { TILE_OPTS, tileOpt } from '../app/src/features/dashboard';

const css = readFileSync('app/assets/money.css', 'utf8');
const reports = readFileSync('app/src/pages/reports.ts', 'utf8');
const buys = [{ date: '2026-11-03', amount: 20 }, { date: '2026-02-10', amount: 5 }];

describe('Overview activity grid', () => {
  it('ranges end today and start 1, 3, 6 months back, the year start, or the first purchase', () => {
    expect(activityRange('1m', '2026-11-07', '')).toEqual({ start: '2026-10-08', end: '2026-11-07' });
    expect(activityRange('3m', '2026-11-07', '').start).toBe('2026-08-08');
    expect(activityRange('6m', '2026-11-07', '').start).toBe('2026-05-08');
    expect(activityRange('year', '2026-11-07', '').start).toBe('2026-01-01');
    expect(activityRange('all', '2026-11-07', '2019-04-02').start).toBe('2019-04-02');
  });
  it('defaults to this year and offers 1M to all history', () => {
    expect(tileOpt('activity', 'range')).toBe('year');
    expect(TILE_OPTS.activity[0].options).toEqual(Object.keys(ACTIVITY_RANGES));
  });
  it('lifts the 53-week cap for the tile so all history shows', () => {
    expect(activityDays(buys, '2019-01-01', '2026-11-07', '2026-11-07').length).toBe(371);
    expect(activityDays(buys, '2019-01-01', '2026-11-07', '2026-11-07', 2000).length).toBe(2868);
  });
  it('the tile has no range chips (the range is set in Customize) and has no legend row and keeps the table alternative', () => {
    const h = String(activityPanel(buys, '2026-10-08', '2026-11-07', { range: '1m' }));
    expect(h).not.toContain('aria-pressed');
    expect(h).not.toContain('ag-range');
    expect(h).not.toContain('ag-legend');
    expect(h).not.toContain('ag-head');
    expect(h).not.toContain('Less');
    expect(h).not.toContain('Show as table');
    expect(h).not.toContain('<h2>Activity</h2>');
    expect(h).toContain('class="sr-only"');
    expect(h).toContain('role="img" aria-label="Spending each day');
    expect(h).toContain('--agm:14px');
    expect(activityCell(5)).toBe(activityCell(53));
  });
  it('labels carry the year on the first label and each January, and never crowd each other', () => {
    const h = String(activityPanel(buys, '2024-11-10', '2026-11-07', { range: 'all' }));
    const m = h.match(/<div class="ag-months"[^>]*>(.*?)<\/div>/)![1];
    const labels = [...m.matchAll(/grid-column:(\d+) \/ span 3">([^<]+)</g)].map(x => [+x[1], x[2]] as const);
    expect(labels[0][1]).toMatch(/\d{4}$/);
    labels.forEach(([, t], i) => { if (i && t.startsWith('Jan')) expect(t).toMatch(/2025|2026/); else if (i) expect(t).not.toMatch(/\d/); });
    labels.slice(1).forEach(([c], i) => expect(c - labels[i][0]).toBeGreaterThanOrEqual(4));
    expect(h).toMatch(/data-tip="[^"]*, 20\d\d/);
  });
  it('an empty range says so, without chips', () => {
    expect(String(activityPanel([], '2026-10-08', '2026-11-07', { range: '1m' }))).toContain('No spending in this range');
  });
  it('is on the Overview by default and never uses saved data', () => {
    const o = readFileSync('app/src/pages/overview.ts', 'utf8');
    expect(readFileSync('app/src/features/dashboard.ts', 'utf8')).toMatch(/DASH_DEFAULT = \[[^\]]*'activity'/);
    expect(o).toContain('Firefly isn’t answering');
  });
});

describe('Reports layout', () => {
  it('has a gap under the activity grid and keeps the share cards in the justified flow', () => {
    expect(css).toMatch(/\.report-gap:not\(:empty\) \{ margin-bottom: 20px/);
    expect(reports).toContain('<div class="flow report-cols">');
    expect(reports).toContain('class="report-gap"');
  });
  it('every range has the same fixed-height grid, so changing the range in settings shifts nothing', () => {
    expect(css).toMatch(/\.ag-scroll \{ height: 150px; margin: -6px;/);
    expect(css).toMatch(/\.ag-scroll \{[^}]*padding: 6px/);
    expect(css).toMatch(/\.ag-none \{ height: 138px/);
    expect(css).toMatch(/\.panel\.ag-card \{ padding: 16px/);
    for (const r of ['1m', 'year', 'all']) expect(String(activityPanel(buys, '2019-01-01', '2026-11-07', { range: r }))).toContain('--agm:14px');
  });
  it('a range change in settings redraws only the Activity card, not the page', () => {
    const dash = readFileSync('app/src/features/dashboard.ts', 'utf8'), ov = readFileSync('app/src/pages/overview.ts', 'utf8');
    expect(dash).toMatch(/k === 'activity' && App\.activityRedraw/);
    expect(ov).toMatch(/sec\.replaceWith\(next\)/);
    expect(ov).toMatch(/const methods = \{ attMore, activityRedraw, nwRedraw \}/);
  });
});

describe('Overview scroller side room', () => {
  it('the page scroller leaves room for card shadows on both sides (desktop 40px, phones 16px)', () => {
    expect(css).toMatch(/#view > \.pg \{[^}]*margin-inline: calc\(-1 \* var\(--pg-side, 40px\)\); padding: var\(--head-gap\) var\(--pg-side, 40px\) var\(--pb\)/);
    expect(css).toMatch(/max-width: 900px\) \{ #view > \.pg \{ --pg-side: 16px/);
  });
});
