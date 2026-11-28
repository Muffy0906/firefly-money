import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/assets/money.css', 'utf8');
const prefs = readFileSync('app/src/features/prefs.ts', 'utf8');

describe('Sidebar fold: the page resizes with the rail', () => {
  it('animates the grid column and the rail on one duration and easing', () => {
    expect(css).toContain('.app { transition: grid-template-columns .34s var(--ease-glide); }');
    expect(css).toContain('.side { transition: padding .34s var(--ease-glide); }');
  });
  it('does not freeze the page at a fixed width during the fold', () => {
    expect(css).not.toContain('--glide-w');
    expect(prefs).not.toContain('--glide-w');
    expect(css).not.toMatch(/side-glide main#view/);
  });
  it('skips the slide for reduced motion and clears the clip after it', () => {
    expect(prefs).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(prefs).toContain("root.classList.remove('side-glide')");
  });
});
