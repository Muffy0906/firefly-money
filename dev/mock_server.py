"""Demo server: a fake Firefly III API with made-up data, plus the app page.

Lets you try the UI (or develop on it) without a Firefly server.

    python3 dev/mock_server.py            # then open http://127.0.0.1:8765  (password: demo)
    LATENCY=0.15 FAIL_RATE=0.1 python3 dev/mock_server.py   # slow, flaky server: tests retries

Only the endpoints the UI uses are implemented, and writes are accepted but not stored
(except deletes). All names and amounts are invented.
"""
import hashlib, json, random, re, sys
from datetime import date, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

random.seed(7)
TODAY = date.today()
import os
INDEX = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'index.html')
PORT = int(os.environ.get('PORT', 8765))
LATENCY = float(os.environ.get('LATENCY', 0))
FAIL_RATE = float(os.environ.get('FAIL_RATE', 0))   # answer this share of reads with 502, like a busy server (e.g. 0.1)
_flaky = random.Random()
import time

ACC = []
def acc(id, name, type, bal=0, role=None, **kw):
    a = {'id': str(id), 'type': 'accounts', 'attributes': {'name': name, 'type': type, 'current_balance': str(bal), 'account_role': role,
         'active': True, 'currency_code': 'USD', 'include_net_worth': True, 'notes': '', 'opening_balance': '0', **kw}}
    ACC.append(a); return a

acc(1, 'Everyday Checking', 'asset', 3240.18, 'defaultAsset')
acc(2, 'High-Yield Savings', 'asset', 12050.00, 'savingAsset')
acc(3, 'Rewards Card', 'asset', -612.40, 'ccAsset', monthly_payment_date='2026-01-03')
acc(4, 'Cashback Card', 'asset', -240.10, 'ccAsset', monthly_payment_date='2026-01-31')
acc(5, 'Car loan', 'liability', -9020, None, liability_type='loan', current_debt='9020', interest='5.9', interest_period='yearly')
acc(6, 'Acme Corp', 'revenue')
PAYEES = [  # name, category, budget, typical amount, per-month count
    ('Green Grocer', 'Groceries', 'Food', 64, 5), ('Corner Market', 'Groceries', 'Food', 48, 4), ('SQ *BEAN THERE COFFEE', 'Dining', 'Food', 7, 6),
    ('Burrito Bar', 'Dining', 'Food', 14, 3), ('Taco Stand', 'Dining', 'Food', 22, 2), ('Fuel Stop', 'Gas', None, 42, 3), ('Online Store', 'Shopping', None, 38, 3),
    ('StreamFlix', 'Subscriptions', None, 15.49, 1), ('Tunes Plus', 'Subscriptions', None, 11.99, 1), ('City Power & Light', 'Utilities', None, 96, 1),
    ('Pharmacy Plus', 'Health', None, 23, 1), ('Big Box Store', 'Shopping', None, 55, 1),
]
PID = {}
for i, p in enumerate(PAYEES):
    PID[p[0]] = str(100 + i); acc(100 + i, p[0], 'expense')
CATS = sorted({p[1] for p in PAYEES} | {'Salary', 'Travel'})
CAT_ID = {c: str(i + 1) for i, c in enumerate(CATS)}
BUDGETS = {'Food': '1', 'Fun': '2'}

TX = []
def add_tx(d, typ, amt, desc, src, dst, cat=None, bud=None):
    gid = str(len(TX) + 1)
    s = ACC_BY[src]['attributes']; t = ACC_BY[dst]['attributes']
    TX.append({'id': gid, 'type': 'transactions', 'attributes': {'group_title': None, 'transactions': [{
        'transaction_journal_id': gid, 'type': typ, 'date': d.isoformat() + 'T12:00:00-05:00', 'amount': '%.2f' % amt, 'description': desc,
        'source_id': src, 'source_name': s['name'], 'source_type': s['type'], 'destination_id': dst, 'destination_name': t['name'], 'destination_type': t['type'],
        'category_name': cat, 'category_id': CAT_ID.get(cat), 'budget_id': BUDGETS.get(bud), 'budget_name': bud, 'bill_id': None, 'tags': [], 'notes': '',
        'foreign_amount': None, 'foreign_currency_code': None, 'reconciled': False}]}})
ACC_BY = {a['id']: a for a in ACC}

