"""Smoke test: opens every page and every "new …" form against the demo server and fails on any JS error.

    pip install playwright && playwright install chromium
    python3 dev/mock_server.py &        # in another terminal
    python3 dev/smoke_test.py           # optional: --shots docs/screenshots
"""
import asyncio, os, re, sys
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')   # e.g. a flaky demo server: BASE=http://127.0.0.1:8766/
PAGES = ['', 'forecast', 'transactions', 'inbox', 'review', 'accounts', 'account/1', 'account/3?range=all', 'account/102', 'loans', 'budgets', 'categories',
         'bills', 'recurring', 'piggy', 'rules', 'reports', 'reports?preset=last-3&cmp=year', 'recap', 'map', 'settings', 'cleanup',
         'forecast?days=365', 'ask', 'ask?q=why%20did%20I%20spend%20more%20this%20month', 'ask?q=which%20bills%20are%20due%20before%20payday', 'ask?q=biggest%20expense%20last%20month']
# The markup's event handlers (data-onclick="App.x(…)") in the page and the TypeScript sources (not the minified
# bundle), with the JS concatenations ' + … + ' and template values ${…} filled in with 1
_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app')
_src = open(os.path.join(_root, 'index.html')).read() + ''.join(
    open(os.path.join(d, f)).read() for d, _, fs in os.walk(os.path.join(_root, 'src')) for f in fs if f.endswith('.ts'))
HANDLERS = sorted({re.sub(r"\$\{(?:[^{}]|\{[^{}]*\})*\}", '1', re.sub(r"' \+ .*? \+ '", '1', h)).replace("\\'", "'") for h in re.findall(r'data-on[a-z]+="(.*?)"', _src)})
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
# The page for the current hash has painted (not the previous page or the loading skeleton) and no animation is running
# (a function, not an expression: Playwright evals expressions, which the Content-Security-Policy refuses)
PAINTED = """() => { const r = parseHash(); return !S.vtRun && S.pageKey && S.pageKey.startsWith(r.name + '/' + r.id + '?')
  && document.querySelector('#view .head .actions, #view .error'); }"""


async def goto(page, route):
    await page.goto(BASE + '#/' + route)
    await page.wait_for_function(PAINTED, timeout=15000)


