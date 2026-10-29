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
acc(130, 'Online transfer', 'expense'); acc(131, 'Transfer from Everyday', 'revenue')   # see the pair below
acc(140, 'Old Gym Membership', 'expense'); acc(141, 'Garage sale', 'revenue')   # nothing uses these (for Clean up)
PAYEES = [  # name, category, budget, typical amount, per-month count
    ('Green Grocer', 'Groceries', 'Food', 64, 5), ('Corner Market', 'Groceries', 'Food', 48, 4), ('SQ *BEAN THERE COFFEE', 'Dining', 'Food', 7, 6),
    ('Burrito Bar', 'Dining', 'Food', 14, 3), ('Taco Stand', 'Dining', 'Food', 22, 2), ('Fuel Stop', 'Gas', None, 42, 3), ('Online Store', 'Shopping', None, 38, 3),
    ('StreamFlix', 'Subscriptions', None, 15.49, 1), ('Tunes Plus', 'Subscriptions', None, 11.99, 1), ('City Power & Light', 'Utilities', None, 96, 1),
    ('Pharmacy Plus', 'Health', None, 23, 1), ('Big Box Store', 'Shopping', None, 55, 1),
]
PID = {}
for i, p in enumerate(PAYEES):
    PID[p[0]] = str(100 + i); acc(100 + i, p[0], 'expense')
CATS = sorted({p[1] for p in PAYEES} | {'Salary', 'Travel'}) + ['Hobbies']   # Hobbies: unused (for Clean up)
CAT_ID = {c: str(i + 1) for i, c in enumerate(CATS)}
BUDGETS = {'Food': '1', 'Fun': '2'}

PIGGIES = [{'id': str(i + 1), 'attributes': {'name': n, 'target_amount': str(t), 'current_amount': str(c), 'left_to_save': str(t - c), 'target_date': td, 'active': True,
            'accounts': [{'account_id': '2', 'name': 'High-Yield Savings', 'current_amount': str(c)}]}}
           for i, (n, t, c, td) in enumerate([('Emergency fund', 10000, 6200, None), ('Summer trip', 2400, 950, (TODAY + timedelta(days=200)).isoformat())])]

# Bills: three that the payees above charge every month, and a yearly one with no charges yet (due in 18 days)
BILLS = [  # id, name, lowest, highest, repeats, first due date, group, payee
    ('1', 'StreamFlix', 15.49, 15.49, 'monthly', date(2026, 1, 11), 'Subscriptions', 'StreamFlix'),
    ('2', 'Tunes Plus', 11.99, 11.99, 'monthly', date(2026, 1, 12), 'Subscriptions', 'Tunes Plus'),
    ('3', 'City Power & Light', 80, 115, 'monthly', date(2026, 1, 13), 'Home', 'City Power & Light'),
    ('4', 'Car insurance', 540, 540, 'yearly', TODAY + timedelta(days=18) - timedelta(days=365), 'Car', None),
]
BILL_OF = {b[7]: b for b in BILLS if b[7]}

TX = []
# Where the in-store payees are (a few blocks of one town), for the Map page; three in four purchases there have a place
SPOTS = {'Green Grocer': (40.7290, -73.9890), 'Corner Market': (40.7265, -73.9815), 'SQ *BEAN THERE COFFEE': (40.7308, -73.9973),
         'Burrito Bar': (40.7223, -73.9874), 'Taco Stand': (40.7195, -73.9960), 'Fuel Stop': (40.7410, -73.9780), 'Pharmacy Plus': (40.7340, -73.9900), 'Big Box Store': (40.7480, -73.9860)}
