// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import ingest from '../app/ingest.js';

const env = (globalThis as any).process.env;
beforeEach(() => { env.DASH_PASSWORD = 'correct horse'; env.FIREFLY_TOKEN = 'tok'; });

const ACCOUNTS: Record<string, { id: string, attributes: { name: string, account_number?: string, currency_code?: string } }[]> = {
  asset: [{ id: '1', attributes: { name: 'Checking', account_number: '000123456789', currency_code: 'USD' } }, { id: '2', attributes: { name: 'Savings' } }],
  liabilities: [{ id: '3', attributes: { name: 'Apple Card', currency_code: 'USD' } }, { id: '4', attributes: { name: 'Chase Sapphire', account_number: '4111 1111 1111 9876' } }],
};
// A stand-in for nginx's request object, with a pretend Firefly behind r.subrequest
function req({ method = 'POST', body = {} as any, auth = '', session = '', firefly = {} as any } = {}) {
  const calls: { uri: string, method: string, args: string, body: any }[] = [];
  const r: any = { method, requestText: typeof body === 'string' ? body : JSON.stringify(body), headersIn: { Authorization: auth, 'X-Money': session ? '1' : undefined }, headersOut: {},
    variables: { money_session: session }, status: 0, text: '', calls };
  r.return = (s: number, t = '') => { r.status = s; r.text = t; };
  r.subrequest = async (uri: string, o: { method: string, args: string, body?: string }) => {
    calls.push({ uri, method: o.method, args: o.args, body: o.body ? JSON.parse(o.body) : null });
    const path = uri.replace('/__firefly/api/v1', ''), reply = (status: number, data: unknown) => ({ status, responseText: JSON.stringify(data) });
    if (path === '/accounts') return reply(200, { data: ACCOUNTS[/type=(\w+)/.exec(o.args)![1]] });
    if (path === '/search/accounts') return reply(200, { data: firefly.payee ? [{ id: '9', attributes: { name: firefly.payee } }] : [] });
    if (firefly.existing && path === '/accounts/1/transactions') return reply(200, { data: [{ attributes: { transactions: firefly.existing } }] });
    if (path === '/accounts/9/transactions') return reply(200, { data: [{ attributes: { transactions: [{ destination_id: '9', category_name: 'Coffee', budget_id: '5', tags: firefly.payeeTags }] } }] });
    if (path === '/preferences/money_cards') {
      if (o.method === 'GET') return firefly.prefs ? reply(200, { data: { attributes: { name: 'money_cards', data: JSON.stringify(firefly.prefs) } } }) : reply(404, { message: 'Not found' });
      firefly.saved = JSON.parse(JSON.parse(o.body!).data); return reply(200, {});
    }
    if (path === '/preferences' && o.method === 'POST') { const b = JSON.parse(o.body!); firefly.created = b.name; firefly.saved = JSON.parse(b.data); return reply(200, {}); }
    if (path === '/exchange-rates') return reply(200, { data: firefly.rates || [] });
    if (path === '/transactions') return firefly.duplicate ? reply(422, { message: 'Duplicate of transaction #4.', errors: {} }) : reply(200, { data: {} });
    return reply(404, {});
  };
  return r;
}
async function keyFor() { const r = req({ method: 'GET', session: '1' }); await ingest.endpoint(r); return JSON.parse(r.text).key; }
const posted = (r: any) => r.calls.find((c: any) => c.uri.endsWith('/transactions') && c.method === 'POST').body.transactions[0];