async def check(pw, width, height, mobile):
    br = await pw.chromium.launch()
    ctx = await br.new_context(viewport={'width': width, 'height': height}, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
    # MONEY_CHECK_HTML makes html`` log markup that it escaped and html`` joined with + (see app/src/core/html.ts)
    await ctx.add_init_script("window.MONEY_CHECK_HTML = true")
    page = await ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(f'{page.url}: {e}'))
    # anything the Content-Security-Policy blocks (the mock server sends the same policy as nginx)
    page.on('console', lambda m: any(k in m.text for k in ('Content Security Policy', 'Escaped HTML-looking text', 'Html joined with +')) and errors.append(f'{page.url}: {m.text}'))
    # Signing in (the static demo needs none and never shows the sign-in screen)
    await page.goto(BASE)
    if mobile:          # with the form
        await page.wait_for_selector('#login:not([hidden]), #app:not([hidden])')
        if await page.locator('#login:not([hidden])').count():
            await page.fill('#loginPw', 'nope'); await page.click('#loginForm button[type=submit]')
            await page.wait_for_selector('#loginErr:not([hidden])')
            await page.fill('#loginPw', 'demo'); await page.click('#loginForm button[type=submit]')
    else:               # a password saved by an older version is traded for a session, then deleted
        await page.evaluate("localStorage.setItem('moneyKey', 'demo')"); await page.reload()
    await page.wait_for_function(PAINTED, timeout=15000)
    if await page.evaluate("localStorage.getItem('moneyKey')"): errors.append('the password saved by an older version was not deleted')
    # every data-on* handler in the source parses and calls an App method that exists
    if not mobile:
        await goto(page, '')
        for h in HANDLERS:
            bad = await page.evaluate('''h => { try { const p = parseHandler(h); const miss = p.filter(s => s.fn && typeof App[s.fn] !== 'function');
              return miss.length ? 'no App.' + miss[0].fn : ''; } catch (e) { return e.message; } }''', h)
            if bad: errors.append(f'handler {h!r}: {bad}')
    for p in PAGES:
        await goto(page, p)
        await page.wait_for_timeout(300)
        if await page.locator('#view .error').count():
            errors.append(f'#{p}: page showed an error: ' + await page.inner_text('#view .error'))
        # open each primary "new …" button on the page, then close the drawer
        buttons = page.locator('#view .head .actions button.btn.primary:visible')   # (New transaction is hidden on phones: the + does it)
        for i in range(await buttons.count()):
            await buttons.nth(i).click()
            await page.wait_for_timeout(600)
            if not await page.evaluate("el('drawer').classList.contains('open')"):
                errors.append(f'#{p}: button {i} did not open a form')
            await page.keyboard.press('Escape')
            await page.wait_for_timeout(500)
    # Universal search: from the search button on phones and ⌘K on computers, finds settings and transactions
    await goto(page, '')
    if mobile: await page.click('#searchBtn')
    else: await page.keyboard.press('Control+k')
    await page.wait_for_selector('#palette:not([hidden])')
    await page.locator('#palQ').press_sequentially('acme'); await page.wait_for_selector('#palList .pal-item .num', timeout=5000)
    await page.locator('#palList .pal-item:has(.num)').first.click(); await page.wait_for_selector('#drawer.open #txForm')
    await page.keyboard.press('Escape'); await page.wait_for_selector('#drawer:not(.open)', state='attached')
    await page.evaluate('App.openPalette()'); await page.locator('#palQ').press_sequentially('csv backup')
    await page.wait_for_selector('#palList .pal-item.on .pal-l:text-is("Export to CSV")')
    await page.keyboard.press('Enter'); await page.wait_for_selector('#view details[data-k="export"][open].pal-flash', timeout=8000)
    # a few interactions
    await goto(page, 'transactions'); await page.wait_for_selector('tr[data-gid]')
    await page.locator('tr[data-gid]').first.click(); await page.wait_for_selector('#drawer.open #txForm')   # (a closed drawer keeps its last form)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(500)
    await page.evaluate('App.quickAdd()'); await page.wait_for_selector('#nlq')
    await page.locator('#nlq').press_sequentially('coffee 4.50 yesterday'); await page.wait_for_timeout(300)
    if await page.evaluate('S.form.splits[0].amount') != '4.50':
        errors.append('quick add did not parse the amount')
    await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
    # Duplicate a transaction, keep a draft, and months that start on the 15th
    await page.locator('tr[data-gid]').first.click(); await page.wait_for_function('() => S.form && S.form.id && el("txForm")')
    await page.evaluate('App.duplicateTx()'); await page.wait_for_timeout(300)
    if await page.evaluate("S.form.id + '|' + S.form.splits.map(s => s.jid).join('')") != '|':
        errors.append('duplicate kept the original transaction ids')
    # A refund made from an expense: an income into the same account, tagged Refund (and not saved, since the demo can't)
    await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
    await page.evaluate("App.editTx(Object.values(S.txMeta).find(m => m.g.type === 'withdrawal').g.id)"); await page.wait_for_function('() => S.form && S.form.id && el("txForm")')
    await page.evaluate('App.refundTx()'); await page.wait_for_timeout(300)
    if await page.evaluate("S.form.type + '|' + S.form.id + '|' + S.form.splits[0].tags + '|' + !!S.form.refundOf") != 'deposit||Refund|true':
        errors.append('the refund form is not an income tagged Refund and linked to the purchase')
    await page.evaluate('App.duplicateTx()'); await page.wait_for_timeout(300)
    await page.evaluate('App.saveDraft()'); await goto(page, 'transactions')
    if not await page.locator('#view .panel.drafts .row').count():
        errors.append('a saved draft is not listed on Transactions')
    await page.evaluate("App.deleteDraft(JSON.parse(localStorage.getItem('money.drafts'))[0].id)"); await page.wait_for_timeout(400)
    await page.evaluate("App.setCycleDay('15')"); await goto(page, 'budgets')
    if not await page.locator('#view .month small.cycle').count():
        errors.append('months starting on the 15th do not show their dates')
    await page.evaluate("App.setCycleDay('1')"); await goto(page, 'transactions')
    await goto(page, 'review')
    if await page.locator('#view .xfer-pair').count() != 1:
        errors.append('the transfer imported as an expense and an income is not offered as a match')
    await goto(page, 'transactions'); await page.wait_for_selector('tr[data-gid]')
    # The phone's bento Overview: two small tiles to a row, Half/Full in Customize changes a tile's width and is kept
    if mobile:
        await goto(page, ''); await page.wait_for_selector('#dash.bento [data-w="spent"]')
        half = await page.evaluate("() => el('dash').querySelector('[data-w=spent]').offsetWidth / el('dash').offsetWidth")
        if not .3 < half < .6: errors.append(f'the Spent tile is not half the width on a phone: {half:.2f}')
        await page.evaluate('App.dashEdit(true)'); await page.wait_for_selector('#dash.bento.editing')
        await page.locator('#dash [data-w="spent"] .wbtn').click(); await page.wait_for_timeout(400)
        if await page.evaluate("JSON.parse(localStorage.getItem('money.dash')).size.spent") != 'm': errors.append('Full on a phone tile was not kept')
        await page.locator('#dash [data-w="spent"] button[aria-label="Move earlier"]').click(); await page.wait_for_timeout(400)
        order = await page.evaluate("JSON.parse(localStorage.getItem('money.dash')).order")
        if order.index('spent') > order.index('safe'): errors.append(f'moving a tile earlier on a phone was not kept: {order}')
        await page.evaluate('App.dashReset()'); await page.evaluate('App.dashEdit(false)')
    # a background refresh must not drop what you're in the middle of
    if not mobile:
        await page.evaluate("App.selAll(false)")
        boxes = page.locator('input[data-sel]')
        await boxes.nth(0).check(); await boxes.nth(1).check()
        await page.evaluate('refreshAll()')
        if await page.evaluate('S.sel.size') != 2:
            errors.append('a background refresh cleared the bulk-edit selection')
        await page.evaluate('App.selAll(false)')
        # switching between a cached page and one that isn't cached must not stack pages on top of each other
        for p in ['inbox', 'transactions', 'inbox', 'transactions']:
            await page.evaluate('p => { location.hash = "#/" + p; }', p); await page.wait_for_function(PAINTED, timeout=15000); await page.wait_for_timeout(300)
        if await page.locator('#view .head h1').count() != 1:
            errors.append('pages stacked up: ' + ', '.join(await page.locator('#view .head h1').all_inner_texts()))
        await goto(page, 'inbox')
        await page.evaluate('refreshAll()')
        if not await page.evaluate('!!(S.inbox && S.inbox.paint.live)'):
            errors.append('a background refresh disconnected the Categorize page from the screen')
        # "All time" in the month selector applies to every page that has one
        await goto(page, 'transactions')
        await page.locator('#view .month button', has_text='All time').click()
        await page.wait_for_selector('#view .month span:text-is("All time")', timeout=15000)
        for p in ['transactions', '', 'budgets', 'categories', 'bills', 'account/1']:
            await goto(page, p); await page.wait_for_timeout(300)
            if await page.locator('#view .error').count():
                errors.append(f'#{p} (all time): page showed an error: ' + await page.inner_text('#view .error'))
            elif p != 'account/1' and await page.locator('#view .month span', has_text='All time').count() != 1:
                errors.append(f'#{p}: the month selector did not stay on All time')
        await page.locator('#view .seg').get_by_role('button', name='Month', exact=True).click(); await page.wait_for_function(PAINTED, timeout=15000)
        if await page.evaluate('S.all'):
            errors.append('picking Month on an account did not leave All time')
        await page.locator('#view .seg').get_by_role('button', name='Month', exact=True).click()   # back to this month
        # Customize the overview: a calm set of cards to start with, the rest added from Customize, column count, hiding a tile
        await goto(page, ''); await page.wait_for_selector('#dash [data-w="spending"] .part', timeout=15000)
        for k in ['safe', 'spending', 'budgets', 'cashflow']:
            if not await page.locator(f'#dash [data-w="{k}"]').count(): errors.append(f'overview card {k!r} is missing')
        if await page.locator('#dash [data-w="payees"]').count(): errors.append('a new overview shows every card instead of the starting few')
        await page.evaluate('App.dashEdit(true)'); await page.wait_for_selector('#dashCols')
        for name in ['Top payees', 'Income sources', 'Savings goals', 'Recent transactions', 'Spending pace', 'Savings rate', 'Category trends']:
            await page.locator('.add-card', has_text=name).click(); await page.wait_for_function(PAINTED, timeout=15000); await page.wait_for_selector('#dashCols')
        await page.wait_for_selector('#dash [data-w="payees"] .part', timeout=15000)
        for k in ['payees', 'income', 'goals', 'recent', 'pace', 'savings', 'trends']:
            if not await page.locator(f'#dash [data-w="{k}"]').count(): errors.append(f'adding the {k!r} card from Customize did not show it')
        if await page.locator('.add-card', has_text='Top payees').count(): errors.append('an added card is still offered under Add cards')
        await page.locator('#dashCols button', has_text='2').click()
        await page.wait_for_timeout(600)
        if await page.evaluate("el('dash').dataset.cols + '/' + JSON.parse(localStorage.getItem('money.dash')).cols") != '2/2':
            errors.append('picking 2 columns did not apply or save')
        # freeform tiles: drag one across and down with the mouse, then resize it by its corner; tiles never overlap
        await page.locator('#dashCols button', has_text='3').click(); await page.wait_for_function(PAINTED, timeout=15000)
        await page.wait_for_selector('#dash.grid.editing'); await page.wait_for_timeout(1500)   # and let the slow cards fill in
        await page.evaluate("scrollTo(0, scrollY + el('dash').getBoundingClientRect().top - 120)")
        a = await page.locator('#dash [data-w="safe"] .wctl strong').bounding_box(); dw = (await page.locator('#dash').bounding_box())['width']
        await page.mouse.move(a['x'] + 5, a['y'] + 5); await page.mouse.down()
        for i in range(1, 16): await page.mouse.move(a['x'] + 5 + dw * .45 * i / 15, a['y'] + 5 + 60 * i / 15); await page.wait_for_timeout(30)
        await page.wait_for_timeout(250); await page.mouse.up(); await page.wait_for_timeout(500)
        moved = await page.evaluate("JSON.parse(localStorage.getItem('money.dash')).free.safe")
        if not moved or moved[0] < 8:
            errors.append(f'dragging a tile across did not move it: {moved}')
        c = await page.locator('#dash [data-w="safe"] .rsz').bounding_box()
        await page.mouse.move(c['x'] + 8, c['y'] + 8); await page.mouse.down()
        for i in range(1, 11): await page.mouse.move(c['x'] + 8 - dw * .15 * i / 10, c['y'] + 8); await page.wait_for_timeout(30)
        await page.wait_for_timeout(250); await page.mouse.up(); await page.wait_for_timeout(500)
        sized = await page.evaluate("JSON.parse(localStorage.getItem('money.dash')).free.safe")
        if not sized or sized[2] >= moved[2]:
            errors.append(f'dragging the corner did not make the tile narrower: {moved} -> {sized}')
        overlap = await page.evaluate("""() => { const r = [...document.querySelectorAll('#dash > .w')].map(w => [w.dataset.w, w.getBoundingClientRect()]);
          for (const [a, p] of r) for (const [b, q] of r) if (a < b && p.left < q.right - 1 && q.left < p.right - 1 && p.top < q.bottom - 1 && q.top < p.bottom - 1) return a + '/' + b; return ''; }""")
        if overlap: errors.append('overview tiles overlap: ' + overlap)
        await page.locator('#dashCols button', has_text='2').click(); await page.wait_for_function(PAINTED, timeout=15000); await page.wait_for_selector('#dashCols')
        await page.locator('#dash [data-w="networth"] .hbtn').click(); await page.wait_for_function(PAINTED, timeout=15000)
        await page.wait_for_selector('#dashCols')
        if await page.locator('#dash [data-w="networth"]').count() or await page.evaluate("el('dash').dataset.cols") != '2':
            errors.append('hiding the net worth tile did not stick')
        # Payees list what was spent at each one in the month picked at the top
        await goto(page, 'accounts?tab=expense'); await page.wait_for_selector('#view .tbl td.amt')
        if '$' not in await page.locator('#view .tbl tbody tr td.amt').first.inner_text() or not await page.locator('#view .month').count():
            errors.append('the Payees tab does not show a total for the month')
        # Logos: the ones the server has show, the rest fall back to initials (the broken img is removed)
        await page.wait_for_timeout(800)
        logos = await page.evaluate("[...document.querySelectorAll('#view img.logo')].map(i => i.complete && i.naturalWidth > 0 && i.classList.contains('ok'))")
        # (the static demo build has no logo server, so there every logo falls back)
        if not all(logos) or (not logos and '/demo/' not in BASE): errors.append(f'payee logos did not load or fall back cleanly: {logos}')
        # Bills calendar: the demo's monthly bills sit on their days
        await goto(page, 'bills?view=calendar'); await page.wait_for_selector('#view .bcal-grid')
        if await page.locator('#view .bcal .bpill').count() < 3: errors.append('the bills calendar shows fewer than 3 bills')
        # To do: the nav's To do opens Review, and its tabs switch to Categorize and back
        await page.locator('.nav a[href="#/review"]').click(); await page.wait_for_function(PAINTED, timeout=15000)
        await page.locator('#view .tabs a[href="#/inbox"]').click(); await page.wait_for_function(PAINTED, timeout=15000)
        if not await page.locator('.nav a.on[href="#/review"]').count(): errors.append('To do is not highlighted in the sidebar on the Categorize tab')
        # Clean up: the demo's unused payee, income source, category and budget are found, and deleting one takes it away
        await goto(page, 'cleanup'); await page.wait_for_selector('#view .cleanup')
        names = await page.locator('#view .cleanup .name').all_inner_texts()
        for n in ('Old Gym Membership', 'Garage sale', 'Hobbies', 'Fun'):
            if n not in names: errors.append(f'Clean up did not find the unused {n!r}')
        if 'Green Grocer' in names: errors.append('Clean up offered a payee that has transactions')
        await page.locator('#view .cleanup label', has_text='Old Gym Membership').click()
        await page.locator('#view .cleanup form[data-kind="payees"] > .btn').click(); await page.locator('#confirm .btn.primary').click()
        await page.wait_for_function(PAINTED, timeout=15000); await page.wait_for_timeout(600)
        if await page.locator('#view .cleanup .name', has_text='Old Gym Membership').count(): errors.append('a payee deleted in Clean up is still listed')
        # Review: ticking one off takes it out of the queue
        await goto(page, 'review'); await page.wait_for_selector('#view .review-row')
        n = await page.locator('#view .review-row').count()
        await page.locator('#view .review-row .btn').first.click(); await page.wait_for_timeout(900)
        if await page.locator('#view .review-row').count() != n - 1: errors.append('ticking off a transaction did not take it out of the review queue')
        # Forecast what-if: adding one puts it in the list of what's coming
        await goto(page, 'forecast'); await page.wait_for_selector('form.whatif')
        await page.fill('form.whatif input[name=label]', 'Smoke test laptop'); await page.fill('form.whatif input[name=amount]', '900')
        await page.locator('form.whatif button').click()
        # The forecast redraws after the click; wait for the row instead of a fixed pause (slow CI runners missed it)
        try: await page.locator('#view .tbl .desc', has_text='Smoke test laptop').first.wait_for(timeout=10000)
        except Exception: errors.append('a forecast what-if did not show up')
        await goto(page, ''); await page.wait_for_selector('#dash [data-w="payees"] .part', timeout=15000)
        await page.evaluate('App.dashEdit(true)'); await page.wait_for_selector('#dashCols')
        # A tile's own settings: fewer recent transactions
        await page.locator('#dash [data-w="recent"] .obtn').click(); await page.wait_for_selector('#dash [data-w="recent"] .wopts:not([hidden]) select')
        await page.locator('#dash [data-w="recent"] .wopts select').select_option('5'); await page.wait_for_function(PAINTED, timeout=15000)
        await page.wait_for_selector('#dash [data-w="recent"] tr.click')
        n = await page.locator('#dash [data-w="recent"] tr.click').count()
        if n != 5: errors.append(f'the recent transactions setting showed {n} rows instead of 5')
        await page.evaluate('App.dashReset()'); await page.wait_for_function(PAINTED, timeout=15000)
        if not await page.locator('#dash [data-w="networth"]').count(): errors.append('Reset did not bring the net worth tile back')
        await page.evaluate('App.dashEdit(false)')
        # Signing out ends the session: the API refuses until you sign in again
        if '/demo/' not in BASE:
            await page.evaluate('App.signOut()'); await page.wait_for_selector('#login:not([hidden])')
            # (the sign-out request may still be on its way, and the flaky demo server answers some reads with a 502)
            st = await page.evaluate('''async () => { for (let i = 0; i < 20; i++) { const s = (await fetch('/api/v1/about', { headers: { 'X-Money': '1' } })).status;
              if (s !== 502 && s !== 200) return s; await new Promise(r => setTimeout(r, 200)); } return 'still signed in'; }''')
            if st != 401: errors.append(f'the session still worked after signing out: {st}')
    await br.close()
    return errors


