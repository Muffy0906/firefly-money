import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { paged, pagedHtml } from '../app/src/core/pagescroll';

const css = readFileSync('app/assets/money.css', 'utf8'), router = readFileSync('app/src/core/router.ts', 'utf8');

describe('fixed title row, scrolling content', () => {
  it('splits a page into the title row and a scroller holding everything else', () => {
    const f = pagedHtml('<div class="head"><h1>T</h1></div><section class="panel">a</section><p>b</p>');
    expect([...f.children].map(n => n.className)).toEqual(['head', 'pg']);
    expect(f.querySelector('.pg')!.children.length).toBe(2);
    expect(paged(pagedHtml('<p>x</p>')).querySelector('.pg')).not.toBeNull();     // no title row: all of it scrolls
  });
  it('every page the router draws goes through it', () => {
    expect(router).not.toMatch(/v\.innerHTML\s*=/);
    expect((router.match(/pagedHtml\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('the content scrolls in .pg, the window does not, and the fade is a mask on that scroller', () => {
    expect(css).toMatch(/html \{ overflow: hidden; \}/);
    const pg = css.match(/#view > \.pg \{[^}]*\}/)![0];
    expect(pg).toMatch(/overflow-y: auto/);
    expect(pg).toMatch(/mask-image: linear-gradient\(to bottom, transparent, #000 16px\)/);
    expect(css).toMatch(/--head-gap: 16px/);        // content starts below the fade
    expect(css).not.toMatch(/backdrop-filter[^;]*;[^}]*#view > \.head/);
  });
  it('the sticky day headings stop just under the fade', () => {
    expect(css).toMatch(/html \.tbl\.feed tr\.dayhead \{ top: 14px !important; \}/);
  });
  it('the title band has an explicit height, everything on it centred, and the sidebar brand on the same centre line', () => {
    expect(css).toMatch(/--band: 82px/);
    expect(css).toMatch(/#view > \.head \{ min-height: var\(--band\); align-items: center; \}/);
    expect(css).toMatch(/html \.side \{ padding-top: calc\(var\(--band\) \/ 2 - 27\.5px\)/);
    expect(css).toMatch(/main#view \{ padding-top: 0 !important; \}/);
  });
});

describe('iPhone Home Screen edges', () => {
  it('the app fills the tallest viewport and the backdrop reaches under the home indicator', () => {
    expect(css).toMatch(/\.app \{ height: 100vh; height: max\(100dvh, 100lvh\)/);
    expect(css).toMatch(/html\.ios-web body::after[^{]*\{ bottom: calc\(-1 \* env\(safe-area-inset-bottom, 0px\)\); \}/);
  });
});
