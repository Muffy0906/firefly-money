import { HIDE, clearCache, getAll } from './api';
import { type ApiData, S, moneyIn, num, parseAmount } from './base';
import { convertToPrimary, fxEnsure, fxSetup, isForeign } from './fx';

/* ================= Reference lists (cached) ================= */
export type Account = {
  id: string, name: string, type: string, role: string, active: boolean, balance: number, debt: number, opening: number,
  liabType: string, direction: string, interest: string, interestPeriod: string, paymentDate: string, number: string, notes: string, currency: string,
  netWorth: boolean, openingDate: string, plan: Plan | null,
  // An account in another currency: balance, debt and opening above are in the main currency so every total can add
  // them (core/fx.ts), and nat has them as Firefly keeps them, for the account's own rows and its form.
  // unconv: there's no rate (or converting is off), so the three are 0 and totals leave the account out.
  nat?: { balance: number, debt: number, opening: number, plan: Plan | null }, unconv?: boolean,      // plan: the planned payment as written in the notes (plan above is converted, for the planner and forecast)
};
export function normAccount(a: ApiData): Account {
  const t = a.attributes || {}, code = String(t.currency_code || '');
  const debtRaw = t.current_debt != null ? t.current_debt : t.current_balance;
  const plan = parsePlan(t.notes), nat = { balance: num(t.current_balance), debt: Math.abs(num(debtRaw)), opening: num(t.opening_balance), plan };
  const foreign = isForeign(code), bal = foreign ? convertToPrimary(t.current_balance, code) : nat.balance;
  const unconv = foreign && bal == null;
  const own = unconv ? { balance: 0, debt: 0, opening: 0 } : foreign ? { balance: bal!, debt: Math.abs(convertToPrimary(debtRaw, code) || 0), opening: convertToPrimary(t.opening_balance, code) || 0 } : nat;
  return {
    id: String(a.id), name: t.name, type: String(t.type || ''), role: t.account_role || '', active: t.active !== false,
    balance: own.balance, debt: own.debt,
    opening: own.opening, ...(foreign ? { nat, unconv } : {}), liabType: t.liability_type || '', direction: t.liability_direction || '', interest: t.interest || '', interestPeriod: t.interest_period || '',
    paymentDate: t.monthly_payment_date || '', number: t.account_number || '', notes: t.notes || '', currency: t.currency_code || '',
    netWorth: t.include_net_worth !== false, openingDate: t.opening_balance_date || '', plan: foreign && plan ? (unconv ? null : { ...plan, amount: convertToPrimary(plan.amount, code) || 0 }) : plan,
  };
}
// A loan's planned monthly payment lives in its Firefly notes as one line, e.g.
// "Monthly payment: $500.00 on day 30 from Chase Checking", so every device sees it.
const PLAN_RE = /^[ \t]*Monthly payment:[ \t]*\p{Sc}?[ \t]*(\d[\d,. ]*?)[ \t]*\p{Sc}?(?:[ \t]+on day[ \t]+(\d{1,2}))?(?:[ \t]+from[ \t]+(.+?))?[ \t]*$/imu;
export type Plan = { amount: number, day: number | null, from: string };
export function parsePlan(notes: string | null | undefined): Plan | null { const m = PLAN_RE.exec(notes || ''); return m ? { amount: parseAmount(m[1]) ?? num(m[1].replace(/,/g, '')), day: m[2] ? +m[2] : null, from: m[3] ? m[3].trim() : '' } : null; }
export function stripPlan(notes: string | null | undefined) { return String(notes || '').replace(PLAN_RE, '').replace(/\n{3,}/g, '\n\n').trim(); }
// A plan as a form gives it: only the amount is required
export type PlanInput = { amount: number, day?: number | null, from?: string };
// code: the account's currency, so only a US-dollar loan's line is written with a $
export function withPlan(notes: string | null | undefined, p: PlanInput | null, code = '') {
  const base = stripPlan(notes);
  if (!p || !(p.amount > 0)) return base;
  const line = 'Monthly payment: ' + ((code || S.currency).toUpperCase() === 'USD' ? '$' : '') + p.amount.toFixed(2) + (p.day ? ' on day ' + p.day : '') + (p.from ? ' from ' + p.from : '');
  return (base ? base + '\n\n' : '') + line;
}
export const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
export const planText = (p: PlanInput | null, code = '') => p && p.amount > 0 ? moneyIn(p.amount, code) + '/month' + (p.day ? ' on the ' + ordinal(p.day) : '') + (p.from ? ' from ' + p.from : '') : '';
export const isAsset = (a: Pick<Account, 'type'>) => a.type === 'asset';
export const isCard = (a: Pick<Account, 'type' | 'role'>) => a.type === 'asset' && a.role === 'ccAsset';
export const isLiab = (a: Pick<Account, 'type'>) => a.type.startsWith('liab') || ['loan', 'debt', 'mortgage'].includes(a.type);
export type Category = { id: string, name: string, notes: string };
export type Budget = { id: string, name: string, active: boolean, notes: string };
export type Bill = { id: string, name: string, active: boolean };
export type Tag = { id: string, name: string };
export type Currency = { id: string, code: string, name: string, symbol: string, enabled: boolean, primary: boolean };
export type Lists = {
  accounts: Account[], byId: Record<string, Account>, own: Account[], expense: Account[], revenue: Account[],
  categories: Category[], budgets: Budget[], bills: Bill[], tags: Tag[], currencies: Currency[], foreign: Currency[],
};
export async function lists(force?: boolean): Promise<Lists> {
  if (S.lists && !force && Date.now() - S.listsAt! < 300000) return S.lists;
  const [accounts, categories, budgets, bills, tags, currencies] = await Promise.all([
    getAll('/accounts', { type: 'all' }), getAll('/categories'), getAll('/budgets'), getAll('/bills'), getAll('/tags'), getAll('/currencies', {}, true).catch(() => [])   // always fresh: a currency just enabled must show up in pickers, not the saved list,
  ]);
  const cur = currencies.map(c => ({ id: String(c.id), code: c.attributes.code, name: c.attributes.name, symbol: c.attributes.symbol, enabled: !!c.attributes.enabled,
    primary: !!(c.attributes.primary || c.attributes.default || c.attributes.native) }));
  // The main currency first, then today's rates for the other currencies the accounts use (core/fx.ts), so every
  // balance below is already in the main currency. A failed rate fetch never fails the lists.
  const mine = accounts.filter(a => /^(asset|liab|loan|debt|mortgage)/.test(String(a.attributes.type || '')));
  S.currency = (cur.find(c => c.primary) || {} as { code?: string }).code || (mine.find(a => a.attributes.type === 'asset' && a.attributes.currency_code) || { attributes: {} }).attributes.currency_code || S.currency;
  fxSetup(S.currency, Object.fromEntries(currencies.filter(c => c.attributes.decimal_places != null).map(c => [String(c.attributes.code).toUpperCase(), +c.attributes.decimal_places])));
  await fxEnsure(mine.map(a => String(a.attributes.currency_code || '')));
  const acc = accounts.map(normAccount);
  const enabledCurrencies = cur.filter(c => c.enabled);
  const L: Lists = {
    accounts: acc,
    byId: Object.fromEntries(acc.map(a => [a.id, a])),
    own: acc.filter(a => (isAsset(a) || isLiab(a)) && a.active),
    expense: acc.filter(a => a.type === 'expense'),
    revenue: acc.filter(a => a.type === 'revenue'),
    categories: categories.map(c => ({ id: String(c.id), name: c.attributes.name, notes: c.attributes.notes || '' })).sort((a, b) => a.name.localeCompare(b.name)),
    budgets: budgets.map(b => ({ id: String(b.id), name: b.attributes.name, active: b.attributes.active !== false, notes: b.attributes.notes || '' })),
    bills: bills.map(b => ({ id: String(b.id), name: b.attributes.name, active: b.attributes.active !== false })),
    tags: tags.map(t => ({ id: String(t.id), name: t.attributes.tag })).sort((a, b) => a.name.localeCompare(b.name)),
    currencies: cur,
    foreign: enabledCurrencies.some(c => c.code !== S.currency) ? enabledCurrencies : [],
  };
  HIDE.inactive = new Set(acc.filter(a => !a.active).map(a => a.id)); HIDE.active = acc.filter(a => (isAsset(a) || isLiab(a)) && a.active).map(a => a.id);
  S.lists = L; S.listsAt = Date.now();
  return L;
}
export const invalidate = () => { clearCache(); };

