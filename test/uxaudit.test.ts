import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/assets/money.css', 'utf8');


describe('UI UX Pro Max audit fixes', () => {
  it('gives small buttons, search and Timeline links a 44px tap area on touch screens', () => {
    const block = css.slice(css.indexOf('@media (pointer: coarse)'));
    for (const sel of ['.btn.small', '.tl-go', '.search-btn']) expect(block).toContain(sel + '::after');
    expect(block).toMatch(/width: max\(100%, 44px\); height: max\(100%, 44px\)/);
    expect(block).toContain('.search-btn { position: fixed; }');
  });
  it('keeps the budget and tag hints at full muted contrast, with no faded copy under 4.5:1', () => {
    expect(css).not.toMatch(/\.bud-s, \.tag-s \{[^}]*opacity/);
  });
  it('keeps small text at 10.5px or more', () => {
    expect(css).toContain('.av.sm { width: 26px; height: 26px; font-size: 11px; }');
    expect(css).not.toContain('.eyebrow { font-size: 9.5px; }');
  });
});

describe('Motion fluidity', () => {
  it('uses shared decelerating easing for page, card, drawer and press motion', () => {
    expect(css).toContain('--ease-out: cubic-bezier(.2, .8, .2, 1)');
    expect(css).toContain('#view.enter > * { animation: fadeUp .26s var(--ease-out) both; }');
    expect(css).toContain('transform .3s var(--ease-glide)');
    expect(css).toMatch(/\.btn, \.round[^}]*transform \.18s var\(--ease-out\)/);
    expect(css).not.toMatch(/\.drawer \{[^}]*transition: transform \.2\d?s ease;/);
  });
  it('keeps the global reduced-motion kill switch', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important; \} \}/);
  });
});

describe('Motion polish', () => {
  it('slides the skeleton shimmer with a transform, not background-position', () => {
    expect(css).toContain('@keyframes shimmerX { to { transform: translateX(100%); } }');
    expect(css).toMatch(/\.sk::after \{[^}]*animation: shimmerX/);
    expect(css).not.toMatch(/\.sk \{[^}]*animation: shimmer /);
  });
  it('gives dialogs a spring only when linear() easing and motion are allowed', () => {
    expect(css).toMatch(/@supports \(animation-timing-function: linear\(0, 1\)\) \{ @media \(prefers-reduced-motion: no-preference\) \{ dialog:not\(\.whatsnew\)\[open\] \{ animation: wn-in \.26s var\(--ease-spring\)/);
  });
  it('shares one hover duration token and gives donut segments press feedback', () => {
    expect(css).toContain('--t-hover: .14s');
    expect(css).toContain('.donut .seg:active');
    expect(css).not.toMatch(/transition:[^;}]* \.1[25]s[,;]/);
  });
});

describe('Pre-release audit: contrast and labels', () => {
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  it('keeps text colours at 4.5:1 on their surface in the themes that were short', () => {
    expect(ratio('#a85a38', '#f6f5f1')).toBeGreaterThanOrEqual(4.5);   // Calm light spend
    expect(ratio('#4f7260', '#f6f5f1')).toBeGreaterThanOrEqual(4.5);   // Calm light good
    expect(ratio('#ffffff', '#6d4cf5')).toBeGreaterThanOrEqual(4.5);   // Midnight accent
    expect(ratio('#d99278', '#2e3440')).toBeGreaterThanOrEqual(4.5);   // Nord spend
    expect(ratio('#ff5c95', '#2a2a30')).toBeGreaterThanOrEqual(4.5);   // Carbon spend
    expect(ratio('#ffffff', '#c9431d')).toBeGreaterThanOrEqual(4.5);   // Frosted accent
    for (const c of ['#a85a38', '#4f7260', '#6d4cf5', '#d99278', '#ff5c95', '#c9431d', '#4b4037']) expect(css).toContain(c);
  });
  it('labels every Forecast field for screen readers', () => {
    const src = readFileSync('app/src/pages/forecast.ts', 'utf8');
    for (const f of ['name="label"', 'name="sign"', 'name="amount"', 'name="date"', 'name="repeat"', "fcSet('account'", "fcSet('days'", 'App.fcBuffer']) {
      const tag = src.slice(src.lastIndexOf('<', src.indexOf(f)), src.indexOf('>', src.indexOf(f)));
      expect(tag, f).toContain('aria-label=');
    }
  });
});

describe('Pre-release audit: gateway', () => {
  it('rate-limits the unauthenticated logo and map-tile proxies', () => {
    const conf = readFileSync('app/default.conf.template', 'utf8');
    for (const loc of ['location ~ "^/logo/', 'location ~ "^/tile/']) {
      const at = conf.indexOf(loc);
      expect(conf.slice(at, conf.indexOf('\n    }', at))).toContain('limit_req zone=api');
    }
  });
});

describe('Money flow table alternative', () => {
  it('offers the chart figures as a toggleable table under the chart', () => {
    const src = readFileSync('app/src/features/charts.ts', 'utf8');
    expect(src).toContain('${skTable(d)}</section>');
    expect(src).toContain('<details class="sk-table"><summary>Show as table</summary>');
    expect(css).toContain('.sk-table summary:focus-visible');
  });
});

describe('calm motion for a money app', () => {
  it('never overshoots: no cubic-bezier above 1 and no linear() spring above 1', () => {
    for (const m of css.matchAll(/cubic-bezier\(([^)]*)\)/g)) { const v = m[1].split(',').map(Number); expect(v[1] <= 1 && v[3] <= 1, m[0]).toBe(true); }
    for (const m of css.matchAll(/--ease-[a-z]+: linear\(([^)]*)\)/g)) for (const n of m[1].split(',').map(x => parseFloat(x))) expect(n <= 1, m[0]).toBe(true);
  });
  it('keeps the sheet, dialog, tab bar and toast motion fast (<= 300ms)', () => {
    expect(css).not.toMatch(/\.drawer \{ transition-duration: \.5s/);
    expect(css).not.toMatch(/transform \.42s cubic-bezier\(\.3, 1/);
    expect(css).toMatch(/dialog\.whatsnew\[open\] \{ display: flex; animation: wn-in \.26s/);
  });
});
