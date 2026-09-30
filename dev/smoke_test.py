"""Smoke test: opens every page and every "new …" form against the demo server and fails on any JS error.

    pip install playwright && playwright install chromium
    python3 dev/mock_server.py &        # in another terminal
    python3 dev/smoke_test.py           # optional: --shots docs/screenshots
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8765/')   # e.g. a flaky demo server: BASE=http://127.0.0.1:8766/
PAGES = ['', 'forecast', 'transactions', 'inbox', 'accounts', 'account/1', 'account/3?range=all', 'loans', 'budgets', 'categories',
         'bills', 'recurring', 'piggy', 'rules', 'reports', 'settings']
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
# The page for the current hash has painted (not the previous page or the loading skeleton) and no animation is running
PAINTED = """(() => { const r = parseHash(); return !S.vtRun && S.pageKey && S.pageKey.startsWith(r.name + '/' + r.id + '?')
  && document.querySelector('#view .head .actions, #view .error'); })()"""


async def goto(page, route):
    await page.goto(BASE + '#/' + route)
    await page.wait_for_function(PAINTED, timeout=15000)


async def check(pw, width, height, mobile):
    br = await pw.chromium.launch()
    ctx = await br.new_context(viewport={'width': width, 'height': height}, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
    await ctx.add_init_script("localStorage.setItem('moneyKey','demo')")
    page = await ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(f'{page.url}: {e}'))
    for p in PAGES:
        await goto(page, p)
        await page.wait_for_timeout(300)
        if await page.locator('#view .error').count():
            errors.append(f'#{p}: page showed an error: ' + await page.inner_text('#view .error'))
        # open each primary "new …" button on the page, then close the drawer
        buttons = page.locator('#view .head .actions button.btn.primary')
        for i in range(await buttons.count()):
            await buttons.nth(i).click()
            await page.wait_for_timeout(600)
            if not await page.evaluate("el('drawer').classList.contains('open')"):
                errors.append(f'#{p}: button {i} did not open a form')
            await page.keyboard.press('Escape')
            await page.wait_for_timeout(500)
    # a few interactions
    await goto(page, 'transactions'); await page.wait_for_selector('tr[data-gid]')
    await page.locator('tr[data-gid]').first.click(); await page.wait_for_selector('#txForm')
    await page.keyboard.press('Escape'); await page.wait_for_timeout(500)
    await page.evaluate('App.quickAdd()'); await page.wait_for_selector('#nlq')
    await page.locator('#nlq').press_sequentially('coffee 4.50 yesterday'); await page.wait_for_timeout(300)
    if await page.evaluate('S.form.splits[0].amount') != '4.50':
        errors.append('quick add did not parse the amount')
    await page.keyboard.press('Escape'); await page.wait_for_timeout(400)
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
            await page.locator('.nav a[href="#/' + p + '"]').click(); await page.wait_for_function(PAINTED, timeout=15000); await page.wait_for_timeout(300)
        if await page.locator('#view .head h1').count() != 1:
            errors.append('pages stacked up: ' + ', '.join(await page.locator('#view .head h1').all_inner_texts()))
        await goto(page, 'inbox')
        await page.evaluate('refreshAll()')
        if not await page.evaluate('!!(S.inbox && S.inbox.paint.live)'):
            errors.append('a background refresh disconnected the Categorize page from the screen')
    await br.close()
    return errors


async def screenshots(pw, out):
    br = await pw.chromium.launch()
    async def shot(route, name, w=1440, h=900, mobile=False, theme='glass', action=None, full=False):
        ctx = await br.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile, device_scale_factor=2 if mobile else 1)
        await ctx.add_init_script("localStorage.setItem('moneyKey','demo');" + (f"localStorage.setItem('moneyTheme','{theme}');" if theme else ''))
        pg = await ctx.new_page(); await pg.goto(BASE + '#/' + route)
        await pg.wait_for_function(PAINTED); await pg.wait_for_function("!document.querySelector('#view .sk, #view [aria-busy]')"); await pg.wait_for_timeout(1200)
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