def add_tx(d, typ, amt, desc, src, dst, cat=None, bud=None):
    gid = str(len(TX) + 1)
    s = ACC_BY[src]['attributes']; t = ACC_BY[dst]['attributes']
    bill = BILL_OF.get(t['name']) if typ == 'withdrawal' else None
    spot = SPOTS.get(t['name']) if typ == 'withdrawal' and int(gid) % 4 else None
    TX.append({'id': gid, 'type': 'transactions', 'attributes': {'group_title': None, 'created_at': d.isoformat() + 'T18:00:00-05:00', 'transactions': [{
        'transaction_journal_id': gid, 'type': typ, 'date': d.isoformat() + 'T12:00:00-05:00', 'amount': '%.2f' % amt, 'description': desc,
        'source_id': src, 'source_name': s['name'], 'source_type': s['type'], 'destination_id': dst, 'destination_name': t['name'], 'destination_type': t['type'],
        'category_name': cat, 'category_id': CAT_ID.get(cat), 'budget_id': BUDGETS.get(bud), 'budget_name': bud, 'bill_id': bill and bill[0], 'bill_name': bill and bill[1], 'tags': [], 'notes': '',
        'foreign_amount': None, 'foreign_currency_code': None, 'reconciled': False, 'latitude': spot and spot[0], 'longitude': spot and spot[1]}]}})
ACC_BY = {a['id']: a for a in ACC}

d = (TODAY.replace(day=1) - timedelta(days=int(os.environ.get('HISTORY_DAYS', 150)))).replace(day=1)   # HISTORY_DAYS=1100: three years, for the Timeline
while d <= TODAY:
    if d.day in (15,) or d == (d.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1):
        add_tx(d, 'deposit', 2850, 'ACME CORP PAYROLL', '6', '1', 'Salary')
    for i, (name, cat, bud, amt, per) in enumerate(PAYEES):
        if cat in ('Subscriptions', 'Utilities'):         # these come on the same day every month
            if d.day == 4 + i:
                price = amt * random.uniform(.85, 1.15) if cat == 'Utilities' else 17.99 if name == 'StreamFlix' and (TODAY - d).days < 20 else amt
                add_tx(d, 'withdrawal', round(price, 2), name, '3', PID[name], cat, bud)
            continue
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
# One move to savings that came in from two banks' imports as an expense and an income (Review -> Transfers to match)
add_tx(TODAY - timedelta(days=5), 'withdrawal', 250, 'Online transfer to savings', '1', '130')
add_tx(TODAY - timedelta(days=4), 'deposit', 250, 'Transfer from Everyday Checking', '131', '2')
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

# An account as it stood at the end of a past day: today's balance minus everything that moved it since
def balance_on(a, day):
    t = a['attributes']
    if t['type'] not in ('asset', 'liability'): return a
    moved = 0.0
    for g in TX:
        j = jd(g)
        if j['date'][:10] <= day: continue
        if j['destination_id'] == a['id']: moved += float(j['amount'])
        if j['source_id'] == a['id']: moved -= float(j['amount'])
    return {**a, 'attributes': {**t, 'current_balance': '%.2f' % (float(t['current_balance']) - moved)}}

