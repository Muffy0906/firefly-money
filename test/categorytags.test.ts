import { describe, expect, it, vi } from 'vitest';

const groups: any[] = [];
vi.mock('../app/src/core/api', async orig => ({ ...(await orig<object>()), getAll: vi.fn(async () => groups) }));

import { categoryTagBreakdown, shareChart } from '../app/src/features/charts';

const tx = (category: string, amount: string, tags: string[] = [], type = 'withdrawal') => ({ attributes: { transactions: [{ transaction_journal_id: String(Math.random()), type, amount, category_name: category, tags, date: '2026-10-05' }] } });

describe('category tag breakdown', () => {
  it('splits a purchase evenly across its tags, and keeps untagged spending under the category name', async () => {
    groups.length = 0; groups.push(tx('Food', '30', ['Work', 'Trip']), tx('Food', '10'), tx('Food', '20', ['Work']), tx('Fun', '5', [], 'deposit'));
    const t = await categoryTagBreakdown('2026-10-01', '2026-10-31', [{ name: 'Food', v: 60 }]);
    expect([...t.get('Food')!]).toEqual([['Work', 35], ['Trip', 15], ['Food', 10]]);
    expect(t.has('Fun')).toBe(false);                       // deposits never count
  });
  it('scales tags down to the category total the insight reports, and tops it up when raw movements fall short', async () => {
    groups.length = 0; groups.push(tx('Food', '100', ['Work']));
    const less = await categoryTagBreakdown('a', 'b', [{ name: 'Food', v: 80 }]);
    expect(less.get('Food')!.get('Work')).toBe(80);
    const more = await categoryTagBreakdown('a', 'b', [{ name: 'Food', v: 130 }, { name: 'Empty', v: 12 }]);
    expect(more.get('Food')!.get('Food')).toBe(30);
    expect([...more.get('Empty')!]).toEqual([['Empty', 12]]);
  });
  it('groups uncategorised spending', async () => {
    groups.length = 0; groups.push(tx('', '8', ['Gift']));
    expect([...(await categoryTagBreakdown('a', 'b', [])).get('Uncategorized')!]).toEqual([['Gift', 8]]);
  });
});

describe('category chart drill-down', () => {
  const rows = [
    { name: 'Food', v: 60, children: [{ name: 'Work', v: 40 }, { name: 'Food', v: 20 }] },
    { name: 'Fun', v: 40, children: [{ name: 'Trip', v: 40 }] },
    { name: 'Misc', v: 10, children: [{ name: 'Misc', v: 4 }, { name: 'Gift', v: 6 }] },
    { name: 'Rent', v: 5, children: [{ name: 'Gift', v: 5 }] },
  ];
  const clean = (h: unknown) => { const s = String(h); expect(s).not.toMatch(/NaN|Infinity|undefined/); return s; };
  it('draws an inner tag ring, one slice per tag, and lists the tags in each tooltip', () => {
    const s = clean(shareChart(rows, 'mid', 'x'));
    expect(s).toContain('nested-donut');
    expect(s.match(/class="seg tag-seg"/g)).toHaveLength(6);
    expect(s).toContain('data-tip="Food\nWork · $40\nFood · $20"');
    expect(s).toContain('data-cat="Food"');
  });
  it('folds categories past the limit into one slice with their tags summed', () => {
    const s = clean(shareChart(rows, 'mid', 'x', { limit: 2 }));
    expect(s).toContain('Everything else');
    expect(s).toContain('Gift · $11');                      // 6 + 5 from the two folded categories
    expect(s).toContain('Misc · $4');                       // untagged remainder keeps the category's name
  });
  it('draws no tag ring when no category has tags', () => {
    const s = clean(shareChart([{ name: 'A', v: 5 }, { name: 'B', v: 4 }], 'mid', 'x'));
    expect(s).not.toContain('nested-donut');
  });
});
