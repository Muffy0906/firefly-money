import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('app/assets/money.css', 'utf8');

describe('spacing scale', () => {
  it('does not add padding, margin or gap values off the 4px grid (1, 2 and 6px hairlines aside)', () => {
    // The 18 below are old one-offs (optical nudges, hit-area growth); a new value should be a multiple of 4
    const off: string[] = [];
    for (const m of css.matchAll(/(?<![-\w])(padding|margin|gap|row-gap|column-gap)(-(?:top|right|bottom|left|inline|block))?\s*:\s*([^;}]+)/g))
      for (const v of m[3].matchAll(/(?<![\w.])(-?\d*\.?\d+)px/g)) { const f = Math.abs(parseFloat(v[1])); if (f % 4 && ![1, 2, 6].includes(f)) off.push(m[1] + ' ' + v[1]); }
    expect(off.length).toBeLessThanOrEqual(18);
  });
  it('card inset: 24px desktop, 20px phone, 16px on a 320 phone', () => {
    expect(css).toContain(':root { --card-pad: 24px; --card-gap: 20px; }');
    expect(css).toMatch(/@media \(max-width: 900px\) \{ :root \{ --card-pad: 20px; \} \}/);
    expect(css).toMatch(/@media \(max-width: 360px\) \{ :root \{ --card-pad: 16px; \} \}/);
  });
});

describe('edge-to-edge rows inside a card', () => {
  it('keep 16px from the card edge on a phone (12px on a 320 phone), not the old 8px', () => {
    expect(css).toContain('.panel.flush .tbl:not(.feed) :is(th, td):first-child { padding-left: 16px; }');
    expect(css).toContain('.panel.flush .tbl:not(.feed) :is(th, td):last-child { padding-right: 16px; }');
    expect(css).toContain('.panel.flush .tbl:not(.feed) :is(th, td):first-child { padding-left: 12px; }');
  });
  it('the bills table keeps Pay now and Edit inside the card at 320px', () => {
    expect(css).toContain('.tbl.bills-tbl td:first-child .chip { white-space: normal; }');
    expect(css).toContain('.tbl.bills-tbl .act .btn { padding-inline: 12px; }');
  });
  it('the swipe hint inside a card is inset like the rows, and the last row adds no bottom padding', () => {
    expect(css).toContain('.panel > .swipe-hint { margin: 0; padding: 12px 16px 4px; }');
    expect(css).toContain('.panel > .list > .row:last-child { padding-bottom: 0; }');
  });
  it('the activity heatmap card uses a 4px-grid inset', () => {
    expect(css).toContain('.panel.ag-card { padding: 16px; }');
    expect(css).not.toMatch(/\.panel\.ag-card \{ padding: 10px 12px; \}/);
  });
});

describe('small controls', () => {
  it('checkboxes and radios drop the browser margins so they sit on the grid', () => {
    expect(css).toContain(':is(input[type=checkbox], input[type=radio]) { margin: 0; }');
  });
  it('Pay now beside a bill wraps under it in a narrow tile instead of poking past the card padding', () => {
    expect(css).toContain('@container (max-width: 260px) { .bill-end { flex-wrap: wrap; justify-content: flex-start; row-gap: 8px; } }');
    expect(css).toContain('.w[data-w="bills"] .panel-head { margin-bottom: 16px; }');
  });
});
