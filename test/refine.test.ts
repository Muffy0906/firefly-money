import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { nearestIndex } from '../app/src/features/refine';

const css = readFileSync('app/assets/money.css', 'utf8');
const block = css.slice(css.indexOf('/* ================= Refinements'));

describe('bundled variable font', () => {
  it('ships the font file and its licence with the app', () => {
    expect(readdirSync('app/assets/fonts')).toEqual(expect.arrayContaining(['inter-latin-var.woff2', 'Inter-LICENSE.txt']));
  });
  it('loads it from the app itself, never a font host', () => {
    expect(block).toContain('src: url("fonts/inter-latin-var.woff2")');
    expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com|@import url\(/);
    expect(readFileSync('app/index.html', 'utf8')).toContain('<link rel="preload" href="/assets/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin>');
  });
  it('keeps numbers tabular and labels no smaller than 10.5px', () => {
    expect(block).toMatch(/\.num \{ font-variant-numeric: tabular-nums/);
    expect(block).toContain('.eyebrow { font-size: 11px;');
  });
  it('is copied into the demo build', () => {
    expect(readFileSync('build.mjs', 'utf8')).toContain("cpSync('app/assets/fonts', 'site/assets/fonts'");
  });
});

describe('elevation scale', () => {
  it('defines three levels and uses them on popovers and modals', () => {
    for (const t of ['--e1:', '--e2:', '--e3:']) expect(block).toContain(t);
    expect(block).toMatch(/:is\(\.calpop, \.pickpop, \.tip\) \{ box-shadow: var\(--hi\), var\(--e2\)/);
    expect(block).toMatch(/:is\(dialog, \.palette-box\) \{ box-shadow: var\(--hi\), var\(--e3\)/);
  });
});

describe('spring sheets', () => {
  it('settles the drawer without overshoot and nothing overshoots', () => {
    expect(block).toMatch(/--ease-settle: linear\(0, [^)]*1\)/);
    expect(block).not.toMatch(/--ease-settle: linear\([^)]*1\.0\d/);
    expect(block).toMatch(/@media \(max-width: 700px\) \{ \.drawer \{ transition-timing-function: var\(--ease-spring\)/);
    expect(block).toMatch(/\.drawer \{ transition-duration: \.3s/);
  });
  it('still stops all motion when reduced motion is asked for', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important; \} \}/);
  });
});

describe('chart scrubbing', () => {
  it('picks the nearest point to the finger', () => {
    expect(nearestIndex([10, 50, 90], 12)).toBe(0);
    expect(nearestIndex([10, 50, 90], 71)).toBe(2);
    expect(nearestIndex([10, 50, 90], 1000)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });
  it('lets a vertical swipe on a chart still scroll', () => {
    expect(block).toContain('.lines { touch-action: pan-y; }');
  });
});