async def screenshots(pw, out):
    br = await pw.chromium.launch()
    async def shot(route, name, w=1440, h=900, mobile=False, theme='glass', action=None, full=False):
        ctx = await br.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        await ctx.add_cookies([{'name': 'money_session', 'value': 'demo', 'url': BASE.split('#')[0].rstrip('/') + '/api/'}])
        if theme: await ctx.add_init_script(f"localStorage.setItem('moneyTheme','{theme}')")
        pg = await ctx.new_page(); await pg.goto(BASE + '#/' + route)
        await pg.wait_for_function(PAINTED); await pg.wait_for_function("() => !document.querySelector('#view .sk, #view [aria-busy]')"); await pg.wait_for_timeout(1200)
        if action: await action(pg)
        await pg.screenshot(path=f'{out}/{name}.png', full_page=full); await ctx.close()
    async def open_tx(pg):
        await pg.locator('tr[data-gid] .desc').nth(1).click(); await pg.wait_for_selector('#txForm'); await pg.wait_for_timeout(700)
    async def quick_add(pg):
        await pg.evaluate('App.quickAdd()'); await pg.wait_for_selector('#nlq'); await pg.wait_for_timeout(300)
        await pg.locator('#nlq').press_sequentially('coffee 5.40 rewards yesterday', delay=10); await pg.wait_for_timeout(500)
    async def to_flow(pg):
        await pg.evaluate("document.querySelector('[data-w=flow]').scrollIntoView({block:'end'})"); await pg.evaluate('scrollBy(0,30)'); await pg.wait_for_timeout(500)
    await shot('', 'overview')
    await shot('', 'overview-charts', action=to_flow)
    await shot('transactions', 'transactions')
    await shot('transactions', 'quick-add', action=quick_add)
    await shot('', 'overview-light', theme='light')
    await shot('', 'phone-overview', 390, 844, True)
    await shot('transactions', 'phone-edit-sheet', 390, 844, True, action=open_tx)
    for k in ['dark', 'carbon', 'midnight', 'neon', 'ocean', 'sunrise', 'forest', 'nord', 'rose', 'frosted']:   # one per theme, for the theme gallery
        await shot('', f'theme-{k}', theme=k)
    await br.close()


async def main():
    async with async_playwright() as pw:
        errs = await check(pw, 1440, 900, False) + await check(pw, 390, 844, True)
        if SHOTS:
            await screenshots(pw, SHOTS)
    if errs:
        print('FAILED'); [print(' -', e) for e in errs]; sys.exit(1)
    print('OK: every page and form opened without errors (desktop + phone)')

asyncio.run(main())
