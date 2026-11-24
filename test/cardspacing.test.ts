import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('app/assets/money.css', 'utf8');
const pageSrc = readdirSync('app/src/pages').map(f => readFileSync('app/src/pages/' + f, 'utf8')).join('\n');
const rule = (sel: string) => css.split('\n').find(l => l.trim().startsWith(sel + ' {')) || '';

describe('card spacing scale', () => {
  it('defines one padding and one gap token on a 4px scale', () => {
    const pad = css.match(/:root \{ --card-pad: (\d+)px; --card-gap: (\d+)px; \}/);
    expect(pad).not.toBeNull();
    expect(Number(pad![1]) % 4).toBe(0);
    expect(Number(pad![2]) % 4).toBe(0);
    expect(css).toMatch(/@media \(max-width: 900px\) \{ :root \{ --card-pad: 20px; \} \}/);
  });
  it('uses the tokens for every card kind', () => {
    for (const sel of ['.panel', '.txsum', '.tl .tl-card.panel', '.mh', '.binsight']) expect(rule(sel), sel).toContain('padding: var(--card-pad)');
    for (const sel of ['.cards > .panel', '.txsum', '.mh']) expect(rule(sel), sel).toContain('margin-bottom: var(--card-gap)');
    expect(rule('.cards')).toContain('column-gap: var(--card-gap)');
    expect(rule('.flow')).toContain('gap: var(--card-gap)');
    expect(rule('.dash-wrap')).toContain('--gap: var(--card-gap)');
  });
  it('has no phone-only padding or gap overrides left on cards', () => {
    expect(css).not.toMatch(/\.cards\.bento \.panel \{ padding/);
    expect(css).not.toMatch(/\.dash-wrap \{ --gap: 1[24]px; \}/);
    expect(css).not.toMatch(/html\.compact \.panel:not\(\.flush\) \{ padding/);
  });
  it('stops stacked cards gaining a line-height gap', () => {
    expect(rule('.cards > .panel')).toContain('vertical-align: top');
  });
  it('spaces stacked panels in pages by the same 20px, not 14 or 28', () => {
    expect(pageSrc).not.toMatch(/class="panel[^"]*"[^>]*style="margin-(bottom|top):(14|16|26|28)px/);
  });
});
