import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The form itself (and the page it draws into) is not under test: only what the typed text turns into
vi.mock('../app/src/features/txform', () => ({ collectTx: vi.fn(), renderTxForm: vi.fn() }));
vi.mock('../app/src/features/polish', () => ({ payeeFill: vi.fn() }));

import { S } from '../app/src/core/base';
import type { SplitForm, TxForm } from '../app/src/features/txform';
import { nlParse } from '../app/src/features/nlparse';

const acct = (id: string, name: string, role = 'defaultAsset') => ({ id, name, type: 'asset', role, active: true });
const blankSplit = (): SplitForm => ({ jid: '', description: '', amount: '', counter: '', category: '', budget: '', bill: '', tags: '', notes: '', location: '', fa: '', fc: '', orig: {} });
const form = (): TxForm => ({ id: '', type: 'withdrawal', date: '2026-10-20', title: '', main: '1', src: '1', dst: '', rules: true, splits: [blankSplit()] });

describe('quick add text', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 20, 9));      // Tue 20 Oct 2026
    const own = [acct('1', 'Checking'), acct('2', 'Savings')];
    S.lists = { own, expense: [{ id: '10', name: 'Starbucks' }], revenue: [{ id: '20', name: 'Acme Payroll' }], categories: [{ id: '5', name: 'Groceries' }], budgets: [], bills: [], tags: [],
      byId: Object.fromEntries(own.map(a => [a.id, a])) } as never;
    S.form = form();
  });
  afterEach(() => { vi.useRealTimers(); S.form = null; });

  it('reads an amount and a payee, matching a known payee by name', () => {
    nlParse('12.5 starbucks');
    const sp = S.form.splits[0];
    expect(sp.amount).toBe('12.50'); expect(sp.description).toBe('Starbucks'); expect(sp.counter).toBe('Starbucks');
    expect(S.form.type).toBe('withdrawal');
  });
  it('title-cases an unknown payee and takes a currency symbol off the amount', () => {
    nlParse('$8 blue bottle');
    expect(S.form.splits[0].amount).toBe('8'); expect(S.form.splits[0].description).toBe('Blue Bottle');
  });
  it('reads the date before the amount, so "sep 12" is not an amount of 12', () => {
    nlParse('30 starbucks sep 12');
    expect(S.form.date).toBe('2026-09-12'); expect(S.form.splits[0].amount).toBe('30');
  });
  it('reads income words, a category with # and an account by name', () => {
    nlParse('salary 2500 savings');
    expect(S.form.type).toBe('deposit'); expect(S.form.splits[0].amount).toBe('2500'); expect(S.form.main).toBe('2'); expect(S.form.splits[0].category).toBe('Salary');
    nlParse('40 starbucks #groc');
    expect(S.form.type).toBe('withdrawal'); expect(S.form.splits[0].category).toBe('Groceries'); expect(S.form.main).toBe('1');
  });
  it('makes a transfer when two accounts are named, from the one after "from"', () => {
    nlParse('transfer 100 from savings to checking');
    expect(S.form.type).toBe('transfer'); expect(S.form.src).toBe('2'); expect(S.form.dst).toBe('1'); expect(S.form.splits[0].amount).toBe('100');
  });
  it('starts again from the form as it was when the text is changed or cleared', () => {
    nlParse('12 starbucks'); nlParse('');
    const sp = S.form.splits[0];
    expect(sp.amount).toBe(''); expect(sp.description).toBe(''); expect(S.form.date).toBe('2026-10-20'); expect(S.form.nlChips).toBe('');
  });
  it('leaves an existing transaction alone', () => {
    S.form = { ...form(), id: '9' }; nlParse('12 starbucks');
    expect(S.form.splits[0].amount).toBe('');
  });
});
