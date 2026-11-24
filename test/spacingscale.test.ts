import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every padding, margin and gap in the stylesheet and in inline markup sits on the 4px scale.
// Exceptions (all intentional): 1-2px hairlines, negative margins that cancel a matching padding,
// the 44px touch-target pair on .link, and the half-pixel optical centring of the collapsed sidebar icons (html.side-mini), the sidebar tooltip, the fixed-height activity grid insets (.ag-scroll 6px, .ag-card 10px).
const dirs = ['core', 'features', 'pages', 'demo'];
const files = ['app/assets/money.css', 'app/index.html', ...dirs.flatMap(d => readdirSync('app/src/' + d).filter(f => f.endsWith('.ts')).map(f => 'app/src/' + d + '/' + f))];
const prop = /(?<![-\w])((?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap)\s*:\s*([^;"'`}]+)/g;

describe('spacing scale', () => {
  it('has no off-scale padding, margin or gap', () => {
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/\.ag-scroll \{|\.panel\.ag-card \{|side-mini|\.side-tip \{|\.link, a\.go-num/.test(line)) return;
        for (const m of line.matchAll(prop)) {
          if (/calc\(|env\(/.test(m[2])) continue;
          for (const n of m[2].matchAll(/(?<![\w.#-])(-?\d+(?:\.\d+)?)px/g)) {
            const v = Number(n[1]);
            if (v > 2 && v % 4 !== 0) bad.push(`${f}:${i + 1} ${m[1]}: ${n[0]}`);
          }
        }
      });
    }
    expect(bad).toEqual([]);
  });
  it('keeps the shared page insets on the scale', () => {
    const css = readFileSync('app/assets/money.css', 'utf8');
    expect(css).toMatch(/#view > \.pg \{ --pg-side: 16px/);
    expect(css).toContain(':root { --head-gap: 24px; }');
    expect(css).toMatch(/\.empty \{[^}]*margin: 16px 0/);
    expect(css).toMatch(/\.side \{ margin: 16px 0 16px 16px; height: calc\(100vh - 32px\); top: 16px;/);
  });
});

describe('sidebar and scorecard regressions', () => {
  const css = readFileSync('app/assets/money.css', 'utf8');
  it('keeps the half-pixel centring of the collapsed rail icons', () => {
    expect(css).toContain('html.side-mini .side .nav a { padding-left: 11.5px; padding-right: 0; }');
    expect(css).toContain('html.side-mini .side-search { padding-left: 11px; padding-right: 0; }');
    expect(css).toContain('html.side-mini .side .foot .toggles button { padding-left: 12.5px; padding-right: 0; }');
    expect(css).toContain('html.side-mini .side > .ff-pill { gap: 0; padding: 0 7.5px; margin-left: 8px; }');
  });
  it('leaves a gap between sidebar rows so hover and selected pills never touch', () => {
    expect(css).toMatch(/\.side \.nav \{ display: grid; gap: clamp\(0px, calc\(var\(--row, 40px\) - 24px\), 4px\); \}/);
  });
  it('hides amounts even under a theme glow, but not the sidebar tooltip', () => {
    expect(css).toContain('html.privacy[data-theme] .big { filter: blur(7px); }');
    expect(css).toContain('html.privacy .tip:not(.side-tip)');
  });
  it('spaces the stacked scorecard cards by the card gap', () => {
    expect(css).toMatch(/\.sc-tops, \.sc-person \{ margin-bottom: var\(--card-gap\); \}/);
  });
});
