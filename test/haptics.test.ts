import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buzz } from '../app/src/core/haptics';

const nav = navigator as unknown as { vibrate?: unknown };
let now = 1e6;
beforeEach(() => { localStorage.clear(); now += 1000; vi.spyOn(Date, 'now').mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); delete nav.vibrate; });

describe('buzz', () => {
  it('vibrates where the browser can (Android)', () => {
    const vibrate = vi.fn(); nav.vibrate = vibrate;
    buzz([12, 80, 12]);
    expect(vibrate).toHaveBeenCalledWith([12, 80, 12]);
  });
  it('flips a hidden switch where it can’t (iPhone), and leaves nothing behind', () => {
    const clicks: Element[] = [];
    vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(function (this: HTMLElement) { clicks.push(this); });
    buzz();
    expect(clicks).toHaveLength(1);
    expect(clicks[0].tagName).toBe('LABEL');
    expect(clicks[0].querySelector('input')!.hasAttribute('switch')).toBe(true);
    expect(document.querySelector('input[switch]')).toBeNull();
  });
  it('stays still when Haptics is off in Settings', () => {
    const vibrate = vi.fn(); nav.vibrate = vibrate;
    localStorage.setItem('money.haptics', 'false');
    buzz();
    expect(vibrate).not.toHaveBeenCalled();
  });
  it('taps once when one action asks twice', () => {
    const vibrate = vi.fn(); nav.vibrate = vibrate;
    buzz(); buzz();
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
  it('taps on every form submit and checkbox change', () => {
    const vibrate = vi.fn(); nav.vibrate = vibrate;
    const f = document.createElement('form'); document.body.appendChild(f);
    f.dispatchEvent(new Event('submit', { bubbles: true }));
    now += 1000; vi.spyOn(Date, 'now').mockReturnValue(now);
    const c = document.createElement('input'); c.type = 'checkbox'; f.appendChild(c);
    c.dispatchEvent(new Event('change', { bubbles: true }));
    expect(vibrate).toHaveBeenCalledTimes(2);
    f.remove();
  });
});