describe('ingest.js', () => {
  it('reads amounts the way Wallet and people write them', () => {
    expect(ingest.parseAmount('$12.40')).toBe('12.40');
    expect(ingest.parseAmount('$1,234.56')).toBe('1234.56');
    expect(ingest.parseAmount('1.234,56 €')).toBe('1234.56');
    expect(ingest.parseAmount('4,5')).toBe('4.50');
    expect(ingest.parseAmount('1,234')).toBe('1234.00');
    expect(ingest.parseAmount('-$3.00')).toBe('-3.00');
    expect(ingest.parseAmount(7)).toBe('7.00');
    expect(ingest.parseAmount('')).toBeNull();
    expect(ingest.parseAmount('$0.00')).toBeNull();
  });
  it('finds the account a card name means, and only when one fits', () => {
    const accs = [{ id: '1', name: 'Checking', number: '000123456789' }, { id: '3', name: 'Apple Card', number: '' }, { id: '4', name: 'Chase Sapphire', number: '4111111111119876' }, { id: '5', name: 'Chase Freedom', number: '' }];
    expect(ingest.matchAccount(accs, 'Apple Card')!.id).toBe('3');
    expect(ingest.matchAccount(accs, 'apple card')!.id).toBe('3');
    expect(ingest.matchAccount(accs, 'Chase Sapphire Preferred')!.id).toBe('4');
    expect(ingest.matchAccount(accs, 'Visa ••9876')!.id).toBe('4');
    expect(ingest.matchAccount(accs, 'Debit 6789')!.id).toBe('1');
    expect(ingest.matchAccount(accs, 'Chase')).toBeNull();      // two Chase accounts: don't guess
    expect(ingest.matchAccount(accs, 'Amex Gold')).toBeNull();
    // telling words in common, ignoring ones like "card" and "visa"
    expect(ingest.matchAccount(accs, 'Freedom Unlimited')!.id).toBe('5');
    expect(ingest.matchAccount(accs, 'Sapphire Visa Signature')!.id).toBe('4');
    expect(ingest.matchAccount(accs, 'Visa Credit Card')).toBeNull();
  });
  it('gives the key only to a signed-in app', async () => {
    const out = req({ method: 'GET' }); await ingest.endpoint(out);
    expect(out.status).toBe(401);
    expect(await keyFor()).toMatch(/^[\w-]{43}$/);
  });
  it('refuses a wrong or missing key, and every key without a DASH_PASSWORD', async () => {
    for (const auth of ['', 'Bearer nope']) { const r = req({ auth, body: { amount: '$1', merchant: 'X', card: 'Apple Card' } }); await ingest.endpoint(r); expect(r.status).toBe(401); expect(r.calls).toEqual([]); }
    const key = await keyFor(); env.DASH_PASSWORD = '';
    const r = req({ auth: 'Bearer ' + key, body: { amount: '$1', merchant: 'X', card: 'Apple Card' } }); await ingest.endpoint(r);
    expect(r.status).toBe(401);
  });
  it('logs a payment to the card’s account with the payee’s usual category', async () => {
    const r = req({ auth: 'Bearer ' + await keyFor(), body: { amount: '$4.75', merchant: 'Blue Bottle', card: 'Apple Card' }, firefly: { payee: 'Blue Bottle' } });
    await ingest.endpoint(r);
    expect(r.status).toBe(200);
    expect(r.text).toBe('Logged 4.75 at Blue Bottle (Apple Card).\n');
    expect(posted(r)).toMatchObject({ type: 'withdrawal', amount: '4.75', description: 'Blue Bottle', source_id: '3', destination_name: 'Blue Bottle', tags: ['Apple Pay'], category_name: 'Coffee', budget_id: '5' });
    expect(r.calls.find((c: any) => c.uri.endsWith('/transactions') && c.method === 'POST').body).toMatchObject({ error_if_duplicate_hash: true, apply_rules: true });
  });
  it('reuses the payee’s recent tags, but never the automatic ones', async () => {
    const r = req({ auth: 'Bearer ' + await keyFor(), body: { amount: '$4.75', merchant: 'Blue Bottle', card: 'Apple Card' }, firefly: { payee: 'Blue Bottle', payeeTags: ['Apple Pay', 'Coffee run', 'check AMOUNT', 'Refund'] } });
    await ingest.endpoint(r);
    expect(posted(r).tags).toEqual(['Apple Pay', 'Coffee run']);
    const refund = req({ auth: 'Bearer ' + await keyFor(), body: { amount: '-$4.75', merchant: 'Blue Bottle', card: 'Apple Card' }, firefly: { payee: 'Blue Bottle', payeeTags: ['Coffee run'] } });
    await ingest.endpoint(refund);
    expect(posted(refund).tags).toEqual(['Apple Pay', 'Refund']);   // a refund doesn't inherit the purchase's tags
  });
  it('leaves off the Apple Pay tag when Settings turns it off, and keeps that choice when saving cards', async () => {
    const firefly: any = { payee: 'Blue Bottle', payeeTags: ['Coffee run', 'Apple Pay'], prefs: { cards: {}, unmatched: [], applePayTag: false } };
    const r = req({ auth: 'Bearer ' + await keyFor(), body: { amount: '$4.75', merchant: 'Blue Bottle', card: 'Apple Card' }, firefly });
    await ingest.endpoint(r);
    expect(posted(r).tags).toEqual(['Coffee run']);
    const refund = req({ auth: 'Bearer ' + await keyFor(), body: { amount: '-$4', merchant: 'Shop', card: 'Apple Card' }, firefly: { prefs: { cards: {}, unmatched: [], applePayTag: false } } });
    await ingest.endpoint(refund);
    expect(posted(refund).tags).toEqual(['Refund']);
    const unmatched: any = { prefs: { cards: {}, unmatched: [], applePayTag: false } };
    await ingest.endpoint(req({ auth: 'Bearer ' + await keyFor(), body: { amount: '$4', merchant: 'Shop', card: 'Amex Gold' }, firefly: unmatched }));
    expect(unmatched.saved).toEqual({ cards: {}, unmatched: ['Amex Gold'], applePayTag: false });
  });
  it('reads the currency from the amount', () => {
    expect(ingest.parseCurrency('€12.00')).toBe('EUR');
    expect(ingest.parseCurrency('12,00 €')).toBe('EUR');
    expect(ingest.parseCurrency('EUR 12.00')).toBe('EUR');
    expect(ingest.parseCurrency('CA$5.00')).toBe('CAD');
    expect(ingest.parseCurrency('US$5.00')).toBe('USD');
    expect(ingest.parseCurrency('£3')).toBe('GBP');
    expect(ingest.parseCurrency('$4.75')).toBeNull();
    expect(ingest.parseCurrency(4.75)).toBeNull();
  });
  it('keeps where you paid, a category from the Shortcut, and foreign amounts', async () => {
    const key = 'Bearer ' + await keyFor();
    const firefly: any = { payee: 'Blue Bottle', rates: [{ attributes: { from_currency_code: 'USD', to_currency_code: 'EUR', rate: '0.8', date: '2026-10-01' } }] };
    const r = req({ auth: key, body: { amount: '€8.00', merchant: 'Blue Bottle', card: 'Apple Card', latitude: '48.8584', longitude: 2.2945, category: 'Treats' }, firefly });
    await ingest.endpoint(r);
    expect(r.status).toBe(200);
    expect(r.text).toBe('Logged 8.00 EUR (about 10.00 USD) at Blue Bottle (Apple Card).\n');
    const s = posted(r);
    expect(s).toMatchObject({ amount: '10.00', foreign_amount: '8.00', foreign_currency_code: 'EUR', latitude: 48.8584, longitude: 2.2945, category_name: 'Treats', budget_id: '5', tags: ['Apple Pay'] });
    expect(s.zoom_level).toBe(16);
    expect(s.notes).not.toContain('maps.apple.com');   // the spot is in Firefly's location fields, not the notes
    // no rate: the same number, tagged for a check
    const noRate = req({ auth: key, body: { amount: '£3', merchant: 'Pret', card: 'Apple Card', category: 'Skip', latitude: '', longitude: '' } });
    await ingest.endpoint(noRate);
    expect(noRate.text).toBe('Logged 3.00 GBP (check the 3.00 USD) at Pret (Apple Card).\n');
    expect(posted(noRate)).toMatchObject({ amount: '3.00', foreign_currency_code: 'GBP', tags: ['Apple Pay', 'Check amount'] });
    expect(posted(noRate).latitude).toBeUndefined();
    expect(posted(noRate).category_name).toBeUndefined();
  });
  it('uses the account picked for a card in Settings', async () => {
    const firefly: any = { prefs: { cards: { 'AMEX GOLD': '1' }, unmatched: [] } };
    const r = req({ auth: 'Bearer ' + await keyFor(), body: { amount: '$9', merchant: 'Shop', card: 'Amex Gold' }, firefly });
    await ingest.endpoint(r);
    expect(r.status).toBe(200);
    expect(posted(r)).toMatchObject({ source_id: '1' });
    expect(firefly.saved).toBeUndefined();
  });
  it('uses the account the Shortcut names, and logs refunds as income', async () => {
    const r = req({ auth: 'Bearer ' + await keyFor(), body: { amount: '-$20', merchant: 'Target', card: 'Whatever', account: 'checking' } });
    await ingest.endpoint(r);
    expect(r.status).toBe(200);
    expect(posted(r)).toMatchObject({ type: 'deposit', amount: '20.00', source_name: 'Target', destination_id: '1', tags: ['Apple Pay', 'Refund'] });
  });
  it('explains what went wrong', async () => {
    const key = 'Bearer ' + await keyFor();
    const firefly: any = {};
    const none = req({ auth: key, body: { amount: '$4', merchant: 'Shop', card: 'Amex Gold' }, firefly }); await ingest.endpoint(none);
    expect(none.status).toBe(422);
    expect(none.text).toContain('Settings → Apple Pay');
    expect([firefly.created, firefly.saved]).toEqual(['money_cards', { cards: {}, unmatched: ['Amex Gold'], applePayTag: true }]);
    const wrongName = req({ auth: key, body: { amount: '$4', merchant: 'Shop', card: 'x', account: 'Nope' } }); await ingest.endpoint(wrongName);
    expect(wrongName.status).toBe(422);
    expect(wrongName.text).toContain('Checking, Savings, Apple Card, Chase Sapphire');
    const noAmount = req({ auth: key, body: { amount: 'free', merchant: 'Shop', card: 'Apple Card' } }); await ingest.endpoint(noAmount);
    expect(noAmount.status).toBe(400);
    const notJson = req({ auth: key, body: 'amount=4' }); await ingest.endpoint(notJson);
    expect(notJson.status).toBe(400);
    const dup = req({ auth: key, body: { amount: '$4', merchant: 'Shop', card: 'Apple Card' }, firefly: { duplicate: true } }); await ingest.endpoint(dup);
    expect([dup.status, dup.text]).toEqual([200, 'Already logged.\n']);
  });
  it('does not log a payment already there from the last day, unless forced', async () => {
    const key = 'Bearer ' + await keyFor(), now = new Date().toISOString();
    const existing = [{ date: now, amount: '5.40', description: 'Starbucks', destination_name: 'Starbucks', source_id: '1' }];
    const dup = req({ auth: key, body: { amount: '$5.40', merchant: 'starbucks', card: 'Checking' }, firefly: { existing } }); await ingest.endpoint(dup);
    expect(dup.status).toBe(409);
    expect(dup.text).toContain('already there');
    expect(dup.calls.some((c: any) => c.uri.endsWith('/transactions') && c.method === 'POST')).toBe(false);
    const other = req({ auth: key, body: { amount: '$5.50', merchant: 'Starbucks', card: 'Checking' }, firefly: { existing } }); await ingest.endpoint(other);
    expect(other.status).toBe(200);
    const old = req({ auth: key, body: { amount: '$5.40', merchant: 'Starbucks', card: 'Checking' }, firefly: { existing: [{ ...existing[0], date: new Date(Date.now() - 20 * 3600000).toISOString() }] } }); await ingest.endpoint(old);
    expect(old.status).toBe(200);
    const forced = req({ auth: key, body: { amount: '$5.40', merchant: 'Starbucks', card: 'Checking', force: true }, firefly: { existing } }); await ingest.endpoint(forced);
    expect(forced.status).toBe(200);
  });
});
