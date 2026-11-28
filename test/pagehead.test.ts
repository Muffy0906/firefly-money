import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('app/assets/money.css', 'utf8');
const dom = readFileSync('app/src/core/dom.ts', 'utf8');
const pages = readdirSync('app/src/pages').map(f => [f, readFileSync('app/src/pages/' + f, 'utf8')]);

describe('one page head', () => {
  it('head() always renders the subtitle slot, with or without a subtitle', () => {
    expect(dom).toMatch(/<div class="head-text"><h1>\$\{title\}<\/h1><div class="sub-slot">/);
  });
  it('the other places that draw a head (loading skeleton, Clean up) use the same slot', () => {
    for (const f of ['app/src/core/router.ts', 'app/src/pages/cleanup.ts']) expect(readFileSync(f, 'utf8')).toMatch(/class="head-text".*class="sub-slot"/);
  });
  it('reserves the same title and slot heights on every page', () => {
    expect(css).toMatch(/\.head h1 \{ font-size: 28px; line-height: 34px;/);
    expect(css).toMatch(/\.head \.sub-slot \{ height: 28px;/);
    expect(css).not.toMatch(/html\.shell \.head h1 \{ font-size/);
  });
  it('has clearly more room above the title: 32px on desktop, 28px plus the safe area on a phone', () => {
    expect(css).toMatch(/--head-top: 32px/);
    expect(css).toMatch(/main#view \{ padding-top: calc\(28px \+ env\(safe-area-inset-top, 0px\)\) !important;/);
  });
  it('every page passes head() a subtitle (the rate note shares the slot)', () => {
    const bare: string[] = [];
    for (const [f, src] of pages as string[][]) for (const m of src.matchAll(/\bhead\(([^\n]*)/g)) {
      const args = m[1];
      if (/^(\)|'[^']*'\)|'[^']*', ''[,)])/.test(args)) bare.push(f + ': head(' + args.slice(0, 40));
    }
    expect(bare).toEqual([]);
  });
  it('on a phone the rate note drops its lead so the subtitle beside it is not cut short', () => {
    expect(css).toMatch(/@media \(max-width: 600px\) \{ \.head \.sub-slot \.fx-lead \{ display: none; \} \}/);
    expect(readFileSync('app/src/features/fxnote.ts', 'utf8')).toContain('class="fx-lead"');
  });
  it('the More sheet keeps all its buttons in one wrapping row', () => {
    const phone = readFileSync('app/src/features/phone.ts', 'utf8');
    expect(phone.match(/class="toggles sheet"/g)).toHaveLength(1);
    expect(phone).not.toContain('style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap"');
    expect(css).toContain('.drawer .menu-h { margin: 16px 0 0; }');
    expect(css).toMatch(/\.drawer \.toggles\.sheet \{ margin: 24px 0 0; \}/);
  });
  it('on a phone the title shrinks to a slim bar while scrolling down and returns on the way up', () => {
    const phone = readFileSync('app/src/features/phone.ts', 'utf8');
    expect(phone).toContain("matchMedia('(max-width: 600px)')");
    expect(phone).toContain("root.classList.toggle('head-slim', on)");
    expect(phone).toMatch(/passive: true/);
    expect(phone).toContain('room > y + 160');      // never folds a page that would then be too short to scroll (flicker)
    expect(css).toMatch(/html\.head-slim #view > \.head \{ height: 40px;/);
    expect(css).toMatch(/html\.head-slim #view > \.head \.head-text h1 \{ transform: scale\(\.72\); \}/);
    expect(css).toMatch(/html\.head-slim #view > \.head :is\(\.sub-slot, \.actions\) \{ opacity: 0; visibility: hidden;/);
    expect(css).toMatch(/@media \(max-width: 600px\) and \(prefers-reduced-motion: reduce\) \{ #view > \.head, #view > \.head \* \{ transition: none !important; \} \}/);
  });
});
