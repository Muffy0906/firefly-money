import { clearCache, getAll } from './api';
import { type ApiData, S, money, num, parseAmount } from './base';

/* ================= Reference lists (cached) ================= */
export type Account = {
  id: string, name: string, type: string, role: string, active: boolean, balance: number, debt: number, opening: number,
  liabType: string, interest: string, interestPeriod: string, paymentDate: string, number: string, notes: string, currency: string,
  netWorth: boolean, openingDate: string, plan: Plan | null,
};
export function normAccount(a: ApiData): Account {
  const t = a.attributes || {};
  return {
    id: String(a.id), name: t.name, type: String(t.type || ''), role: t.account_role || '', active: t.active !== false,
    balance: num(t.current_balance), debt: t.current_debt != null ? Math.abs(num(t.current_debt)) : Math.abs(num(t.current_balance)),
    opening: num(t.opening_balance), liabType: t.liability_type || '', interest: t.interest || '', interestPeriod: t.interest_period || '',
    paymentDate: t.monthly_payment_date || '', number: t.account_number || '', notes: t.notes || '', currency: t.currency_code || '',
    netWorth: t.include_net_worth !== false, openingDate: t.opening_balance_date || '', plan: parsePlan(t.notes),
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
export function withPlan(notes: string | null | undefined, p: PlanInput | null) {
  const base = stripPlan(notes);
  if (!p || !(p.amount > 0)) return base;
  const line = 'Monthly payment: ' + (S.currency === 'USD' ? '$' : '') + p.amount.toFixed(2) + (p.day ? ' on day ' + p.day : '') + (p.from ? ' from ' + p.from : '');
  return (base ? base + '\n\n' : '') + line;
}
export const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
export const planText = (p: PlanInput | null) => p && p.amount > 0 ? money(p.amount) + '/month' + (p.day ? ' on the ' + ordinal(p.day) : '') + (p.from ? ' from ' + p.from : '') : '';
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
    getAll('/accounts', { type: 'all' }), getAll('/categories'), getAll('/budgets'), getAll('/bills'), getAll('/tags'), getAll('/currencies').catch(() => []),
  ]);
  const acc = accounts.map(normAccount);
  const cur = currencies.map(c => ({ id: String(c.id), code: c.attributes.code, name: c.attributes.name, symbol: c.attributes.symbol, enabled: !!c.attributes.enabled,
    primary: !!(c.attributes.primary || c.attributes.default || c.attributes.native) }));
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
    foreign: cur.filter(c => c.enabled && c.code !== S.currency),
  };
  S.currency = (L.currencies.find(c => c.primary) || {} as { code?: string }).code || (acc.find(a => isAsset(a) && a.currency) || {}).currency || S.currency;
  L.foreign = L.currencies.filter(c => c.enabled && c.code !== S.currency);
  S.lists = L; S.listsAt = Date.now();
  return L;
}
export const invalidate = () => { clearCache(); };

