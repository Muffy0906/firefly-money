import { describe, expect, it } from 'vitest';
import { billPayers, type FcLoan, loanBills, scheduledPayments, shortText } from '../app/src/pages/forecast';
import { billDueDates } from '../app/src/pages/bills';

// A bill as Firefly's API sends it for a date range
const bill = (id: string, name: string, amount: number, pay: string[], paid: string[] = [], more: Record<string, unknown> = {}) => ({
  id, attributes: { name, amount_min: amount.toFixed(2), amount_max: amount.toFixed(2), repeat_freq: 'monthly', skip: 0, active: true,
    pay_dates: pay.map(d => d + 'T00:00:00-04:00'), paid_dates: paid.map((d, i) => ({ transaction_group_id: String(900 + i), transaction_journal_id: String(900 + i), date: d + 'T00:00:00-04:00' })), ...more } });
const loan = (id: string, name: string, o: Partial<FcLoan> = {}): FcLoan => ({ id, name, debt: 20000, plan: null, src: '1', last: null, pays: [], ...o });
const run = (loans: FcLoan[], bills: ReturnType<typeof bill>[], payers: Record<string, string> = {}, accIds = ['1']) =>
  scheduledPayments({ from: '2026-11-01', to: '2027-01-30', accIds, loans, bills, payers });
const monthly = (day: string) => ['2026-11-', '2026-12-', '2027-01-'].map(m => m + day);

describe('forecast: loan payments that are bills too', () => {
  // The user's three loans, each also a monthly bill
  const loans = [
    loan('10', 'India Qardan', { plan: { amount: 1050, day: 3 }, last: { d: '2026-10-03', a: 1050, from: '1' }, pays: [{ d: '2026-10-03', a: 1050, bill: '20' }] }),
    loan('11', 'Philly Qardan', { last: { d: '2026-10-03', a: 500, from: '1' }, pays: [{ d: '2026-10-03', a: 500, bill: '21' }] }),
    loan('12', 'Kherunnisa Aunty', { last: { d: '2026-10-03', a: 500, from: '1' }, pays: [{ d: '2026-10-03', a: 500, bill: '22' }] }),
  ];
  const bills = [bill('20', 'India Qardan', 1050, monthly('03')), bill('21', 'Philly Qardan', 500, monthly('03')), bill('22', 'Kherunnisa Aunty', 500, monthly('03'))];

  it('counts each payment once a month, not twice', () => {
    const ev = run(loans, bills);
    expect(ev.filter(e => e.kind === 'Bill')).toEqual([]);
    expect(ev).toHaveLength(9);
    const nov = ev.filter(e => e.date.startsWith('2026-11')).reduce((s, e) => s + e.amount, 0);
    expect(nov).toBe(-2050);
    expect(ev.filter(e => e.date === '2026-11-03').map(e => e.label).sort()).toEqual(['Payment to India Qardan', 'Payment to Kherunnisa Aunty', 'Payment to Philly Qardan']);
  });
  it('links a loan and a bill by the bill on the loan’s payments, even when the names differ', () => {
    expect(loanBills([loan('10', 'Mortgage', { pays: [{ d: '2026-10-01', a: 1800, bill: '5' }] })], [bill('5', 'House payment', 1800, [])])).toEqual({ '5': '10' });
  });
  it('falls back to the name only when the amount is the loan’s monthly payment too', () => {
    const l = loan('11', 'Philly Qardan', { last: { d: '2026-10-03', a: 500, from: '1' } });
    expect(loanBills([l], [bill('21', 'Philly Qardan', 500, [])])).toEqual({ '21': '11' });
    expect(loanBills([l], [bill('21', 'Philly Qardan payment', 510, [])])).toEqual({ '21': '11' });
    expect(loanBills([l], [bill('21', 'Philly Qardan', 900, [])])).toEqual({});     // same name, different payment
    expect(loanBills([l], [bill('21', 'Philly', 500, [])])).toEqual({});             // too short to be sure
  });
  it('uses the bill’s dates and the loan’s planned amount, never more than is owed', () => {
    const ev = run([loan('10', 'India Qardan', { debt: 1500, plan: { amount: 1050, day: 15 }, pays: [{ d: '2026-10-03', a: 1000, bill: '20' }] })], [bill('20', 'India Qardan', 1000, monthly('03'))]);
    expect(ev.map(e => [e.date, e.amount])).toEqual([['2026-11-03', -1050], ['2026-12-03', -450]]);
  });
  it('leaves both out when the loan is paid from another account', () => {
    expect(run([loan('10', 'India Qardan', { src: '2', pays: [{ d: '2026-10-03', a: 1050, bill: '20' }] })], [bill('20', 'India Qardan', 1050, monthly('03'))])).toEqual([]);
  });
  it('still shows a bill with no loan, and a loan with no bill', () => {
    const ev = run([loan('10', 'India Qardan', { plan: { amount: 1050, day: 3 }, last: { d: '2026-10-03', a: 1050, from: '1' } })], [bill('30', 'Rent (Raiders Walk)', 1173, monthly('01'))]);
    expect(ev.filter(e => e.kind === 'Bill').map(e => e.date)).toEqual(monthly('01'));
    expect(ev.filter(e => e.kind === 'Loan').map(e => e.date)).toEqual(monthly('03'));
  });
});

