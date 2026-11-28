import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MODES, THEMES } from '../app/src/core/themepick';

/* True liquid glass: registered like the other glass looks, text stays at 4.5:1 over the strongest light in both the light and
   the dark tone, the floating glass is the only thing that blurs, and the SVG lens is opt-in (Chromium) with solid fallbacks. */
const css = readFileSync('app/assets/money.css', 'utf8');
const src = readFileSync('app/src/core/lens.ts', 'utf8');
const start = css.indexOf('/* ---------- Theme: True liquid glass'), end = css.indexOf('html[data-theme="sakura"] .panel,html');
const theme = css.slice(start, end), bare = theme.replace(/\/\*[\s\S]*?\*\//g, '');
type RGB = [number, number, number];
const hex = (v: string): RGB => [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)) as RGB;
const lum = (c: RGB) => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a: RGB, b: RGB) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const mix = (top: RGB, under: RGB, a: number): RGB => top.map((v, i) => v * a + under[i] * (1 - a)) as RGB;
const vars = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+): ([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const lightBody = theme.slice(theme.indexOf('html[data-theme="liquid"] {'), theme.indexOf('@media (prefers-color-scheme: dark)'));
const darkBody = theme.slice(theme.indexOf('@media (prefers-color-scheme: dark)'), theme.indexOf('html[data-theme="liquid"] body {'));
const light = vars(lightBody), dark = { ...light, ...vars(darkBody) };

describe('True liquid glass: registration', () => {
  it('is in the picker and the glass group with a glass swatch', () => {
    expect(MODES.map(x => x[0])).toContain('liquid');
    expect(THEMES.find(t => t[0] === 'liquid')![2]).toContain('radial-gradient');
  });
  it('is hooked into the colour customiser like the other glass looks', () => {
    expect(readFileSync('app/src/core/themevars.ts', 'utf8')).toContain("t !== 'liquid'");
    expect(readFileSync('app/src/pages/settings.ts', 'utf8')).toContain("t === 'liquid'");
  });
});

describe('True liquid glass: legibility', () => {
  for (const [tone, v] of [['light', light], ['dark', dark]] as const) {
    it(tone + ': text, muted text, accent text and amounts read on the page, the flat cards and the glass', () => {
      const bg = hex(v['--bg']), panel = hex(v['--panel']), base = hex(v['--glass-base']), tint = parseFloat(v['--glass-tint']) / 100;
      // the glass over the page, over the page wash at its strongest, and the sheet fill (74%) over the page
      const wash = (['--glow1', '--glow2', '--glow3'] as const).map(k => mix(hex(v[k]), bg, .38));
      const sheet = tone === 'light' ? [255, 255, 255] as RGB : [44, 44, 48] as RGB;
      const surfaces = [bg, panel, ...wash, mix(base, bg, tint), ...wash.map(w => mix(base, w, tint)), mix(sheet, bg, .74), ...wash.map(w => mix(sheet, w, .74))];
      const bad: string[] = [];
      for (const s of surfaces) for (const c of ['--text', '--muted', '--accent', '--good-t', '--spend-t', '--warn-t']) {
        const r = ratio(hex(v[c]), s); if (r < 4.5) bad.push(`${c} ${r.toFixed(2)} on ${tone} ${s.map(Math.round)}`);
      }
      expect(bad).toEqual([]);
      expect(ratio(hex(v['--on-accent']), hex(v['--accent']))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('True liquid glass: how it is built', () => {
  it('draws only a faint wash behind the page in CSS and loads no image', () => {
    expect(theme).toMatch(/html\[data-theme="liquid"\] body::after \{[^}]*radial-gradient/);
    expect(bare).not.toMatch(/url\((?!#)/);
  });
  it('keeps cards flat and solid, and makes controls, the tab bar and sheets the glass', () => {
    expect(theme).toMatch(/\.dash-bar\) \{\s*background: var\(--panel\);[^}]*backdrop-filter: none/);
    for (const sel of ['.btn', '.round', '.seg']) expect(bare).toMatch(new RegExp('liquid"\\] :is\\([^)]*\\' + sel + '[^)]*\\) \\{[^}]*backdrop-filter: var\\(--lg-ctl-filter\\)'));
    expect(bare).toMatch(/:is\(\.tabbar, \.side, \.drawer, dialog[^)]*\.toast\) \{[^}]*backdrop-filter: var\(--lg-sheet-filter\)/);
    expect(light['--lg-rim']).toMatch(/inset 0 1px 0 rgba\(255, 255, 255, \.9/);        // a bright catch-light on the top edge
    expect(light['--lg-rim']).toMatch(/inset 0 -1px 1px rgba\(0, 0, 0/);                  // a faint dark bevel on the bottom edge
    expect(light['--lg-drop']).toContain(',');                                           // layered shadow
  });
  it('fakes the edge refraction with a brighter, more saturated band inside the rim, in WebKit-safe CSS', () => {
    expect(bare).toMatch(/\)::before \{[^}]*-webkit-backdrop-filter: var\(--lg-edge\)[^}]*-webkit-mask-composite: xor/);
    expect(light['--lg-edge']).toMatch(/saturate\(2\d\d%\) brightness\(1\.\d+\)/);
  });
  it('reuses the shared tokens and keeps the shapes round', () => {
    for (const t of ['--glass-blur', '--glass-tint', '--radius']) expect(light[t]).toBeDefined();
    expect(theme).toContain('border-radius: var(--r-xl)');
    expect(theme).toContain('var(--radius)');
    expect(theme).not.toMatch(/border-radius: *\d/);
  });
  it('follows the system light or dark tone', () => {
    expect(theme).toContain('@media (prefers-color-scheme: dark)');
    expect(dark['--bg']).not.toBe(light['--bg']);
  });
  it('bends light with the SVG lens only when the attribute says the browser can, and stays solid otherwise', () => {
    expect(theme).toMatch(/\[data-lens="svg"\] \.lg-lensed::before \{[^}]*backdrop-filter: var\(--lg-url\) var\(--lg-lens\)/);
    expect(theme).not.toMatch(/html\[data-theme="liquid"\] :is\([^{]*\{[^}]*--lg-url/);   // never without the opt-in attribute
    expect(theme).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(theme).toContain('@supports not');
    expect(theme).toMatch(/--lg-solid: #[0-9a-f]{6}/i);
  });
  it('the lens is Chromium-only, needs no network and builds its filter with DOM calls', () => {
    expect(src).toContain("'Chromium'");
    expect(src).toContain('feDisplacementMap');
    expect(src).toContain('Snell');
    expect(src).not.toMatch(/fetch\(|https:|innerHTML|insertAdjacentHTML/);
    expect(src).toContain("'liquid'");
  });
  it('springs on press and on the tab pill, and stops when motion is reduced', () => {
    expect(theme).toMatch(/--ease-spring: cubic-bezier\(/);
    expect(theme).toMatch(/\.tab-pill \{ transition: transform \.5s var\(--ease-spring\)/);
    expect(theme).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*:active \{ transform: none/);
  });
});

describe('True liquid glass: folding tab bar', () => {
  it('shrinks to a circle holding the current tab, like Apple Music, and the + stays as a glass circle', () => {
    expect(theme).toMatch(/\.tabbar\.mini \{[^}]*opacity: 1; visibility: visible[^}]*right: calc\(100vw - 70px\)/);
    expect(theme).toMatch(/\.tabbar\.mini > :is\(a, button\)\.on \{[^}]*width: 56px; height: 56px/);
    expect(theme).toMatch(/\.tabbar\.mini > :not\(\.on\) \{[^}]*opacity: 0/);
    expect(theme).toMatch(/liquid"\] \.fab \{[^}]*backdrop-filter: var\(--lg-filter\)/);
  });
  it('the selected tab is a darker capsule inside the bar', () => {
    expect(dark['--lg-pillfill']).toMatch(/rgba\(0, 0, 0, \.3/);
  });
});

describe('True liquid glass: lens profile', () => {
  it('pulls hardest at the outer edge and eases to nothing where the bezel goes flat', async () => {
    const { profile } = await import('../app/src/core/lens');
    const p = profile();
    expect(p).toHaveLength(127);
    expect(Math.max(...p)).toBeCloseTo(1, 5);
    expect(p[0]).toBeGreaterThan(p[60]);
    expect(p[126]).toBeLessThan(.2);
    expect(p.every(v => v >= 0 && v <= 1)).toBe(true);
  });
});
