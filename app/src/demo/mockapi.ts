/* A fake Firefly III API with made-up data, for the online demo (demo.ts). It's a port of dev/mock_server.py:
   only the endpoints the UI uses are implemented, writes are accepted but not stored (except deletes), and
   all names and amounts are invented. Keep the two in step when the demo data changes. */

// A small seeded random number generator (mulberry32), so the demo data is the same on every visit
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Dates are whole days, kept as UTC midnights so adding days never trips over daylight saving
const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ymd = (t: number) => { const d = new Date(t); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; };
const utc = (y: number, m: number, d: number) => Date.UTC(y, m, d);

export class NotFound extends Error {}

type MockAccount = { id: string, type: 'accounts', attributes: { name: string, type: string, current_balance: string, account_role: string | null, [k: string]: unknown } };
type MockSplit = {
  transaction_journal_id: string, type: string, date: string, amount: string, description: string,
  source_id: string, source_name: string, source_type: string, destination_id: string, destination_name: string, destination_type: string,
  category_name: string | null, category_id: string | null, budget_id: string | null, budget_name: string | null, bill_id: string | null, bill_name: string | null, tags: string[], notes: string,
  foreign_amount: string | null, foreign_currency_code: string | null, reconciled: boolean, latitude: number | null, longitude: number | null,
};
type MockGroup = { id: string, type: 'transactions', attributes: { group_title: string | null, created_at: string, transactions: MockSplit[] } };

