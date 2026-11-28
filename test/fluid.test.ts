import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('app/assets/money.css', 'utf8'), pill = readFileSync('app/src/features/pill.ts', 'utf8');

describe('fluid motion', () => {
  it('uses shared easing tokens instead of repeating the curves', () => {
    expect(css).toMatch(/--ease-enter:/);
    expect(css).toMatch(/--ease-exit:/);
    expect((css.match(/cubic-bezier\(\.2, \.8, \.2, 1\)/g) || []).length).toBeLessThanOrEqual(3);   // token + a few keyframe/legacy uses
  });
  it('segmented controls and tabs slide a pill with transform only, and skip it under reduced motion', () => {
    expect(pill).toMatch(/transform/);
    expect(pill).not.toMatch(/transition|\.style\.(left|top|width)\s*=\s*[^'"]*\+\s*'px'\s*\+.*animate/);
    expect(pill).toMatch(/reduceMotion/);
    expect(css).toMatch(/\.pilled > :is\(button, a\)\.on \{ background: none/);
  });
  it('an interrupted glide restarts from where the pill is drawn, and the pill is placed in the redraw microtask', () => {
    expect(pill).toMatch(/getAnimations\(\)\.length/);
    expect(pill).toMatch(/scan\(\);\s+\/\/ in the same microtask/);
  });
  it('a newer count-up on a number replaces the older one', () => {
    expect(readFileSync('app/src/features/polish.ts', 'utf8')).toMatch(/node\.dataset\.cu !== String\(t0\)/);
  });
  it('nothing eases with the scroll: the title scrolls away with the page', () => {
    expect(css).not.toMatch(/subEase|animation-timeline/);
  });
});

describe('pill sits behind the active choice', () => {
  it('is a chip for segments and tab rows alike, restored without a glide after resize, theme switch or late fonts', () => {
    expect(pill).not.toMatch(/tabs \? 2|height:\s*2/);
    expect(pill).toMatch(/p\.style\.cssText = 'left:' \+ r\.x \+ 'px;top:' \+ r\.y \+ 'px;width:' \+ r\.w \+ 'px;height:' \+ r\.h/);
    expect(pill).toMatch(/document\.fonts\.ready/);
    expect(pill).toMatch(/data-theme/);
    expect(pill).toMatch(/ResizeObserver/);
    expect(css).not.toMatch(/\.tabs > \.opill \{[^}]*height/);
    expect(css).toMatch(/\.opill \{[^}]*border-radius: var\(--r-pill\)/);
  });
});
