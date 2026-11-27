import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('app/assets/money.css', 'utf8');
const rule = (sel: string) => css.split('\n').find(l => l.trim().startsWith(sel + ' {')) || '';

describe('radius scale', () => {
  it('defines the shapes once, on the 4px scale', () => {
    const m = css.match(/--r-xs: (\d+)px; --r-sm: (\d+)px; --r-md: (\d+)px; --r-lg: (\d+)px; --r-xl: (\d+)px; --r-pill: 999px;/);
    expect(m).not.toBeNull();
    const v = m!.slice(1).map(Number);
    expect(v).toEqual([...v].sort((a, b) => a - b));
    for (const n of v.slice(1)) expect(n % 4).toBe(0);
  });
  it('uses only the tokens for rounded corners outside the per-theme rules', () => {
    const bad: string[] = [];
    let theme = false;
    css.split('\n').forEach((line, i) => {
      if (line.includes('{')) {
        const sel = line.split('{')[0].trim();
        if (sel && !sel.startsWith('@')) theme = sel.includes('data-theme') && !sel.includes('html[data-theme]');
      }
      if (theme) return;
      for (const m of line.matchAll(/border-radius: *([^;}]+)/g)) {
        for (const n of m[1].matchAll(/(?<![\w.-])(\d+)px/g)) if (Number(n[1]) > 4) bad.push(`money.css:${i + 1} ${m[0]}`);
      }
    });
    expect(bad).toEqual([]);
  });
  it('keeps controls concentric with the segmented control they sit in', () => {
    expect(rule('.seg')).toContain('border-radius: var(--r-lg); padding: 4px');
    expect(rule('.seg button')).toContain('border-radius: var(--r-md)');
  });
});

describe('card padding and gap tokens', () => {
  it('uses --card-pad and --card-gap for the small card kinds too', () => {
    expect(rule('.kpi')).toContain('padding: 16px var(--card-pad)');
    expect(css).not.toMatch(/\.kpis \{[^}]*gap: 12px/);
    expect(css).not.toMatch(/\.kpi \{ padding: 12px 16px/);
    expect(rule('.kpis')).toContain('gap: var(--card-gap)');
    expect(rule('.extra')).toContain('padding: 16px var(--card-pad); margin-top: var(--card-gap)');
    expect(rule('.split')).toContain('padding: var(--card-pad) var(--card-pad) 4px; margin-bottom: var(--card-gap)');
    expect(rule('.error')).toContain('padding: 16px var(--card-pad)');
    expect(rule('.cards .w')).toContain('margin-bottom: var(--card-gap)');
    expect(rule('.dash-bar')).toContain('margin-bottom: var(--card-gap)');
  });
});