describe('forecast: bill due dates after a payment', () => {
  it('keeps every date Firefly lists for a bill paid this month (it lists only unpaid ones)', () => {
    const rent = bill('30', 'Rent (Raiders Walk)', 1173, ['2026-12-01', '2027-01-01'], ['2026-11-01']);
    expect(billDueDates(rent.attributes)).toEqual(['2026-12-01', '2027-01-01']);
    expect(run([], [rent]).map(e => [e.date, e.amount])).toEqual([['2026-12-01', -1173], ['2027-01-01', -1173]]);
  });
  it('does not drop a date because of a payment made a few days before it', () => {
    expect(billDueDates(bill('30', 'Rent', 1173, ['2026-12-01', '2027-01-01'], ['2026-11-28']).attributes)).toEqual(['2026-12-01', '2027-01-01']);
  });
  it('skips only inactive bills', () => {
    expect(billDueDates(bill('30', 'Rent', 1173, monthly('01')).attributes)).toEqual(monthly('01'));
    expect(run([], [bill('30', 'Rent', 1173, monthly('01'), [], { active: false })])).toEqual([]);
  });
});

describe('forecast: overdue bills', () => {
  it('counts an unpaid bill from earlier this month once, today', () => {
    const ev = run([], [bill('30', 'Rent', 1173, ['2026-10-30', ...monthly('01').slice(1)])]);
    expect(ev.map(e => [e.date, e.label])).toEqual([['2026-11-01', 'Rent (overdue)'], ['2026-12-01', 'Rent'], ['2027-01-01', 'Rent']]);
  });
  it('counts an overdue loan bill once, as the loan payment', () => {
    const l = loan('10', 'India Qardan', { plan: { amount: 1050, day: 3 }, last: { d: '2026-09-03', a: 1050, from: '1' }, pays: [{ d: '2026-09-03', a: 1050, bill: '20' }] });
    const ev = run([l], [bill('20', 'India Qardan', 1050, ['2026-10-03', ...monthly('03')])]);
    expect(ev.filter(e => e.date === '2026-11-01').map(e => e.label)).toEqual(['Payment to India Qardan (overdue)']);
    expect(ev.filter(e => e.kind === 'Bill')).toEqual([]);
  });
});

describe('forecast: warning text', () => {
  it('gives the first day below zero and the lowest point when they differ', () => {
    expect(shortText({ firstNeg: '2026-11-03', min: -1858, minDate: '2027-01-10' })).toMatch(/^below zero on .*3.*lowest .*1,858.* on .*10/);
    expect(shortText({ firstNeg: '2026-11-03', min: -741, minDate: '2026-11-03' })).not.toContain('lowest');
  });
});

describe('forecast: bills paid from another account', () => {
  it('learns the paying account from the latest linked charge', () => {
    expect(billPayers([
      { bill_id: '40', source_id: '1', date: '2026-05-04T00:00:00-04:00' },
      { bill_id: '40', source_id: 'amex', date: '2026-10-04T00:00:00-04:00' },
      { bill_id: '', source_id: '1', date: '2026-10-05T00:00:00-04:00' },
    ])).toEqual({ '40': 'amex' });
  });
  it('leaves out a bill charged to a credit card, keeps one paid from this account or never paid', () => {
    const bills = [bill('40', 'Claude (Anthropic)', 20, monthly('04')), bill('41', 'Phone', 80, monthly('10')), bill('42', 'New gym', 30, monthly('12'))];
    const ev = run([], bills, { '40': 'amex', '41': '1' });
    expect([...new Set(ev.map(e => e.label))]).toEqual(['Phone', 'New gym']);
    // Looking at the card itself, the card's bill is there
    expect(run([], bills, { '40': 'amex', '41': '1' }, ['amex']).map(e => e.label)).toContain('Claude (Anthropic)');
  });
});

describe('bill paid before its due date', () => {
  const monthlyBill = (pay: string[], paid: string[]) => bill('50', 'Phone', 80, pay, paid).attributes;
  it('is not overdue once the date has passed', () => {
    const at = monthlyBill(['2026-01-10', '2026-02-10'], ['2026-01-05']);
    at.repeat_freq = 'monthly';
    expect(billDueDates(at)).toEqual(['2026-02-10']);
  });
  it('stays overdue when nothing was paid in its cycle', () => {
    const at = monthlyBill(['2026-01-10'], ['2025-11-20']);
    at.repeat_freq = 'monthly';
    expect(billDueDates(at)).toEqual(['2026-01-10']);
  });
});
