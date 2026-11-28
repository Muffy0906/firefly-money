import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/assets/money.css', 'utf8');

describe('motion tokens', () => {
  it('defines shared duration tokens and uses them', () => {
    expect(css).toMatch(/--dur-fast: \.15s; --dur-base: \.25s; --dur-slow: \.35s/);
    expect((css.match(/var\(--dur-(fast|base|slow)\)/g) || []).length).toBeGreaterThan(40);
  });
  it('no transition pairs an ad-hoc duration with a shared easing token', () => {
    expect(css).not.toMatch(/(?:transition|animation):[^;{}]*\s\.(14|15|16|18|2|22|24|25|26|28|3|32|34|35)s var\(--ease-/);
  });
  it('the sheet-open backdrop dims with opacity, not a full-page filter', () => {
    expect(css).toMatch(/html\.shell\.sheet-open #app \{ transform: scale\(\.94\); opacity: \.9; \}/);
    expect(css).not.toMatch(/#app \{[^}]*filter/);
  });
  it('heavy-theme ambient motion pauses during transitions, sheets and scrolling', () => {
    expect(css).toMatch(/\[class\*="vt-"\], \.scrolling, \.sheet-open\)\[data-theme="interstellar"\] #sky/);
    expect(css).toMatch(/\[class\*="vt-"\], \.scrolling, \.sheet-open\)\[data-theme="glass"\] body::after/);
  });
  it('reduced motion still disables every animation and transition', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important; \} \}/);
  });
});