d = (TODAY.replace(day=1) - timedelta(days=150)).replace(day=1)
while d <= TODAY:
    if d.day in (15,) or d == (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1):
        add_tx(d, 'deposit', 2850, 'ACME CORP PAYROLL', '6', '1', 'Salary')
    for name, cat, bud, amt, per in PAYEES:
        if random.random() < per / 30:
            mult = 1.0
            if cat == 'Dining' and (d.year, d.month) == (TODAY.year, TODAY.month): mult = 1.9          # dining spike this month
            if cat == 'Groceries' and (d.year, d.month) == (TODAY.year, TODAY.month): mult = 0.45     # groceries down
            src = random.choice(['1', '3', '3', '4'])
            add_tx(d, 'withdrawal', round(amt * mult * random.uniform(.7, 1.3), 2), name.title() if name.isupper() else name, src, PID[name], cat, bud)
    if d.day == 3:
        add_tx(d, 'transfer', 400, 'Rewards Card payment', '1', '3')
    d += timedelta(days=1)
add_tx(TODAY - timedelta(days=min(9, TODAY.day - 1)), 'withdrawal', 312.40, 'Airline tickets', '3', PID['Online Store'], 'Travel')
TX.sort(key=lambda g: g['attributes']['transactions'][0]['date'], reverse=True)

def jd(g): return g['attributes']['transactions'][0]
def in_range(g, q):
    dd = jd(g)['date'][:10]
    return (not q.get('start') or dd >= q['start']) and (not q.get('end') or dd <= q['end'])

