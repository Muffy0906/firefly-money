import { beforeEach, describe, expect, it } from 'vitest';
import { applyCustom, onAccent, readCustom } from '../app/src/core/themevars';

const d = document.documentElement, v = (k: string) => d.style.getPropertyValue(k);
beforeEach(() => { localStorage.clear(); d.removeAttribute('style'); d.removeAttribute('data-theme'); });

describe('onAccent', () => {
  it('puts dark text on light accents and white on dark ones', () => {
    expect(onAccent('#37f5ff')).toBe('#0b0b0c');
    expect(onAccent('#7c5cff')).toBe('#ffffff');
  });
});

describe('applyCustom', () => {
  it('lays the current theme’s colors on <html> and leaves other themes’ alone', () => {
    localStorage.setItem('money.themeCustom', JSON.stringify({ glass: { bg: '#102030', accent: '#ffffff', glow1: '#ff0000', frost: 120, blur: 10, motion: false }, nord: { bg: '#000000' } }));
    d.setAttribute('data-theme', 'glass');
    applyCustom();
    expect(v('--bg')).toBe('#102030');
    expect(v('--on-accent')).toBe('#0b0b0c');
    expect(v('--glow1')).toBe('#ff0000');
    expect(v('--glass-tint')).toBe('95%');
    expect(v('--glass-blur')).toBe('10px');
    expect(v('--glass-motion')).toBe('paused');
    applyCustom('nord');
    expect(v('--bg')).toBe('#000000');
    expect(v('--glow1')).toBe('');
    applyCustom('auto');
    expect(v('--bg')).toBe('');
  });
  it('gives Frosted glass the room colors and glass, but not the moving light', () => {
    localStorage.setItem('money.themeCustom', JSON.stringify({ frosted: { glow2: '#ffeedd', tint: '#ffffff', frost: 40, motion: false } }));
    applyCustom('frosted');
    expect(v('--glow2')).toBe('#ffeedd');
    expect(v('--glass-base')).toBe('#ffffff');
    expect(v('--glass-tint')).toBe('40%');
  });
  it('ignores values that aren’t colors', () => {
    localStorage.setItem('money.themeCustom', JSON.stringify({ dark: { bg: 'red;x:1', accent: 'url(x)' } }));
    applyCustom('dark');
    expect(v('--bg')).toBe('');
    expect(v('--accent')).toBe('');
  });
  it('survives a broken saved value', () => {
    localStorage.setItem('money.themeCustom', '{oops');
    expect(readCustom()).toEqual({});
  });
});
