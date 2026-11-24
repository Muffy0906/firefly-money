// Auto-logging, run inside nginx (njs). Loaded by default.conf.template.
//
// An iPhone Shortcut (a Wallet "Transaction" automation, see docs/apple-pay.md) POSTs each Apple Pay tap to
// /api/money-ingest with {amount, merchant, card}, and this records it in Firefly as a withdrawal from the
// account that matches the card, tagged "Apple Pay". The Shortcut can't sign in, so it sends a key instead:
// Settings in the app shows it (GET /api/money-ingest with a session). The key is made from DASH_PASSWORD and
// FIREFLY_TOKEN, so changing either gives a new key, and the old one stops working.
//
// njs supports less JavaScript than a browser: no for…of, and no await inside a call's arguments.
import crypto from 'crypto';

const TAG = 'Apple Pay', REFUND_TAG = 'Refund';
const FF = '/__firefly/api/v1';     // the internal location that forwards to Firefly with its token

const env = k => process.env[k] || '';
const mac = (key, s) => crypto.createHmac('sha256', key).update(s).digest('base64url');
function same(a, b) {
  const x = mac('money-compare', a), y = mac('money-compare', b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
const key = () => mac(env('FIREFLY_TOKEN'), 'money-ingest\n' + env('DASH_PASSWORD'));

// "$1,234.56", "1.234,56 €", "-4.50", 12.3 → "1234.56", "1234.56", "-4.50", "12.30"; null when there's no number
function parseAmount(v) {
  if (typeof v === 'number') return isFinite(v) && v !== 0 ? v.toFixed(2) : null;
  const s = String(v || '').replace(/[\s ]/g, ''), neg = /^[^\d]*[-−(]/.test(s);
  let n = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(n)) return null;
  const dot = n.lastIndexOf('.'), comma = n.lastIndexOf(',');
  // the last separator is the decimal point when two or fewer digits follow it ("4,50"), else it groups thousands
  const dec = Math.max(dot, comma);
  if (dec >= 0 && (n.length - dec - 1 <= 2 || /^0[.,]\d+$/.test(n))) n = n.slice(0, dec).replace(/[.,]/g, '') + '.' + n.slice(dec + 1);
  else n = n.replace(/[.,]/g, '');
  const x = parseFloat(n);
  const out = (neg ? -x : x).toFixed(2);
  return x > 0 && +out !== 0 ? out : null;      // under half a cent rounds to nothing: no payment
}

// The currency an amount is written in, from its code or symbol ("EUR 12", "€12", "CA$5"), or null when it doesn't
// say: a plain "$" is taken as the account's own currency.
const SYMBOLS = [['US$', 'USD'], ['CA$', 'CAD'], ['C$', 'CAD'], ['AU$', 'AUD'], ['A$', 'AUD'], ['NZ$', 'NZD'], ['HK$', 'HKD'], ['S$', 'SGD'], ['MX$', 'MXN'],
  ['R$', 'BRL'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₹', 'INR'], ['₩', 'KRW'], ['₪', 'ILS'], ['₺', 'TRY'], ['฿', 'THB'], ['₱', 'PHP'], ['zł', 'PLN']];
function parseCurrency(v) {
  if (typeof v !== 'string') return null;
  const code = /(?:^|[^A-Za-z])([A-Z]{3})(?![A-Za-z])/.exec(v);
  if (code) return code[1];
  const sym = SYMBOLS.find(x => v.indexOf(x[0]) >= 0);
  return sym ? sym[1] : null;
}
// Latitude and longitude from the Shortcut's location, or null
function parseSpot(lat, lng) {
  const a = parseFloat(String(lat === undefined ? '' : lat).replace(',', '.')), o = parseFloat(String(lng === undefined ? '' : lng).replace(',', '.'));
  return isFinite(a) && isFinite(o) && Math.abs(a) <= 90 && Math.abs(o) <= 180 && (a || o) ? { latitude: a, longitude: o } : null;
}

const words = s => String(s || '').toLowerCase().replace(/[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g, ' ').trim();
// Words that say what kind of card it is rather than which one, so they don't count as a match on their own
const GENERIC = ['card', 'credit', 'debit', 'visa', 'mastercard', 'signature', 'preferred', 'rewards', 'world', 'elite', 'the', 'my', 'account', 'bank', 'and'];
const telling = s => words(s).split(' ').filter(w => w.length >= 3 && GENERIC.indexOf(w) < 0);
// The account a Wallet card name means: the same name, one name inside the other ("Apple Card" ↔ "Apple Card
// (Goldman)"), the card's last four digits at the end of the account number, or the most telling words in common
// ("Freedom Unlimited" ↔ "Chase Freedom"). Null unless exactly one fits.
function matchAccount(accounts, card) {
  const c = words(card); if (!c) return null;
  const tries = [
    a => words(a.name) === c,
    a => { const n = words(a.name); return n.length >= 3 && (c.includes(n) || n.includes(c)); },
    a => { const d = /(\d{4})\D*$/.exec(card), num = (a.number || '').replace(/\D/g, ''); return !!d && num.length >= 4 && num.endsWith(d[1]); },
  ];
  for (let i = 0; i < tries.length; i++) { const hits = accounts.filter(tries[i]); if (hits.length === 1) return hits[0]; if (hits.length > 1) return null; }
  const cw = telling(card), score = a => telling(a.name).filter(w => cw.indexOf(w) >= 0).length;
  let best = null, top = 0, tie = false;
  accounts.forEach(a => { const n = score(a); if (n > top) { best = a; top = n; tie = false; } else if (n && n === top) tie = true; });
  return top && !tie ? best : null;
}

async function ff(r, method, path, args, body) {
  const res = await r.subrequest(FF + path, { method, args: args || '', body: body === undefined ? '' : JSON.stringify(body) });
  let data = null;
  try { data = JSON.parse(res.responseText || 'null'); } catch (e) { /* not JSON */ }
  return { status: res.status, data };
}
const own = async r => {
  const out = [];
  const types = ['asset', 'liabilities'];
  for (let i = 0; i < types.length; i++) {
    const res = await ff(r, 'GET', '/accounts', 'type=' + types[i] + '&limit=500');
    if (res.status !== 200) throw new Error('Firefly answered ' + res.status);
    ((res.data && res.data.data) || []).forEach(x => {
      const a = x.attributes || {};
      if (a.active !== false) out.push({ id: x.id, name: a.name || '', number: a.account_number || a.iban || '', currency: a.currency_code || '' });
    });
  }
  return out;
};
// Cards picked by hand in the app (Settings → Apple Pay), kept in a Firefly preference so this server and every
// device see them: {cards: {"<Wallet card name>": "<account id>"}, unmatched: ["<card name with no account yet>"]}
const PREF = 'money_cards';
async function cardPrefs(r) {
  const res = await ff(r, 'GET', '/preferences/' + PREF);
  let d = res.status === 200 && res.data && res.data.data && res.data.data.attributes ? res.data.data.attributes.data : null;
  try { if (typeof d === 'string') d = JSON.parse(d); } catch (e) { d = null; }
  return { exists: res.status === 200, cards: (d && d.cards) || {}, unmatched: (d && d.unmatched) || [] };
}
// Remember a card nothing matched, so the app can offer to pick its account
async function noteUnmatched(r, prefs, card) {
  if (!card || prefs.unmatched.some(x => words(x) === words(card))) return;
  const data = JSON.stringify({ cards: prefs.cards, unmatched: prefs.unmatched.concat([String(card).slice(0, 100)]).slice(-10) });
  try {
    if (prefs.exists) await ff(r, 'PUT', '/preferences/' + PREF, '', { data });
    else await ff(r, 'POST', '/preferences', '', { name: PREF, data });
  } catch (e) { /* only a convenience */ }
}
function pickedAccount(accounts, prefs, card) {
  const c = words(card), names = Object.keys(prefs.cards);
  for (let i = 0; i < names.length; i++) {
    if (words(names[i]) === c) { const id = String(prefs.cards[names[i]]); return accounts.find(a => a.id === id) || null; }
  }
  return null;
}

// Firefly's latest rate from one currency to another (or the inverse of the other way round), or null
async function rate(r, from, to) {
  try {
    const res = await ff(r, 'GET', '/exchange-rates', 'limit=500');
    let best = null;
    ((res.data && res.data.data) || []).forEach(x => {
      const a = x.attributes || {}, f = a.from_currency_code || a.from, t = a.to_currency_code || a.to, v = parseFloat(a.rate);
      if (!(v > 0) || (best && String(a.date) <= best.date)) return;
      if (f === from && t === to) best = { date: String(a.date), v };
      else if (f === to && t === from) best = { date: String(a.date), v: 1 / v };
    });
    return best ? best.v : null;
  } catch (e) { return null; }
}

// The category and budget last used with this payee, as the app's quick add fills them (features/polish.ts)
async function lastUse(r, payee) {
  try {
    const found = await ff(r, 'GET', '/search/accounts', 'field=name&type=expense&limit=10&query=' + encodeURIComponent(payee));
    const acc = ((found.data && found.data.data) || []).find(x => words(x.attributes && x.attributes.name) === words(payee));
    if (!acc) return {};
    const txs = await ff(r, 'GET', '/accounts/' + acc.id + '/transactions', 'limit=25&type=withdrawal');
    const splits = ((txs.data && txs.data.data) || []).reduce((all, g) => all.concat((g.attributes && g.attributes.transactions) || []), []).filter(s => s.destination_id === acc.id);
    const s = splits.find(x => x.category_name) || splits[0];
    return s ? { category_name: s.category_name || undefined, budget_id: s.budget_id || undefined } : {};
  } catch (e) { return {}; }
}

// A payment already logged for this account: the same payee and amount, within the last 12 hours (about "the same
// day" whatever time zone Firefly keeps). Firefly's own hash check is too strict to catch a double tap, since the time
// differs. Null when none, or when Firefly can't say (then it just logs).
async function findDuplicate(r, acc, merchant, refund, abs, paid) {
  try {
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10), end = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const res = await ff(r, 'GET', '/accounts/' + acc.id + '/transactions', 'type=' + (refund ? 'deposit' : 'withdrawal') + '&start=' + day + '&end=' + end + '&limit=50');
    if (res.status !== 200) return null;
    const splits = ((res.data && res.data.data) || []).reduce((all, g) => all.concat((g.attributes && g.attributes.transactions) || []), []);
    const amounts = [parseFloat(abs), parseFloat(paid)];
    return splits.find(s => {
      const payee = refund ? s.source_name : s.destination_name, at = Date.parse(s.date || ''), a = parseFloat(s.amount), fa = parseFloat(s.foreign_amount);
      return (words(payee) === words(merchant) || words(s.description) === words(merchant)) && Math.abs(Date.now() - at) <= 43200000
        && amounts.some(x => Math.abs(a - x) < 0.005 || Math.abs(fa - x) < 0.005);
    }) || null;
  } catch (e) { return null; }
}

function say(r, status, text) {
  r.headersOut['Content-Type'] = 'text/plain; charset=utf-8';
  r.headersOut['Cache-Control'] = 'no-store';
  r.return(status, text + '\n');
}

// GET (signed in to the app): the key for the Shortcut. POST (with the key): log a payment.
async function endpoint(r) {
  if (r.method === 'GET') {
    if (r.variables.money_session !== '1' || !r.headersIn['X-Money']) return say(r, 401, 'Sign in to Money first.');
    r.headersOut['Content-Type'] = 'application/json';
    r.headersOut['Cache-Control'] = 'no-store';
    return r.return(200, JSON.stringify({ key: key() }));
  }
  if (r.method !== 'POST') return say(r, 405, 'Use POST.');
  const auth = /^Bearer\s+(\S+)$/i.exec(r.headersIn['Authorization'] || '');
  if (!env('DASH_PASSWORD') || !auth || !same(auth[1], key())) return say(r, 401, 'Wrong key: copy it again from Money → Settings → Apple Pay.');

  let b = {};
  try { b = JSON.parse(r.requestText || '{}') || {}; } catch (e) { return say(r, 400, 'Send JSON: {"amount", "merchant", "card"}.'); }
  const amount = parseAmount(b.amount), merchant = String(b.merchant || '').trim().slice(0, 200);
  if (!amount) return say(r, 400, 'No amount in "' + String(b.amount || '') + '".');
  if (!merchant) return say(r, 400, 'No merchant.');

  try {
    const accounts = await own(r);
    let acc = null;
    if (b.account) {
      acc = words(b.account) ? accounts.find(a => words(a.name) === words(b.account)) || null : null;
      if (!acc) return say(r, 422, 'No account is called "' + b.account + '". Set "account" in the Shortcut to one of: ' + accounts.map(a => a.name).join(', '));
    } else {
      const prefs = await cardPrefs(r);
      acc = pickedAccount(accounts, prefs, b.card) || matchAccount(accounts, b.card);
      if (!acc) {
        await noteUnmatched(r, prefs, b.card);
        return say(r, 422, 'Money doesn’t know which account the card "' + (b.card || '') + '" is. Pick it in Money → Settings → Apple Pay, then pay again.');
      }
    }
    const refund = amount[0] === '-', paid = refund ? amount.slice(1) : amount;
    const usual = refund ? {} : await lastUse(r, merchant);
    const category = String(b.category || '').trim().slice(0, 100);
    if (category && !/^(skip|none|-)$/i.test(category)) { usual.category_name = category; delete usual.category_id; }
    // A refund is a deposit tagged Refund too (that's what takes it off spending in Money, see features/refunds.ts)
    const tags = refund ? [TAG, REFUND_TAG] : [TAG], notes = ['Logged by the Apple Pay shortcut' + (b.card ? ' (' + String(b.card).slice(0, 100) + ')' : '') + '.'];
    // Paid in another currency: record what was paid as the foreign amount, and the account's amount from Firefly's
    // exchange rate (the bank's will differ a little), or the same number to fix by hand when there's no rate.
    const cur = parseCurrency(b.amount);
    let abs = paid, foreign = null, estimated = '';
    if (cur && acc.currency && cur !== acc.currency) {
      const x = await rate(r, cur, acc.currency);
      foreign = { foreign_currency_code: cur, foreign_amount: paid };
      if (x) { abs = (parseFloat(paid) * x).toFixed(2); estimated = 'about '; notes.push('Paid ' + paid + ' ' + cur + '; ' + acc.currency + ' amount estimated at Firefly’s rate of ' + Number(x.toFixed(6)) + '.'); }
      else { tags.push('Check amount'); notes.push('Paid ' + paid + ' ' + cur + '. Firefly has no ' + cur + ' to ' + acc.currency + ' rate, so set the ' + acc.currency + ' amount when the bank posts it.'); }
    }
    const spot = parseSpot(b.latitude, b.longitude);
    if (spot) notes.push('Where: https://maps.apple.com/?ll=' + spot.latitude + ',' + spot.longitude);
    const split = Object.assign(usual, {
      type: refund ? 'deposit' : 'withdrawal',
      date: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      amount: abs,
      description: merchant,
      tags,
      notes: notes.join('\n'),
    }, foreign || {}, spot ? { latitude: spot.latitude, longitude: spot.longitude, zoom_level: 16 } : {},
    refund ? { source_name: merchant, destination_id: acc.id } : { source_id: acc.id, destination_name: merchant });
    const force = b.force === true || /^(1|true|yes)$/i.test(String(b.force || ''));
    const dup = force ? null : await findDuplicate(r, acc, merchant, refund, abs, paid);
    if (dup) return say(r, 409, 'Not logged: ' + merchant + ' ' + abs + ' (' + acc.name + ') is already there from the last day. To log it anyway, add "force": true to the Shortcut’s request.');
    const res = await ff(r, 'POST', '/transactions', '', { error_if_duplicate_hash: true, apply_rules: true, fire_webhooks: true, transactions: [split] });
    const what = foreign ? paid + ' ' + foreign.foreign_currency_code + ' (' + (estimated || 'check the ') + abs + ' ' + acc.currency + ')' : abs;
    if (res.status === 200) return say(r, 200, (refund ? 'Refund of ' : 'Logged ') + what + ' at ' + merchant + ' (' + acc.name + ').');
    const msg = res.data && res.data.message || '';
    if (res.status === 422 && /duplicate/i.test(msg + JSON.stringify(res.data && res.data.errors || {}))) return say(r, 200, 'Already logged.');
    return say(r, 502, 'Firefly refused it (' + res.status + '): ' + (msg || 'no reason given'));
  } catch (e) {
    return say(r, 502, 'Couldn’t reach Firefly: ' + e.message);
  }
}

export default { endpoint, parseAmount, parseCurrency, matchAccount };
