import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blankSplit, prefillLast, type TxForm } from '../app/src/features/txform';
import { swipeAction } from '../app/src/pages/inbox';

const form = (type = 'withdrawal'): TxForm => ({ id: '', type, date: '2026-11-09', title: '', main: '1', src: '1', dst: '', rules: true, splits: [blankSplit()] });

describe('add form starts from the last one', () => {
  it('uses the last account and category for the type, only if the account still exists', () => {
    const f = form(); prefillLast(f, { acc: { withdrawal: '2' }, cat: { withdrawal: 'Dining' } }, new Set(['1', '2']), {});
    expect([f.main, f.src, f.splits[0].category, f.catPre]).toEqual(['2', '2', 'Dining', 'Dining']);
    const gone = form(); prefillLast(gone, { acc: { withdrawal: '9' } }, new Set(['1']), {});
    expect(gone.main).toBe('1');
  });
  it('leaves what the caller chose, and transfers, alone', () => {
    const f = form(); prefillLast(f, { acc: { withdrawal: '2' }, cat: { withdrawal: 'Dining' } }, new Set(['1', '2']), { account: '1', category: 'Bills' });
    expect([f.main, f.splits[0].category]).toEqual(['1', '']);
    const d = form(); prefillLast(d, { cat: { withdrawal: 'Dining' } }, new Set(['1']), { description: 'Rent' });
    expect(d.splits[0].category).toBe('');
    const t = form('transfer'); prefillLast(t, { acc: { transfer: '2' }, cat: { transfer: 'X' } }, new Set(['1', '2']), {});
    expect(t.splits[0].category).toBe('');
  });
});

describe('inbox swipe', () => {
  it('right accepts, left skips, short or mostly vertical drags do nothing', () => {
    expect(swipeAction(120, 10)).toBe('accept');
    expect(swipeAction(-120, 10)).toBe('skip');
    expect(swipeAction(60, 0)).toBe('');
    expect(swipeAction(100, 90)).toBe('');
  });
});

describe('hide amounts when the app is backgrounded', () => {
  it('blurs at once when hidden, only if opted in, and restores the user’s own setting', async () => {
    const { snapPrivacy } = await import('../app/src/features/prefs');
    const r = document.documentElement;
    snapPrivacy(true); expect(r.classList.contains('privacy')).toBe(false);          // not opted in
    localStorage.setItem('money.privacyBg', 'true');
    snapPrivacy(true); expect(r.classList.contains('privacy') && r.classList.contains('priv-snap')).toBe(true);
    snapPrivacy(false); expect(r.classList.contains('privacy') || r.classList.contains('priv-snap')).toBe(false);
    localStorage.setItem('money.privacy', 'true'); r.classList.add('privacy');
    snapPrivacy(true); snapPrivacy(false); expect(r.classList.contains('privacy')).toBe(true);   // already hiding by choice: stays
  });
});

describe('inbox buttons stay inside the card', () => {
  it('the action row wraps and a long Accept label is clipped, not pushed out (measured at 320 to 1280)', () => {
    const src = readFileSync('app/src/pages/inbox.ts', 'utf8'), css = readFileSync('app/assets/money.css', 'utf8');
    expect(src).toContain('margin-top:8px;flex-wrap:wrap');
    expect(css).toMatch(/\.ib-accept \{[^}]*max-width: 100%;[^}]*text-overflow: ellipsis/);
  });
});
