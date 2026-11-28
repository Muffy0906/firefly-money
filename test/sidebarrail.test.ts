import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/assets/money.css', 'utf8');
const dock = readFileSync('app/src/features/dock.ts', 'utf8');

describe('Collapsed sidebar rail', () => {
  it('leaves a 40px icon column (16 margin + 1 border + 8 padding each side)', () => {
    expect(css).toContain('html.side-mini .app { grid-template-columns: 74px 1fr; }');
  });
  it('makes each folded link a 36px circle on a 36px pitch (no gap), and a clipped label cannot widen it', () => {
    expect(css).toMatch(/html\.side-mini \.side \.nav \{ grid-template-columns: minmax\(0, 1fr\); gap: 0; \}/);
    expect(css).toMatch(/html\.side-mini \.side \.nav a \{ padding-left: 9\.5px; padding-right: 0; width: 36px; min-height: 36px; margin-inline: auto; border-radius: 50%; \}/);
  });
  it('centres the panel toggle in the 40px column: margin-right = 20px minus half its (height-clamped) width', () => {
    expect(css).toContain('html.side-mini .side-tg { --tg-w: min(30px, var(--row, 30px)); margin-right: calc(20px - var(--tg-w) / 2); }');
    expect(css).not.toMatch(/html\.side-mini \.side-tg \{ margin-right: 4px/);
  });
  it('zooms only the hovered icon: no proximity dock', () => {
    expect(css).toContain('.side .nav a:hover svg, .side-search:hover svg, .side-tg:hover svg { scale: 1.2; }');
    expect(css).not.toContain('--dock');
    expect(dock).not.toContain('--dock');
  });
});