export function createMockApi(now = new Date()) {
  const random = seeded(7);
  const uniform = (a: number, b: number) => a + (b - a) * random();
  const choice = <T>(xs: T[]) => xs[Math.floor(random() * xs.length)];
  const TODAY = utc(now.getFullYear(), now.getMonth(), now.getDate());
  const [ty, tm, td] = ymd(TODAY);

  const ACC: MockAccount[] = [];
  const acc = (id: number, name: string, type: string, bal = 0, role: string | null = null, kw = {}) => {
    const a: MockAccount = { id: String(id), type: 'accounts', attributes: { name, type, current_balance: String(bal), account_role: role,
      active: true, currency_code: 'USD', include_net_worth: true, notes: '', opening_balance: '0', ...kw } };
    ACC.push(a); return a;
  };
  acc(1, 'Everyday Checking', 'asset', 3240.18, 'defaultAsset');
  acc(2, 'High-Yield Savings', 'asset', 12050.00, 'savingAsset');
  acc(3, 'Rewards Card', 'asset', -612.40, 'ccAsset', { monthly_payment_date: '2026-01-03' });
  acc(4, 'Cashback Card', 'asset', -240.10, 'ccAsset', { monthly_payment_date: '2026-01-31' });
  acc(5, 'Car loan', 'liability', -9020, null, { liability_type: 'loan', current_debt: '9020', interest: '5.9', interest_period: 'yearly' });
  acc(6, 'Acme Corp', 'revenue');
  acc(130, 'Online transfer', 'expense'); acc(131, 'Transfer from Everyday', 'revenue');   // see the pair below
  acc(140, 'Old Gym Membership', 'expense'); acc(141, 'Garage sale', 'revenue');   // nothing uses these (for Clean up)
  acc(142, 'Online Store', 'revenue');   // pays back part of the airline tickets below
  const PAYEES: [string, string, string | null, number, number][] = [  // name, category, budget, typical amount, per-month count
    ['Green Grocer', 'Groceries', 'Food', 64, 5], ['Corner Market', 'Groceries', 'Food', 48, 4], ['SQ *BEAN THERE COFFEE', 'Dining', 'Food', 7, 6],
    ['Burrito Bar', 'Dining', 'Food', 14, 3], ['Taco Stand', 'Dining', 'Food', 22, 2], ['Fuel Stop', 'Gas', null, 42, 3], ['Online Store', 'Shopping', null, 38, 3],
    ['StreamFlix', 'Subscriptions', null, 15.49, 1], ['Tunes Plus', 'Subscriptions', null, 11.99, 1], ['City Power & Light', 'Utilities', null, 96, 1],
    ['Pharmacy Plus', 'Health', null, 23, 1], ['Big Box Store', 'Shopping', null, 55, 1],
  ];
  const PID: Record<string, string> = {};
  PAYEES.forEach((p, i) => { PID[p[0]] = String(100 + i); acc(100 + i, p[0], 'expense'); });
  const CATS = [...[...new Set([...PAYEES.map(p => p[1]), 'Salary', 'Travel'])].sort(), 'Hobbies'];   // Hobbies: unused (for Clean up)
  const CAT_ID = Object.fromEntries(CATS.map((c, i) => [c, String(i + 1)]));
  const BUDGETS: Record<string, string> = { Food: '1', Fun: '2' };
  const ACC_BY = Object.fromEntries(ACC.map(a => [a.id, a]));

  const PIGGIES = ([['Emergency fund', 10000, 6200, null], ['Summer trip', 2400, 950, iso(TODAY + 200 * DAY)]] as [string, number, number, string | null][])
    .map(([name, t, c, date], i) => ({ id: String(i + 1), attributes: { name, target_amount: String(t), current_amount: String(c), left_to_save: String(t - c),
      target_date: date, active: true, accounts: [{ account_id: '2', name: 'High-Yield Savings', current_amount: String(c) }] } }));

  // Bills: three that the payees above charge every month, and a yearly one with no charges yet (due in 18 days)
  const BILLS: [string, string, number, number, string, number, string, string | null][] = [  // id, name, lowest, highest, repeats, first due date, group, payee
    ['1', 'StreamFlix', 15.49, 15.49, 'monthly', utc(2026, 0, 11), 'Subscriptions', 'StreamFlix'],
    ['2', 'Tunes Plus', 11.99, 11.99, 'monthly', utc(2026, 0, 12), 'Subscriptions', 'Tunes Plus'],
    ['3', 'City Power & Light', 80, 115, 'monthly', utc(2026, 0, 13), 'Home', 'City Power & Light'],
    ['4', 'Car insurance', 540, 540, 'yearly', TODAY + 18 * DAY - 365 * DAY, 'Car', null],
  ];
  const BILL_OF = Object.fromEntries(BILLS.filter(b => b[7]).map(b => [b[7], b]));

  // Where the in-store payees are (a few blocks of one town), for the Map page; three in four purchases there have a place
  const SPOTS: Record<string, [number, number]> = { 'Green Grocer': [40.7290, -73.9890], 'Corner Market': [40.7265, -73.9815], 'SQ *BEAN THERE COFFEE': [40.7308, -73.9973],
    'Burrito Bar': [40.7223, -73.9874], 'Taco Stand': [40.7195, -73.9960], 'Fuel Stop': [40.7410, -73.9780], 'Pharmacy Plus': [40.7340, -73.9900], 'Big Box Store': [40.7480, -73.9860] };

  let TX: MockGroup[] = [];
  const addTx = (d: number, type: string, amt: number, description: string, src: string, dst: string, cat: string | null = null, bud: string | null = null) => {
    const gid = String(TX.length + 1), s = ACC_BY[src].attributes, t = ACC_BY[dst].attributes;
    const bill = type === 'withdrawal' ? BILL_OF[t.name] : null, spot = type === 'withdrawal' && +gid % 4 ? SPOTS[t.name] : undefined;
    TX.push({ id: gid, type: 'transactions', attributes: { group_title: null, created_at: iso(d) + 'T18:00:00-05:00', transactions: [{
      transaction_journal_id: gid, type, date: iso(d) + 'T12:00:00-05:00', amount: amt.toFixed(2), description,
      source_id: src, source_name: s.name, source_type: s.type, destination_id: dst, destination_name: t.name, destination_type: t.type,
      category_name: cat, category_id: CAT_ID[cat ?? ''] ?? null, budget_id: BUDGETS[bud ?? ''] ?? null, budget_name: bud, bill_id: bill ? bill[0] : null, bill_name: bill ? bill[1] : null, tags: [], notes: '',
      foreign_amount: null, foreign_currency_code: null, reconciled: false, latitude: spot ? spot[0] : null, longitude: spot ? spot[1] : null }] } });
  };

  // About five months of history: two paychecks a month, everyday spending, and a card payment on the 3rd
  const [sy, sm] = ymd(utc(ty, tm, 1) - 150 * DAY);
  for (let d = utc(sy, sm, 1); d <= TODAY; d += DAY) {
    const [y, m, day] = ymd(d);
    if (day === 15 || d === utc(y, m + 1, 0)) addTx(d, 'deposit', 2850, 'ACME CORP PAYROLL', '6', '1', 'Salary');
    for (const [i, [name, cat, bud, amt, per]] of PAYEES.entries()) {
      if (cat === 'Subscriptions' || cat === 'Utilities') {       // these come on the same day every month
        if (day === 4 + i) {
          const price = cat === 'Utilities' ? amt * uniform(0.85, 1.15) : name === 'StreamFlix' && (TODAY - d) / DAY < 20 ? 17.99 : amt;
          addTx(d, 'withdrawal', Math.round(price * 100) / 100, name, '3', PID[name], cat, bud);
        }
        continue;
      }
      if (random() < per / 30) {
        let mult = 1.0;
        if (cat === 'Dining' && y === ty && m === tm) mult = 1.9;        // dining spike this month
        if (cat === 'Groceries' && y === ty && m === tm) mult = 0.45;    // groceries down
        const src = choice(['1', '3', '3', '4']);
        const title = name === name.toUpperCase() ? name.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, a, b) => a + b.toUpperCase()) : name;
        addTx(d, 'withdrawal', Math.round(amt * mult * uniform(0.7, 1.3) * 100) / 100, title, src, PID[name], cat, bud);
      }
    }
    if (day === 3) addTx(d, 'transfer', 400, 'Rewards Card payment', '1', '3');
  }
  addTx(TODAY - Math.min(9, td - 1) * DAY, 'withdrawal', 312.40, 'Airline tickets', '3', PID['Online Store'], 'Travel');
  // A refund of part of them, linked to them the way Money makes one (Reports and Budgets take it off spending)
  const LINKS: { id: string, type: string, attributes: { link_type_id: string, inward_id: string, outward_id: string } }[] = [];
  addTx(TODAY - Math.min(3, td - 1) * DAY, 'deposit', 80, 'Refund: Airline tickets', '142', '3', 'Travel');
  TX[TX.length - 1].attributes.transactions[0].tags = ['Refund'];
  LINKS.push({ id: '1', type: 'transaction_links', attributes: { link_type_id: '2', inward_id: String(TX.length - 1), outward_id: String(TX.length) } });
  // One move to savings that came in from two banks' imports as an expense and an income (Review → Transfers to match)
  addTx(TODAY - 5 * DAY, 'withdrawal', 250, 'Online transfer to savings', '1', '130');
  addTx(TODAY - 4 * DAY, 'deposit', 250, 'Transfer from Everyday Checking', '131', '2');
  TX.sort((a, b) => (jd(b).date > jd(a).date ? 1 : jd(b).date < jd(a).date ? -1 : 0));

  function jd(g: MockGroup) { return g.attributes.transactions[0]; }
  type Query = Record<string, string>;
  const inRange = (g: MockGroup, q: Query) => { const dd = jd(g).date.slice(0, 10); return (!q.start || dd >= q.start) && (!q.end || dd <= q.end); };
  // A few rule groups and rules, so the Rules page has something to show in the demo
  const RULE_GROUPS = [['1', 'Transfers & income', 'Card payments, own-account moves, income.'], ['2', 'Merchants', 'Clean merchant names and categories.'], ['3', 'Budgets', 'Runs after category rules; assigns budgets.']];
  const RULES = [['1', '1', 'Paycheck', 'Salary', 'ACME PAYROLL'], ['2', '2', 'Coffee shops', 'Dining out', 'COFFEE'], ['3', '2', 'Groceries', 'Groceries', 'MARKET'], ['4', '2', 'Rideshare', 'Transport', 'RIDE'], ['5', '3', 'Food budget', 'Groceries', 'MARKET']];
  const page = (items: unknown[], q: Query) => {
    const lim = +(q.limit || 50), p = +(q.page || 1), tot = items.length, pages = Math.max(1, Math.ceil(tot / lim));
    return { data: items.slice((p - 1) * lim, p * lim), meta: { pagination: { total: tot, count: Math.min(lim, tot), per_page: lim, current_page: p, total_pages: pages } } };
  };
  const expenseByCat = (q: Query, nocat = false) => {
    const sums = new Map<string | null, number>();
    for (const g of TX) {
      const t = jd(g);
      if (t.type !== 'withdrawal' || !inRange(g, q)) continue;
      const c = t.category_name;
      if (nocat !== (c === null)) continue;
      sums.set(c, (sums.get(c) || 0) + +t.amount);
    }
    if (nocat) return [...sums.values()].map(v => ({ difference: '-' + v.toFixed(2), difference_float: -v, currency_code: 'USD' }));
    return [...sums].map(([c, v]) => ({ id: CAT_ID[c!], name: c, difference: '-' + v.toFixed(2), difference_float: -v, currency_code: 'USD' }));
  };
  const total = (q: Query, type: string) => {
    const v = TX.filter(g => jd(g).type === type && inRange(g, q)).reduce((s, g) => s + +jd(g).amount, 0);
    return [{ difference: v.toFixed(2), difference_float: v, currency_code: 'USD' }];
  };

  // An account as it stood at the end of a past day: today's balance minus everything that moved it since
  const balanceOn = (a: MockAccount, day: string) => {
    const t = a.attributes;
    if (t.type !== 'asset' && t.type !== 'liability') return a;
    let moved = 0;
    for (const g of TX) {
      const j = jd(g);
      if (j.date.slice(0, 10) <= day) continue;
      if (j.destination_id === a.id) moved += +j.amount;
      if (j.source_id === a.id) moved -= +j.amount;
    }
    return { ...a, attributes: { ...t, current_balance: (+t.current_balance - moved).toFixed(2) } };
  };
  // The days a bill is due from start to end (ISO dates)
  type MockBill = (typeof BILLS)[number];
  const billDue = (b: MockBill, start: string, end: string) => {
    const [fy, fm, fd] = ymd(b[5]), out: string[] = [];
    for (let k = 0; ; k += b[4] === 'monthly' ? 1 : 12) {
      const d = iso(utc(fy, fm + k, Math.min(fd, ymd(utc(fy, fm + k + 1, 0))[2])));
      if (d > end) return out;
      if (d >= start) out.push(d);
    }
  };
  // A bill as Firefly answers it, for a date range: the days it's due in that range, and the charges that paid it
  const billJson = (b: MockBill, q: Query) => {
    const [id, name, lo, hi, freq, first, grp] = b, ranged = !!(q.start && q.end);
    const paid = ranged ? TX.filter(g => jd(g).bill_id === id && inRange(g, q)).map(g => ({ transaction_group_id: g.id, transaction_journal_id: g.id, date: jd(g).date })) : [];
    const next = billDue(b, iso(TODAY), iso(TODAY + 400 * DAY));
    return { id, attributes: { name, amount_min: lo.toFixed(2), amount_max: hi.toFixed(2), date: iso(first), repeat_freq: freq, skip: 0,
      active: true, object_group_title: grp, currency_code: 'USD', notes: '', next_expected_match: next[0] ?? null,
      pay_dates: ranged ? billDue(b, q.start, q.end) : [], paid_dates: paid } };
  };
  const PREFS: Record<string, unknown> = {};       // Firefly user preferences (Money keeps its synced settings in one), kept until the page reloads

  // Answers one API call (path without /api/v1). Returns the JSON body, or null for 204 No Content;
  // throws NotFound for a 404.
  return function handle(path: string, q: Record<string, string>, method = 'GET', body: any = {}) {
    let m: RegExpMatchArray | null;
    body = body || {};
    if ((m = path.match(/^\/(accounts|categories|budgets)\/(\d+)$/)) && method === 'DELETE') {   // Clean up
      const [, kind, i] = m, drop = <T>(xs: T[], f: (x: T) => boolean) => { const j = xs.findIndex(f); if (j >= 0) xs.splice(j, 1); };
      if (kind === 'accounts') { drop(ACC, a => a.id === i); delete ACC_BY[i]; }
      if (kind === 'categories') drop(CATS, c => CAT_ID[c] === i);
      if (kind === 'budgets') Object.keys(BUDGETS).forEach(n => { if (BUDGETS[n] === i) delete BUDGETS[n]; });
      return null;
    }
    if (path === '/about') return { data: { version: '6.2.0' } };
    if (path === '/accounts') return page(q.date ? ACC.map(a => balanceOn(a, q.date)) : ACC, q);
    if ((m = path.match(/^\/preferences\/([\w.-]+)$/))) {
      if (method === 'PUT' || method === 'POST') PREFS[m[1]] = body.data;
      if (!(m[1] in PREFS)) throw new NotFound();
      return { data: { id: '1', attributes: { name: m[1], data: PREFS[m[1]] } } };
    }
    if (path === '/preferences' && method === 'POST') {
      PREFS[body.name] = body.data; return { data: { id: '1', attributes: { name: body.name, data: body.data } } };
    }
    if ((m = path.match(/^\/accounts\/(\d+)\/transactions$/))) return page(TX.filter(g => [jd(g).source_id, jd(g).destination_id].includes(m![1]) && inRange(g, q)), q);
    if ((m = path.match(/^\/accounts\/(\d+)$/))) return { data: ACC_BY[m[1]] };
    if (path === '/categories') return page(CATS.map(c => ({ id: CAT_ID[c], attributes: { name: c } })), q);
    if (path === '/budgets') {
      return page(Object.entries(BUDGETS).map(([name, bid]) => {
        const spent = q.start ? TX.filter(g => jd(g).budget_id === bid && inRange(g, q)).reduce((s, g) => s + +jd(g).amount, 0) : 0;
        return { id: bid, attributes: { name, active: true, spent: [{ sum: '-' + spent.toFixed(2), currency_code: 'USD' }] } };
      }), q);
    }
    if (path === '/budget-limits') return page([{ id: '1', attributes: { budget_id: '1', amount: '900' } }, { id: '2', attributes: { budget_id: '2', amount: '200' } }], q);
    if (path === '/piggy-banks') return page(PIGGIES, q);
    if (path === '/bills') return page(BILLS.map(b => billJson(b, q)), q);
    if ((m = path.match(/^\/bills\/(\d+)\/transactions$/))) return page(TX.filter(g => jd(g).bill_id === m![1] && inRange(g, q)), q);
    if (path === '/link-types') return page([['1', 'Related', 'relates to', 'relates to'], ['2', 'Refund', 'is (partially) refunded by', '(partially) refunds'], ['3', 'Paid', 'is (partially) paid for by', '(partially) pays for'], ['4', 'Reimbursement', 'is (partially) reimbursed by', '(partially) reimburses']]
      .map(([id, name, inward, outward]) => ({ id, type: 'link_types', attributes: { name, inward, outward, editable: false } })), q);
    if ((m = path.match(/^\/tags\/([^/]+)\/transactions$/))) { const tag = decodeURIComponent(m[1]).toLowerCase(); return page(TX.filter(g => jd(g).tags.some(t => t.toLowerCase() === tag) && inRange(g, q) && (!q.type || jd(g).type === q.type)), q); }
    if ((m = path.match(/^\/transaction-journals\/(\d+)\/links$/))) return page(LINKS.filter(l => [l.attributes.inward_id, l.attributes.outward_id].includes(m![1])), q);
    if ((m = path.match(/^\/transaction-journals\/(\d+)$/))) return { data: TX.find(g => jd(g).transaction_journal_id === m![1]) };
    if (path === '/transaction-links' && method === 'POST') { const l = { id: String(LINKS.length + 1), type: 'transaction_links', attributes: { link_type_id: String(body.link_type_id), inward_id: String(body.inward_id), outward_id: String(body.outward_id) } }; LINKS.push(l); return { data: l }; }
    if ((m = path.match(/^\/transaction-links\/(\d+)$/)) && method === 'DELETE') { const j = LINKS.findIndex(l => l.id === m![1]); if (j >= 0) LINKS.splice(j, 1); return null; }
    if (path === '/rule-groups') return page(RULE_GROUPS.map(([id, title, description], i) => ({ id, attributes: { title, description, order: i + 1, active: true } })), q);
    if (path === '/rules') return page(RULES.map(([id, gid, title, cat, word], i) => ({ id, attributes: { title, rule_group_id: gid, order: i + 1, active: true, strict: true, stop_processing: false, trigger: 'store-journal',
      triggers: [{ type: 'description_contains', value: word, prohibited: false }], actions: [{ type: 'set_category', value: cat }] } })), q);
    if (['/tags', '/recurrences', '/webhooks', '/available-budgets'].includes(path)) return page([], q);
    if (path === '/currencies') return page([{ id: '1', attributes: { code: 'USD', name: 'US Dollar', symbol: '$', enabled: true, primary: true } }], q);
    if (path === '/summary/basic') return { 'net-worth-in-USD': { monetary_value: '5418.00' } };
    if (path === '/insight/expense/category') return expenseByCat(q);
    if (path === '/insight/expense/no-category') return expenseByCat(q, true);
    if (path === '/insight/expense/total') return total(q, 'withdrawal');
    if (path === '/insight/income/total') return total(q, 'deposit');
    if (path === '/insight/income/revenue') {
      const v = TX.filter(g => jd(g).type === 'deposit' && inRange(g, q)).reduce((s, g) => s + +jd(g).amount, 0);
      return v ? [{ id: '6', name: 'Acme Corp', difference: v.toFixed(2), difference_float: v, currency_code: 'USD' }] : [];
    }
    if (path === '/insight/expense/expense') {
      const sums = new Map();
      for (const g of TX) { const t = jd(g); if (t.type === 'withdrawal' && inRange(g, q)) sums.set(t.destination_id, (sums.get(t.destination_id) || 0) + +t.amount); }
      return [...sums].map(([i, v]) => ({ id: i, name: ACC_BY[i].attributes.name, difference: '-' + v.toFixed(2), difference_float: -v, currency_code: 'USD' }));
    }
    if (path.startsWith('/insight/')) return [];
    if (path === '/transactions') {
      const type = q.type || 'all';
      return page(TX.filter(g => inRange(g, q) && (type === 'all' || type === 'default' || jd(g).type === type)), q);
    }
    if ((m = path.match(/^\/transactions\/(\d+)$/))) {
      if (method === 'DELETE') { TX = TX.filter(g => g.id !== m![1]); return null; }
      return { data: TX.find(g => g.id === m![1]) };
    }
    if (path === '/search/transactions') {
      const s = (q.query || '').toLowerCase();
      if (s.includes('has_no_category')) return page(TX.filter(g => jd(g).type === 'withdrawal' && !jd(g).category_name), q);
      return page(TX.filter(g => jd(g).description.toLowerCase().includes(s.split(' ')[0])), q);
    }
    if ((m = path.match(/^\/(budgets|categories)\/(\d+)\/transactions$/))) {
      const key = m[1] === 'budgets' ? 'budget_id' : 'category_id';
      return page(TX.filter(g => jd(g)[key] === m![2] && inRange(g, q)), q);
    }
    return page([], q);
  };
}