def page(items, q):
    lim = int(q.get('limit', 50)); p = int(q.get('page', 1))
    tot = len(items); pages = max(1, -(-tot // lim))
    return {'data': items[(p - 1) * lim: p * lim], 'meta': {'pagination': {'total': tot, 'count': min(lim, tot), 'per_page': lim, 'current_page': p, 'total_pages': pages}}}

def expense_by_cat(q, nocat=False):
    sums = {}
    for g in TX:
        t = jd(g)
        if t['type'] != 'withdrawal' or not in_range(g, q): continue
        c = t['category_name']
        if nocat != (c is None): continue
        sums[c] = sums.get(c, 0) + float(t['amount'])
    if nocat: return [{'difference': '-%.2f' % v, 'difference_float': -v, 'currency_code': 'USD'} for v in sums.values()]
    return [{'id': CAT_ID[c], 'name': c, 'difference': '-%.2f' % v, 'difference_float': -v, 'currency_code': 'USD'} for c, v in sums.items()]

def total(q, typ):
    v = sum(float(jd(g)['amount']) for g in TX if jd(g)['type'] == typ and in_range(g, q))
    return [{'difference': '%.2f' % v, 'difference_float': v, 'currency_code': 'USD'}]

def handle(path, q, method):
    if path == '/about': return {'data': {'version': '6.2.0'}}
    if path == '/accounts': return page(ACC, q)
    m = re.match(r'/accounts/(\d+)/transactions$', path)
    if m:
        aid = m.group(1)
        return page([g for g in TX if aid in (jd(g)['source_id'], jd(g)['destination_id']) and in_range(g, q)], q)
    m = re.match(r'/accounts/(\d+)$', path)
    if m: return {'data': ACC_BY[m.group(1)]}
    if path == '/categories': return page([{'id': CAT_ID[c], 'attributes': {'name': c}} for c in CATS], q)
    if path == '/budgets':
        out = []
        for name, bid in BUDGETS.items():
            spent = sum(float(jd(g)['amount']) for g in TX if jd(g)['budget_id'] == bid and in_range(g, q)) if q.get('start') else 0
            out.append({'id': bid, 'attributes': {'name': name, 'active': True, 'spent': [{'sum': '-%.2f' % spent, 'currency_code': 'USD'}]}})
        return page(out, q)
    if path == '/budget-limits': return page([{'id': '1', 'attributes': {'budget_id': '1', 'amount': '900'}}, {'id': '2', 'attributes': {'budget_id': '2', 'amount': '200'}}], q)
    if path in ('/bills', '/tags', '/piggy-banks', '/recurrences', '/rule-groups', '/rules', '/link-types', '/webhooks', '/available-budgets'): return page([], q)
    if path == '/currencies': return page([{'id': '1', 'attributes': {'code': 'USD', 'name': 'US Dollar', 'symbol': '$', 'enabled': True, 'primary': True}}], q)
    if path == '/summary/basic': return {'net-worth-in-USD': {'monetary_value': '5418.00'}}
    if path == '/insight/expense/category': return expense_by_cat(q)
    if path == '/insight/expense/no-category': return expense_by_cat(q, True)
    if path == '/insight/expense/total': return total(q, 'withdrawal')
    if path == '/insight/income/total': return total(q, 'deposit')
    if path == '/insight/income/revenue':
        v = sum(float(jd(g)['amount']) for g in TX if jd(g)['type'] == 'deposit' and in_range(g, q))
        return [{'id': '6', 'name': 'Acme Corp', 'difference': '%.2f' % v, 'difference_float': v, 'currency_code': 'USD'}] if v else []
    if path.startswith('/insight/'): return []
    if path == '/transactions':
        typ = q.get('type', 'all')
        return page([g for g in TX if in_range(g, q) and (typ in ('all', 'default') or jd(g)['type'] == typ)], q)
    m = re.match(r'/transactions/(\d+)$', path)
    if m:
        if method == 'DELETE':
            TX[:] = [g for g in TX if g['id'] != m.group(1)]; return None
        return {'data': next(g for g in TX if g['id'] == m.group(1))}
    if path == '/search/transactions':
        s = q.get('query', '').lower()
        if 'has_no_category' in s: return page([g for g in TX if jd(g)['type'] == 'withdrawal' and not jd(g)['category_name']], q)
        return page([g for g in TX if s.split(' ')[0] in jd(g)['description'].lower()], q)
    m = re.match(r'/(budgets|categories)/(\d+)/transactions$', path)
    if m:
        key = 'budget_id' if m.group(1) == 'budgets' else 'category_id'
        return page([g for g in TX if jd(g)[key] == m.group(2) and in_range(g, q)], q)
    return page([], q)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _go(self, method):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if not u.path.startswith('/api/'):
            if u.path in ('/', '/index.html'):
                body = open(INDEX, 'rb').read().replace(b'${MONEY_VERSION}', os.environ.get('MONEY_VERSION', 'demo').encode())
                self.send_response(200); self.send_header('Content-Type', 'text/html')
                self.send_header('ETag', '"%s"' % hashlib.md5(body).hexdigest()); self.end_headers(); self.wfile.write(body)
            elif u.path == '/sw.js':          # the service worker, taken from the nginx config so both stay the same
                conf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'default.conf.template')).read()
                body = re.search(r"location = /sw\.js \{.*?return 200 '(.*?)'; \}", conf).group(1).encode()
                self.send_response(200); self.send_header('Content-Type', 'application/javascript'); self.end_headers(); self.wfile.write(body)
            elif u.path.startswith('/assets/'):   # the app's stylesheet and scripts
                root = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(INDEX)), 'assets'))
                f = os.path.realpath(os.path.join(root, u.path[len('/assets/'):]))
                if not f.startswith(root + os.sep) or not os.path.isfile(f): self.send_response(404); self.end_headers(); return
                ctype = {'.css': 'text/css', '.js': 'application/javascript'}.get(os.path.splitext(f)[1], 'application/octet-stream')
                body = open(f, 'rb').read(); self.send_response(200); self.send_header('Content-Type', ctype); self.end_headers(); self.wfile.write(body)
            else: self.send_response(404); self.end_headers()
            return
        if LATENCY: time.sleep(LATENCY)        # simulate a real Firefly server (set LATENCY=0.15)
        if FAIL_RATE and method == 'GET' and _flaky.random() < FAIL_RATE:
            self.send_response(502); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(b'<html><body>502 Bad Gateway</body></html>'); return
        if self.headers.get('X-Dash-Key') != 'demo':
            self.send_response(401); self.send_header('X-Dash-Auth', 'required'); self.end_headers(); return
        if method in ('POST', 'PUT'): self.rfile.read(int(self.headers.get('Content-Length', 0)))
        out = handle(u.path[len('/api/v1'):], q, method)
        if out is None: self.send_response(204); self.end_headers(); return
        b = json.dumps(out).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b)
    def do_GET(self): self._go('GET')
    def do_DELETE(self): self._go('DELETE')
    def do_POST(self): self._go('POST')
    def do_PUT(self): self._go('PUT')

print('Demo running at http://127.0.0.1:%d  (password: demo)' % PORT)
ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
