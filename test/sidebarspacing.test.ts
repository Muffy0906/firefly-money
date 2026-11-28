import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/assets/money.css', 'utf8');

// Measured in a real browser (Light/Dark/Frosted/Glass, 1280x900 and 1920x1080): the expanded sidebar's shapes all span x 33..205,
// icons/title/dot start at 45, the search shortcut and collapse icon end at 193, gaps are 4/12/12 (900px) or 4/16/16 (1080px).
describe('Expanded sidebar geometry', () => {
  it('puts the Firefly pill and search box on the same left edge as the nav pills, their icons 12px in', () => {
    expect(css).toContain('html:not(.side-mini) .side > .ff-pill { margin-left: 0; padding-left: calc(12px - 1px); }');
    expect(css).toContain('html:not(.side-mini) .side-search { padding-inline: calc(12px - 1px); }');
    expect(css).toContain('html:not(.side-mini) .side-search svg { width: 17px; height: 17px; }');
  });
  it('keeps every nav link exactly as wide as the search box, and the collapse icon on the shortcut\'s right line', () => {
    expect(css).toContain('html:not(.side-mini) .side .nav { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toContain('html:not(.side-mini) .side-tg { width: 30px; }');
  });
  it('rounds row heights and gaps to whole 4px steps and centres the brand row on the title band', () => {
    expect(css).toMatch(/--row: round\(down, clamp\(24px, calc\(\(100vh - 375px\) \/ 22\), 36px\), 4px\)/);
    expect(css).toMatch(/--sg: round\(down, clamp\(4px, 1\.6vh, 16px\), 4px\)/);
    expect(css).toContain('.side .brand { height: 24px; padding-bottom: 0; margin-bottom: var(--sg); box-sizing: border-box; }');
    expect(css).toContain('html .side { padding-top: calc(var(--band) / 2 - 29px); }');
    expect(css).toContain('.side > .ff-pill { margin-top: 0; margin-bottom: var(--sg); }');
  });
  it('shares one icon column, one text column and one gap: the Firefly dot, the footer toggle and the section labels line up too', () => {
    // Measured (Light/Dark/Frosted/Glass, 720..1200px tall, 1280 and 1920 wide): shapes x 17..199, icon centres 37.5, text 58, brand/labels/Sign out 29,
    // brand, Firefly pill, search and first row separated by --sg (8/12/16px), the label's text --sg below the row above it and 4px above its own rows.
    expect(css).toContain('html:not(.side-mini) .side > .ff-pill > i { margin-inline: 5px; }');
    expect(css).toContain('html:not(.side-mini) .side > .ff-pill { gap: 12px; padding-right: 12px; }');
    expect(css).toContain('html:not(.side-mini) .side .foot .toggles button svg { width: 17px; height: 17px; }');
    expect(css).toContain('--hh: calc(var(--sg) + 16px - 2 * var(--ng))');
    expect(css).toContain('padding: calc(var(--sg) - var(--ng)) 12px calc(4px - var(--ng)); line-height: 12px;');
  });
});
