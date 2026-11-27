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
    it(tone + ': text, muted text, accent text and amounts read over the brightest light behind a card', () => {
      const bg = hex(v['--bg']), base = hex(v['--glass-base']), tint = parseFloat(v['--glass-tint']) / 100;
      const spots = [bg, ...(['--glow1', '--glow2', '--glow3'] as const).map(k => mix(hex(v[k]), bg, .85))];
      const bad: string[] = [];
      for (const s of spots) {
        const card = mix(base, s, tint), glare = tone === 'light' ? mix([255, 255, 255], card, .22) : card;   // the corner glare is white at up to 22%
        for (const surface of [card, glare]) for (const c of ['--text', '--muted', '--accent', '--good-t', '--spend-t', '--warn-t']) {
          const r = ratio(hex(v[c]), surface); if (r < 4.5) bad.push(`${c} ${r.toFixed(2)} on ${tone} ${surface.map(Math.round)}`);
        }
      }
      expect(bad).toEqual([]);
      expect(ratio(hex(v['--on-accent']), hex(v['--accent']))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('True liquid glass: how it is built', () => {
  it('draws the backdrop in CSS and loads no image', () => {
    expect(theme).toMatch(/html\[data-theme="liquid"\] body::after \{[^}]*radial-gradient/);
    expect(bare).not.toMatch(/url\((?!#)/);
  });
  it('gives cards a light blur and the floating glass the full blur, saturation and rim light', () => {
    expect(theme).toMatch(/\.dash-bar\) \{[^}]*backdrop-filter: var\(--lg-card\)/);
    for (const sel of ['.tabbar', '.side']) expect(theme).toMatch(new RegExp('liquid"\\] \\' + sel + ' \\{[^}]*backdrop-filter: var\\(--lg-filter\\)'));
    expect(light['--lg-filter']).toMatch(/blur\(.*saturate\(/);
    expect(light['--lg-rim']).toContain('inset');          // the specular edge and soft inner light
  });
  it('uses the shared radius tokens and the card padding it inherits', () => {
    expect(theme).toContain('border-radius: var(--radius)');
    expect(theme).toContain('border-radius: var(--r-xl)');
    expect(theme).not.toMatch(/border-radius: *\d/);
  });
  it('follows the system light or dark tone', () => {
    expect(theme).toContain('@media (prefers-color-scheme: dark)');
    expect(dark['--bg']).not.toBe(light['--bg']);
  });
  it('bends light with the SVG lens only when the attribute says the browser can, and stays solid otherwise', () => {
    expect(theme).toMatch(/\[data-lens="svg"\] :is\(\.tabbar[^{]*\{[^}]*backdrop-filter: url\(#lg-bend\) var\(--lg-filter\)/);
    expect(theme).not.toMatch(/html\[data-theme="liquid"\] :is\([^{]*\{[^}]*url\(#lg-bend\)/);   // never without the opt-in attribute
    expect(theme).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(theme).toContain('@supports not');
    expect(theme).toMatch(/--lg-solid: #[0-9a-f]{6}/i);
  });
  it('the lens is Chromium-only and needs no network', () => {
    expect(src).toContain("'Chromium'");
    expect(src).toContain('feDisplacementMap');
    expect(src).not.toMatch(/fetch\(|https:/);
    expect(src).toContain("'liquid'");
  });
  it('the press feel is a calm glide, no bounce', () => {
    expect(theme).toContain('var(--ease-glide)');
    expect(theme).not.toMatch(/cubic-bezier\([^)]*-?\d\.\d+,\s*1\.\d/);
  });
});