# The days a bill is due from start to end (ISO dates)
def bill_due(b, start, end):
    first, out, y, m = b[5], [], b[5].year, b[5].month
    while True:
        last = (date(y + m // 12, m % 12 + 1, 1) - timedelta(days=1)).day
        d = date(y, m, min(first.day, last)).isoformat()
        if d > end: return out
        if d >= start: out.append(d)
        m += 1 if b[4] == 'monthly' else 12
        y, m = y + (m - 1) // 12, (m - 1) % 12 + 1
# A bill as Firefly answers it, for a date range: the days it's due in that range, and the charges that paid it
def bill_json(b, q):
    bid, name, lo, hi, freq, first, grp, payee = b
    ranged = bool(q.get('start') and q.get('end'))
    paid = [{'transaction_group_id': g['id'], 'transaction_journal_id': g['id'], 'date': jd(g)['date']} for g in TX if ranged and jd(g)['bill_id'] == bid and in_range(g, q)]
    nxt = bill_due(b, TODAY.isoformat(), (TODAY + timedelta(days=400)).isoformat())
    return {'id': bid, 'attributes': {'name': name, 'amount_min': '%.2f' % lo, 'amount_max': '%.2f' % hi, 'date': first.isoformat(), 'repeat_freq': freq, 'skip': 0,
            'active': True, 'object_group_title': grp, 'currency_code': 'USD', 'notes': '', 'next_expected_match': nxt[0] if nxt else None,
            'pay_dates': bill_due(b, q['start'], q['end']) if ranged else [], 'paid_dates': paid}}

PREFS = {}       # Firefly user preferences (Money keeps its synced settings in one), kept until the server stops
class NotFound(Exception): pass

def handle(path, q, method, body=None):
    body = body or {}
    m = re.match(r'/(accounts|categories|budgets)/(\d+)$', path)
    if m and method == 'DELETE':       # Clean up
        kind, i = m.groups()
        if kind == 'accounts': ACC[:] = [a for a in ACC if a['id'] != i]; ACC_BY.pop(i, None)
        if kind == 'categories': CATS[:] = [c for c in CATS if CAT_ID[c] != i]
        if kind == 'budgets': [BUDGETS.pop(n) for n, b in list(BUDGETS.items()) if b == i]
        return None
    if path == '/about': return {'data': {'version': '6.2.0'}}
    if path == '/accounts': return page([balance_on(a, q['date']) for a in ACC] if q.get('date') else ACC, q)
    m = re.match(r'/preferences/([\w.-]+)$', path)
    if m:
        if method in ('PUT', 'POST'): PREFS[m.group(1)] = body.get('data')
        if m.group(1) not in PREFS: raise NotFound()
        return {'data': {'id': '1', 'attributes': {'name': m.group(1), 'data': PREFS[m.group(1)]}}}
    if path == '/preferences' and method == 'POST':
        PREFS[body.get('name')] = body.get('data'); return {'data': {'id': '1', 'attributes': {'name': body.get('name'), 'data': body.get('data')}}}
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
    if path == '/piggy-banks': return page(PIGGIES, q)
    if path == '/bills': return page([bill_json(b, q) for b in BILLS], q)
    m = re.match(r'/bills/(\d+)/transactions$', path)
    if m: return page([g for g in TX if jd(g)['bill_id'] == m.group(1) and in_range(g, q)], q)
    if path in ('/tags', '/recurrences', '/rule-groups', '/rules', '/link-types', '/webhooks', '/available-budgets'): return page([], q)
    if path == '/currencies': return page([{'id': '1', 'attributes': {'code': 'USD', 'name': 'US Dollar', 'symbol': '$', 'enabled': True, 'primary': True}}], q)
    if path == '/summary/basic': return {'net-worth-in-USD': {'monetary_value': '5418.00'}}
    if path == '/insight/expense/category': return expense_by_cat(q)
    if path == '/insight/expense/no-category': return expense_by_cat(q, True)
    if path == '/insight/expense/total': return total(q, 'withdrawal')
    if path == '/insight/income/total': return total(q, 'deposit')
    if path == '/insight/income/revenue':
        v = sum(float(jd(g)['amount']) for g in TX if jd(g)['type'] == 'deposit' and in_range(g, q))
        return [{'id': '6', 'name': 'Acme Corp', 'difference': '%.2f' % v, 'difference_float': v, 'currency_code': 'USD'}] if v else []
    if path == '/insight/expense/expense':
        sums = {}
        for g in TX:
            t = jd(g)
            if t['type'] == 'withdrawal' and in_range(g, q): sums[t['destination_id']] = sums.get(t['destination_id'], 0) + float(t['amount'])
        return [{'id': i, 'name': ACC_BY[i]['attributes']['name'], 'difference': '-%.2f' % v, 'difference_float': -v, 'currency_code': 'USD'} for i, v in sums.items()]
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

# The page's security headers (Content-Security-Policy and friends), taken from the nginx config so both stay the same
_conf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'default.conf.template')).read()
PAGE_HEADERS = re.findall(r'add_header ([\w-]+) "(.*?)";', re.search(r'location / \{(.*?)\n    \}', _conf, re.S).group(1))
PAGE_HEADERS = [(k, v) for k, v in PAGE_HEADERS if k != 'Cache-Control']

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _go(self, method):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if not u.path.startswith('/api/'):
            if u.path in ('/', '/index.html'):
                body = open(INDEX, 'rb').read().replace(b'${MONEY_VERSION}', os.environ.get('MONEY_VERSION', 'demo').encode())
                self.send_response(200); self.send_header('Content-Type', 'text/html')
                for k, v in PAGE_HEADERS: self.send_header(k, v)
                self.send_header('ETag', '"%s"' % hashlib.md5(body).hexdigest()); self.end_headers(); self.wfile.write(body)
            elif u.path == '/sw.js':          # the service worker, taken from the nginx config so both stay the same
                conf = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'default.conf.template')).read()
                body = re.search(r"location = /sw\.js \{.*?return 200 '(.*?)'; \}", conf).group(1).encode()
                self.send_response(200); self.send_header('Content-Type', 'application/javascript'); self.end_headers(); self.wfile.write(body)
            elif u.path.startswith('/assets/'):   # the app's stylesheet and scripts
                root = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(INDEX)), 'assets'))
                f = os.path.realpath(os.path.join(root, u.path[len('/assets/'):]))
                if not f.startswith(root + os.sep) or not os.path.isfile(f): self.send_response(404); self.end_headers(); return
                ctype = {'.css': 'text/css', '.js': 'application/javascript', '.map': 'application/json'}.get(os.path.splitext(f)[1], 'application/octet-stream')
                body = open(f, 'rb').read(); self.send_response(200); self.send_header('Content-Type', ctype); self.end_headers(); self.wfile.write(body)
            elif u.path in ('/logo/streamflix.com', '/logo/tunesplus.com'):   # stands in for nginx's logo proxy; other payees have none
                c = '#e50914' if 'stream' in u.path else '#1db954'
                body = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="%s"/><path d="M11 8v16l13-8z" fill="#fff"/></svg>' % c).encode()
                self.send_response(200); self.send_header('Content-Type', 'image/svg+xml'); self.end_headers(); self.wfile.write(body)
            elif re.match(r'^/tile/\d+/\d+/\d+\.png$', u.path):   # stands in for nginx's map pictures: a plain grid square
                body = b'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#ecebe4"/><path d="M0 .5H256M.5 0V256M0 128H256M128 0V256" stroke="#d6d4ca"/></svg>'
                self.send_response(200); self.send_header('Content-Type', 'image/svg+xml'); self.end_headers(); self.wfile.write(body)
            else: self.send_response(404); self.end_headers()
            return
        if LATENCY: time.sleep(LATENCY)        # simulate a real Firefly server (set LATENCY=0.15)
        if FAIL_RATE and method == 'GET' and _flaky.random() < FAIL_RATE:
            self.send_response(502); self.send_header('Content-Type', 'text/html'); self.end_headers(); self.wfile.write(b'<html><body>502 Bad Gateway</body></html>'); return
        if u.path == '/api/money-session':     # stands in for app/session.js: the password is "demo"
            raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            try: ok = method == 'POST' and json.loads(raw or b'{}').get('password') == 'demo'
            except (ValueError, AttributeError): ok = False
            if method == 'POST' and not ok:
                self.send_response(401); self.send_header('X-Dash-Auth', 'required'); self.end_headers(); return
            self.send_response(204)
            self.send_header('Set-Cookie', 'money_session=%s; Path=/api/; HttpOnly; SameSite=Strict' % ('demo' if ok else '') + ('' if ok else '; Max-Age=0'))
            self.end_headers(); return
        if 'money_session=demo' not in (self.headers.get('Cookie') or ''):
            self.send_response(401); self.send_header('X-Dash-Auth', 'required'); self.end_headers(); return
        if not self.headers.get('X-Money'): self.send_response(403); self.end_headers(); return
        if u.path == '/api/money-ingest':      # stands in for app/ingest.js: the key Settings → Apple Pay shows
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b'{"key":"demo-key"}'); return
        body = {}
        if method in ('POST', 'PUT'):
            raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            try: body = json.loads(raw or b'{}')
            except ValueError: pass
        try: out = handle(u.path[len('/api/v1'):], q, method, body if isinstance(body, dict) else {})
        except NotFound:
            self.send_response(404); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b'{"message":"Resource not found"}'); return
        if out is None: self.send_response(204); self.end_headers(); return
        b = json.dumps(out).encode(); self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b)
    def do_GET(self): self._go('GET')
    def do_DELETE(self): self._go('DELETE')
    def do_POST(self): self._go('POST')
    def do_PUT(self): self._go('PUT')

if not os.path.isfile(os.path.join(os.path.dirname(os.path.abspath(INDEX)), 'assets', 'js', 'app.js')):
    print('The app isn\'t built yet: run  npm install && npm run build  (or npm run watch) first.')
print('Demo running at http://127.0.0.1:%d  (password: demo)' % PORT)
ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
