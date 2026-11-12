import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEMES, THEME_GROUPS, themeButtons } from '../app/src/core/themepick';
import { activityDays, activityPanel } from '../app/src/features/charts';

const css = readFileSync('app/assets/money.css', 'utf8');
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
};
const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
const PASTEL = ['sakura', 'mint', 'lavender', 'peach', 'sky', 'butter'];
const block = (k: string) => { const at = css.indexOf('html[data-theme="' + k + '"] { --bg: #'); return css.slice(at, css.indexOf('}', at)); };
const v = (b: string, name: string) => new RegExp('--' + name + ': (#[0-9a-f]{6})', 'i').exec(b)![1].toLowerCase();

describe('Pastel themes', () => {
  it('has 20 themes plus Auto and the picker groups every one of them once', () => {
    expect(THEMES).toHaveLength(21);
    const grouped = THEME_GROUPS.flatMap(g => g[1].map(x => x[0]));
    expect(new Set(grouped).size).toBe(21);
    expect([...grouped].sort()).toEqual(THEMES.map(t => t[0]).sort());
    expect(THEME_GROUPS.map(g => g[0])).toEqual(['Calm', 'Pastel', 'Bold', 'Glass']);
  });
  it('uses the agreed page, card and accent colours', () => {
    const want: Record<string, string[]> = { sakura: ['#fff5f7', '#e8a0b4'], mint: ['#f2fbf6', '#8fd3b0'], lavender: ['#f6f3fd', '#b7a6e8'], peach: ['#fff6ef', '#f4b393'], sky: ['#f1f7fd', '#9cc6ee'], butter: ['#fbfaee', '#a9c7a0'] };
    for (const k of PASTEL) {
      const b = block(k);
      expect(v(b, 'bg')).toBe(want[k][0]);
      expect(v(b, 'panel')).toBe('#ffffff');
      expect(v(b, 'income')).toBe(want[k][1]);
    }
  });
  it('keeps text, buttons and amounts at 4.5:1 on the page, the cards and the tinted rows', () => {
    for (const k of PASTEL) {
      const b = block(k), bg = v(b, 'bg'), faint = v(b, 'faint');
      for (const surface of [bg, '#ffffff', faint]) {
        for (const c of ['text', 'muted', 'accent', 'good-t', 'spend-t', 'warn-t']) expect(ratio(v(b, c), surface), k + ' ' + c + ' on ' + surface).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(v(b, 'on-accent'), v(b, 'accent')), k + ' button label').toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('Spatial glass theme', () => {
  const b = block('spatial');
  it('is in the Glass group with a swatch', () => {
    expect(THEME_GROUPS.find(g => g[0] === 'Glass')![1].map(x => x[0])).toContain('spatial');
    expect(THEMES.find(t => t[0] === 'spatial')![2]).toContain('#9ac6ff');
  });
  it('keeps text, muted text and the accent at 4.5:1 on the page and on the brightest card glass', () => {
    for (const surface of [v(b, 'bg'), '#444e5c']) {
      for (const c of ['text', 'muted', 'accent', 'good', 'spend', 'warn']) expect(ratio(v(b, c), surface), c + ' on ' + surface).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(v(b, 'on-accent'), v(b, 'accent'))).toBeGreaterThanOrEqual(4.5);
  });
  it('uses 24px corners, glass cards, a floating tab bar and a backdrop drawn in CSS only', () => {
    expect(b).toContain('--radius: 24px');
    expect(css).toMatch(/html\[data-theme="spatial"\] body::after \{[^}]*radial-gradient/);
    expect(css).not.toMatch(/html\[data-theme="spatial"\][^{]*\{[^}]*url\(/);
    expect(css).toMatch(/html\[data-theme="spatial"\] \.tabbar \{[^}]*backdrop-filter: blur/);
    expect(css).toMatch(/html\[data-theme="spatial"\] :is\(\.panel[^{]*\{[^}]*border-radius: 24px/);
  });
});

describe('Matte glass theme', () => {
  const b = block('matte');
  it('is in the Glass group with a Storm Grey, Matte Black and Safety Orange swatch', () => {
    expect(THEME_GROUPS.find(g => g[0] === 'Glass')![1].map(x => x[0])).toContain('matte');
    const sw = THEMES.find(t => t[0] === 'matte')![2];
    for (const c of ['#3a3f47', '#14151a', '#ff5f00']) expect(sw).toContain(c);
    expect(v(b, 'accent')).toBe('#ff5f00');
  });
  it('keeps text, muted text and the orange accent at 4.5:1 on the page and on the card glass', () => {
    const card = (bg: string) => { const a = .72, base = [14, 15, 17], px = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16)); return '#' + px.map((x, i) => Math.round(base[i] * a + x * (1 - a)).toString(16).padStart(2, '0')).join(''); };
    for (const surface of [v(b, 'bg'), '#2a2d33', card('#2a2d33')]) {
      for (const c of ['text', 'muted', 'accent', 'good', 'spend', 'warn']) expect(ratio(v(b, c), surface), c + ' on ' + surface).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(v(b, 'on-accent'), v(b, 'accent'))).toBeGreaterThanOrEqual(4.5);
  });
  it('is matte: stacked cards, modest blur, CSS-only backdrop, no blur under cards', () => {
    expect(css).toMatch(/html\[data-theme="matte"\] :is\(\.panel[^{]*\{[^}]*var\(--stack\)/);
    expect(css).toMatch(/html\[data-theme="matte"\] body::after \{[^}]*radial-gradient/);
    expect(css).not.toMatch(/html\[data-theme="matte"\][^{]*\{[^}]*url\(/);
    expect(css).toMatch(/html\[data-theme="matte"\] \.tabbar \{[^}]*backdrop-filter: blur\(\d+px\)/);
    expect(css).toMatch(/\[data-theme="matte"\]\) :is\(\.panel[^{]*\{ -webkit-backdrop-filter: none/);
  });
});

describe('Theme picker', () => {
  it('is one radio group with a single tab stop and a swatch and name for every theme', () => {
    document.documentElement.setAttribute('data-theme', 'mint');
    const host = document.createElement('div'); host.innerHTML = String(themeButtons()); document.body.append(host);
    expect(host.querySelector('[role=radiogroup]')).not.toBeNull();
    const radios = [...host.querySelectorAll<HTMLElement>('[role=radio]')];
    expect(radios).toHaveLength(21);
    expect(radios.filter(r => r.tabIndex === 0)).toHaveLength(1);
    expect(radios.filter(r => r.getAttribute('aria-checked') === 'true').map(r => r.getAttribute('aria-label'))).toEqual(['Mint Cream']);
    for (const r of radios) { expect(r.querySelector('.tp-sw')).not.toBeNull(); expect(r.querySelector('.tp-name')!.textContent).not.toBe(''); }
    host.remove(); document.documentElement.removeAttribute('data-theme');
  });
  it('moves between themes with the arrow keys', () => {
    const host = document.createElement('div'); host.innerHTML = String(themeButtons()); document.body.append(host);
    const first = host.querySelector<HTMLElement>('.tp')!; first.focus();
    const clicked: string[] = []; host.addEventListener('click', e => clicked.push((e.target as HTMLElement).closest('.tp')!.getAttribute('data-onclick')!));
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(clicked).toEqual(["App.setTheme('light')"]);
    host.remove();
  });
  it('keeps the chips 44px tall and two to a row at 320px', () => {
    expect(css).toMatch(/\.tp \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.tp-grid \{[^}]*minmax\(min\(100%, 138px\), 1fr\)/);
  });
});

describe('Activity grid', () => {
  const buys = [['2026-11-01', 5], ['2026-11-02', 10], ['2026-11-03', 20], ['2026-11-04', 40], ['2026-11-04', 40], ['2026-11-06', 400]].map(([date, amount]) => ({ date: date as string, amount: amount as number }));
  it('adds up each day and ranks the days with spending in four levels', () => {
    const days = activityDays(buys, '2026-11-01', '2026-11-30', '2026-11-07');
    expect(days).toHaveLength(7);
    expect(days.map(d => d.level)).toEqual([1, 2, 3, 4, 0, 4, 0].map((l, i) => i === 3 ? 4 : l).map((l, i) => days[i].v ? Math.max(l, 1) : 0));
    expect(days[3]).toMatchObject({ v: 80, n: 2 });
    expect(days[4].level).toBe(0);
    expect(Math.max(...days.map(d => d.level))).toBe(4);
  });
  it('stops at today and at 53 weeks', () => {
    const days = activityDays([], '2024-01-01', '2026-12-31', '2026-11-07');
    expect(days).toHaveLength(53 * 7);
    expect(days[days.length - 1].iso).toBe('2026-11-07');
    expect(activityDays(buys, '2027-01-01', '2027-02-01', '2026-11-07')).toEqual([]);
  });
  it('draws weeks as columns with a table and a summary for screen readers, and nothing without data', () => {
    expect(String(activityPanel([], '2026-11-01', '2026-11-30'))).toBe('');
    const h = String(activityPanel(buys, '2026-11-01', '2026-11-30'));
    expect(h).toContain('role="img"');
    expect(h).toContain('class="sr-only"');
    expect(h).toContain('data-tip="');
    expect(css).toMatch(/\.ag-grid \{[^}]*grid-auto-flow: column[^}]*repeat\(7, auto\)/);
    expect(css).toMatch(/\.ag-grid \{[^}]*grid-auto-columns: var\(--agm\)/);
    expect(css).toMatch(/\.ag-wrap \{[^}]*margin-right: auto/);
    expect(css).toMatch(/\.ag-scroll \{[^}]*display: flex; flex-direction: row-reverse; overflow-x: auto/);
  });
  it('shows levels in every theme from the theme’s own colours', () => {
    for (const l of ['l1', 'l2', 'l3', 'l4']) expect(css).toContain('.ag-c.' + l);
    expect(css).toContain('html { --ag: var(--spend); }');
    for (const k of PASTEL) expect(block(k)).toContain('--ag:');
  });
});
