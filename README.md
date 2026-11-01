# Money: a modern frontend for Firefly III

[![Latest release](https://img.shields.io/github/v/release/Muffy0906/firefly-money)](https://github.com/Muffy0906/firefly-money/releases)
[![Smoke test](https://github.com/Muffy0906/firefly-money/actions/workflows/smoke-test.yml/badge.svg)](https://github.com/Muffy0906/firefly-money/actions/workflows/smoke-test.yml)
[![Docker image](https://img.shields.io/badge/image-ghcr.io%2Fmuffy0906%2Ffirefly--money-blue?logo=docker&logoColor=white)](https://github.com/Muffy0906/firefly-money/pkgs/container/firefly-money)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Money is a fast, mobile-friendly web app for [Firefly III](https://www.firefly-iii.org/), the self-hosted personal finance manager. It sits beside your existing Firefly server and talks to it through the Firefly API. It doesn't change or replace Firefly, and your data never leaves your server.

It's a small static web app (TypeScript bundled into one script) served by a small nginx container, with no server code of its own.

**[Try the live demo →](https://muffy0906.github.io/firefly-money/)** It runs entirely in your browser with made-up data, so there's nothing to install and no sign-in.

![Overview in the Frosted glass theme](docs/screenshots/overview.png)

<p>
  <img src="docs/screenshots/overview-charts.png" width="49%" alt="Money flow, daily spending calendar and loans on the Overview">
  <img src="docs/screenshots/quick-add.png" width="49%" alt="Natural-language quick add">
</p>
<p>
  <img src="docs/screenshots/phone-overview.png" width="24%" alt="Phone overview">
  <img src="docs/screenshots/phone-overview-charts.png" width="24%" alt="Phone overview: spending ring, cash and credit cards">
  <img src="docs/screenshots/phone-transactions.png" width="24%" alt="Phone transactions">
  <img src="docs/screenshots/phone-edit-sheet.png" width="24%" alt="Phone edit sheet">
</p>

*Screenshots use the built-in demo data (all names and amounts are made up), in the Frosted glass theme. The [live demo](https://muffy0906.github.io/firefly-money/) opens in the same theme and layout.*

### One page in each theme

12 built-in themes, and you can tweak each one's colors in Settings → Appearance. Calm can also follow your system's light or dark mode.

| | | |
|:-:|:-:|:-:|
| <img src="docs/screenshots/theme-glass-transactions.png" alt="Transactions in the Liquid glass neon theme"><br>Transactions · Liquid glass neon | <img src="docs/screenshots/theme-light-reports.png" alt="Reports in the Calm light theme"><br>Reports · Calm light | <img src="docs/screenshots/theme-dark-forecast.png" alt="Forecast in the Calm dark theme"><br>Forecast · Calm dark |
| <img src="docs/screenshots/theme-carbon-budgets.png" alt="Budgets in the Carbon neon theme"><br>Budgets · Carbon neon | <img src="docs/screenshots/theme-midnight-bills.png" alt="Bills in the Midnight theme"><br>Bills · Midnight | <img src="docs/screenshots/theme-neon-ask.png" alt="Ask in the Neon theme"><br>Ask · Neon |
| <img src="docs/screenshots/theme-ocean-piggy.png" alt="Piggy banks in the Ocean theme"><br>Piggy banks · Ocean | <img src="docs/screenshots/theme-sunrise-recap.png" alt="Monthly recap in the Sunrise theme"><br>Monthly recap · Sunrise | <img src="docs/screenshots/theme-forest-year.png" alt="Year in Money in the Forest theme"><br>Year in Money · Forest |
| <img src="docs/screenshots/theme-nord-todo.png" alt="To do in the Nord theme"><br>To do · Nord | <img src="docs/screenshots/theme-rose-categories.png" alt="Categories & tags in the Rosé theme"><br>Categories & tags · Rosé |  |

## Why Money?

Firefly III is a great engine for your finances. Money is a faster, friendlier way to use it every day:

- **Built for your phone as much as your desktop:** bottom tabs, swipe gestures, bottom sheets, and installable as an app.
- **Add a transaction in one line:** type `coffee 5.40 amex yesterday` and it fills in the rest, including the category from last time.
- **Answers at a glance:** how much is safe to spend until payday, which categories are running hot this month, and which bills are coming up.
- **Nothing to migrate:** it uses your existing Firefly data and works alongside Firefly's own interface. Stop using it any time.
- **One small container:** no database and no server code. Your Firefly token stays on the server.

## Features

**Everyday use**
- **Overview:** net worth, spending by category against last month, budgets, balances with 30-day sparklines, loans, upcoming bills, top payees, income sources, savings goals, cash flow, a daily-spending calendar and a money-flow chart.
- **Insight cards:** short notes like "Dining is 46% above usual", "Groceries budget may run out around the 24th" or "Card payment due in 4 days". They compare this month with the same point in each of the last three months.
- **Customizable dashboard:** place cards anywhere as freeform tiles that snap to a fine grid (24 columns) and resize them by the corner, make them full width, or hide them. Start from 1 to 4 columns (or Auto), turn the net-worth summary and insight strip on or off. A new Overview starts with six cards (Safe to spend, Needs attention, Where it went, Budgets, Coming up, Cash flow); the rest wait under Customize → Add cards: Net worth, balances, loans, Daily spending, Money flow, Top payees, Income sources, Savings goals, Recent transactions, and the charts **Spending pace** (this month's running total against last month, day by day, and where it's heading), **Savings rate** (the share of each month's income you kept) and **Category trends** (your biggest categories month by month, against their usual). Cards that are off aren't fetched, so a calmer Overview also loads faster. Each card has its own settings (⚙): how many recent transactions, categories or payees to show, whether to list closed accounts, paid-off loans or reached goals, how far ahead to look for bills, and how many months the cash-flow chart covers. The layout and settings are saved in Firefly, so it follows you to every device (see **Sync between devices** below).
- **Payees and income sources:** the Accounts tabs show how much went to each payee, or came from each income source, in the month picked at the top (or all time), busiest first. Each payee's page sums up its last twelve months: total, per month, typical charge, how often, a bar per month, its categories and the bill it pays.
- **Logos:** payees, banks and cards show their logo (Walmart, Chase, Netflix…) instead of initials. The website is guessed from the name and can be changed in the account’s settings; your Money server fetches the logo from DuckDuckGo’s icon service and caches it for a month (`/logo/`), so the browser never contacts another site. Turn it off in Settings → Logos.
- **Safe-to-spend forecast:** detects your paydays and subtracts upcoming bills, recurring transactions, card payoffs and loan payments.
- **What-ifs:** try a purchase, a raise or a new subscription (once, monthly or every two weeks) on the Forecast page and see the balance with and without it.
- **Forecast range and accuracy:** look 30 days to a year ahead, with a careful-to-hopeful band (careful: only steady paychecks arrive and bills run 10% higher). Each day the forecast notes the balance it expects 30 days out and later shows how close it came.
- **Months that start on payday:** Settings → Months & budgets sets the day a month starts (the 1st to the 28th). Budgets, the Overview, insights, recaps and reports all use it.
- **Budget pace:** each budget shows where today falls in the month, whether spending is on pace, and when it may run out. The warning level (85% by default) is in Settings.
- **Ask:** plain questions like "why did I spend more this month?", "which bills are due before payday?" or "how much did I spend on groceries this year?", answered from your data with how it was worked out and links to the transactions. It uses no AI; questions it doesn't know become a search.
- **Bills calendar:** the Bills page can show the month as a calendar, with each bill on the day it was paid or is due, and totals for paid, still due and overdue.
- **Monthly recap:** a page per month with what came in and went out against a usual month, where the money went, the biggest purchases, new payees, bills and the change in net worth.
- **Year in Money:** your year as a story of full-screen cards (Insights → Year in Money): what came in and went out, how much of each workday paid for your spending, your top category and places, your biggest month and purchase, days you bought nothing, and your net worth's change. Tap or swipe to move, hold to pause, share a summary at the end. The Overview offers it in December.
- **Time scrubber:** drag along the Net worth card's line and the card goes back to that month: the total, assets, debts and the accounts that moved most since then. Let go and it offers that month's Overview.
- **Hours of work:** Settings → Appearance → Hours of work shows under each purchase how long you worked for it ("1.5 h", "3 d"), from your take-home over the last six months and the hours you work a week, or an hourly rate you set.
- **Review queue:** new transactions (from imports, rules or other apps) wait on the Review page until you tick them off or mark them all reviewed. It also finds transfers between your accounts that were imported as an expense and an income, and makes each pair one transfer in a tap.
- **Transactions:** the month at a glance (spent, earned, net, and a bar for each day's spending: tap one to jump to that day), search and filters in one row, and a feed with each day as its own card, merchant avatars ringed in their category's colour (the same as in the spending donut) and infinite scroll. You can change a category or budget inline, edit several at once, split, search, attach files and link transactions. Duplicate copies a transaction, splits and all, dated today, and Save as draft keeps a new one on a Drafts list until you add it.
- **Refunds:** open an expense and tap Refund. Money fills in an income into the account you paid from, with the same payee and category, tagged `Refund` and linked to the purchase (change the amount if only part came back). Reports, Budgets, the overview and the recap take refunds off spending instead of counting them as income, and the budget comes from the linked purchase. Quick add works too: `amazon refund 42.10 amex`.
- **Quick add in plain words:** type `coffee 5.40 amex yesterday`, `paycheck 2850 chase` or `transfer 400 from checking to savings last friday` and the form fills itself in. Payee memory then fills in the category and budget from the last time.
- **Apple Pay auto-logging:** an iPhone Shortcut sends each Apple Pay tap to Money, which adds it to the card's account with the category from last time, tagged "Apple Pay". Set up in Settings → Apple Pay; see [docs/apple-pay.md](docs/apple-pay.md).
- **Map:** purchases that have a place (the Apple Pay shortcut can send your location) as pins for the month, one per merchant and sized by what you spent there. Tap a pin to see its purchases. Your Money server fetches the map pictures from OpenStreetMap and keeps them for a month (`/tile/`), so the browser never contacts another site.
- **Categorize inbox:** go through uncategorized expenses with keyboard shortcuts, and create a rule in one click.
- **Net worth over time:** a card with month-end net worth for the last year (or each quarter for three years), with assets and debts.
- **Find subscriptions:** the Bills page spots charges that repeat every week, month, quarter or year but aren't bills yet, and adds one as a bill in a tap, with a rule that links its past and future charges. It also flags subscriptions and bills whose price went up.
- **Savings goal pace:** each piggy bank with a target date shows what to save per month to reach it on time, and whether it's on track or behind an even pace.
- **Auto-budgets:** set a budget to the same amount every week, month, quarter or year, roll over what's left, or adjust for overspending. The budgets page shows what carried over.
- **Sync between devices:** the Overview layout, month start day, drafts, saved reports, dismissed insights, forecast choices and what-ifs, loan plans and what you've reviewed are saved as a Firefly user preference, so every device sees them. Theme, hidden amounts and density stay per device, and sync can be turned off per device in Settings.
- **Loan payoff planner:** compare snowball, avalanche and no-rollover strategies.
- **Covers most of Firefly:** accounts and reconciliation, budgets and available budget, categories, tags, bills, recurring transactions, piggy banks, the rules editor (with test and run), reports (compare with the period before or last year, save a report, download it as CSV), currencies and exchange rates, CSV exports and webhooks.

**Feel**
- Animated page and edit-panel transitions (View Transitions API), with instant fallback in other browsers and when reduced motion is on.
- Changes show right away and roll back if Firefly refuses them. Deleting has an undo option.
- **Phone:** bottom tab bar, bottom sheets you can drag down to close, swipe a transaction left to categorize or delete it, pull to refresh, and light vibration on supported devices.
- **Keyboard:**
  - `J`/`K` move through transactions and `Enter` opens one.
  - `C` and `B` change the category or budget, and `X` selects.
  - `N` adds a transaction, `/` searches, `⌘/Ctrl-K` opens the command palette, and `P` hides amounts.
  - `?` lists all the shortcuts.
- Nine themes (Calm light, dark and auto; Midnight; Neon; Liquid glass neon; Ocean; Sunrise; Carbon neon), a **hide amounts** privacy mode and a **compact** density option.
- Installable as an app (PWA). It keeps no copy of your Firefly data on the device: when Firefly III (or the network) can't be reached, it says so instead of showing old numbers, and comes back by itself. A pill in the sidebar (and the phone's More menu) shows whether Firefly is connected.

## How it works

```
Browser ──(session cookie)──▶ nginx container ──(your Firefly token)──▶ Firefly III API
          serves the app         checks the session,
                                 adds the token, proxies /api/
```

- nginx serves the app (`index.html` and its `assets/`) and proxies `/api/*` to Firefly III.
- Your Firefly **access token lives only in the nginx container**. It's added on the server side and never sent to the browser.
- Signing in with the **dashboard password** gives the browser a session cookie, signed by nginx (`app/session.js`, nginx's built-in JavaScript module). API calls without a valid session get `401`. The cookie is `HttpOnly`, so the page's own scripts can't read it, and the password itself is never stored in the browser.

## Requirements

- A running **Firefly III** (built for 6.x; uses API v1).
- A Firefly **Personal Access Token**: in Firefly go to *Profile → Remote access and tokens* and create a new Personal Access Token.
- Docker (or any way to run `nginx:alpine`). It uses very little memory.

## Quick start (Docker)

On **TrueNAS SCALE**, install **Money** from the app catalog instead, see [TrueNAS SCALE](#truenas-scale) below.

Every push to `main` builds a ready-to-run image, `ghcr.io/muffy0906/firefly-money`, using GitHub Actions (`.github/workflows/docker.yml`). You don't need to download any files, just the compose file:

```bash
mkdir money && cd money
curl -O https://raw.githubusercontent.com/muffy0906/firefly-money/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/muffy0906/firefly-money/main/.env.example
# edit .env (the image name in docker-compose.yml already points at this repo's build)
docker compose up -d
```

Open `http://<your-server>:8090` and sign in with your `DASH_PASSWORD`.

| Variable        | What it is |
|-----------------|------------|
| `FIREFLY_URL`   | How the container reaches Firefly, e.g. `http://192.168.1.20:8080` or `http://firefly:8080` (same Docker network). No trailing slash. It's also used for the sidebar's "Open Firefly III" link, so a LAN address works better than a Docker-only hostname if you want that link to work. |
| `FIREFLY_TOKEN` | Your Firefly Personal Access Token. |
| `DASH_PASSWORD` | The password for the Money sign-in screen. Use something long. Changing it signs every device out. |
| `MONEY_PORT`    | Port on the host (default `8090`). |
| `LISTEN_PORT`   | Port inside the container (default `80`). Only needed when you run the container as a non-root user (e.g. `user: "568:568"`) on a host that doesn't let such users use ports below 1024; then set something like `8080` and map the host port to it. |

**Updating:** `docker compose pull && docker compose up -d`. To stay on a fixed version instead of `latest`, use a release tag such as `:1.2.0`. Those images are built when you push a tag like `v1.2.0`.

**Prefer plain files?** The comments at the bottom of `docker-compose.yml` show how to run the stock `nginx` image with `app/index.html`, `app/default.conf.template` and the `app/assets` folder mounted from a folder. Build the scripts into `app/assets/js` first with `npm install && npm run build` (needs Node.js 20 or newer). In that setup, you update by pulling the repo, building again and restarting the container.

### TrueNAS SCALE

Money is in the TrueNAS **community** app catalog, so you install it like any other app:

1. Go to **Apps → Discover Apps** and search for **Money**. If it doesn't show up, click **⋮ → Refresh Catalog** (TrueNAS only syncs the catalog about once a day).
2. Click **Install** and fill in the **Money Configuration** section:
   - **Firefly III URL**: how the NAS reaches Firefly, e.g. `http://192.168.1.20:8080`. No trailing slash.
   - **Firefly III Personal Access Token**: your Firefly token.
   - **Sign-in Password**: the password for the Money sign-in screen. Use something long.
3. Leave the **WebUI Port** at its default, `30530`, unless something else uses it. Click **Install**.
4. When the app is running, click **Web UI** (or open `http://<your-nas>:30530`) and sign in with your password.

**Updating:** new releases reach the catalog a little after they're tagged here. The app then shows **Update available**, and **Update** pulls the new version and restarts it. To check which version is running, open **Settings → About** in Money.

<details>
<summary><b>Install via YAML instead</b> (older TrueNAS, or to track <code>latest</code> from <code>main</code>)</summary>

**Apps → Discover Apps → ⋮ → Install via YAML**, give it a name like `money`, and paste:

```yaml
services:
  money:
    image: ghcr.io/muffy0906/firefly-money:latest
    pull_policy: always          # fetch the newest image whenever the app is (re)started
    restart: unless-stopped
    ports:
      - "8090:80"
    environment:
      FIREFLY_URL: http://192.168.1.20:8080
      FIREFLY_TOKEN: paste-your-token
      DASH_PASSWORD: choose-a-long-password

# Adds the "Web UI" button to the app in TrueNAS. Keep the port the same as the one above.
x-portals:
  - name: Web UI
    scheme: http
    host: 0.0.0.0
    port: 8090
    path: /
```

`host: 0.0.0.0` means "this NAS's address". To update, **Stop** and **Start** the app: `pull_policy: always` makes it fetch the newest image on start. Apps installed this way have no icon; if you want one, set `icon: https://raw.githubusercontent.com/Muffy0906/firefly-money/main/docs/icon.png` in `/mnt/.ix-apps/app_configs/<app-name>/metadata.yaml` (from **System → Shell**) and refresh the Apps page.

If you switch from a YAML install to the catalog app, delete the old app first so the two don't both run.

</details>

### Unraid

Until Money is in Community Applications, add it from the template in this repo. Open the Unraid terminal (the `>_` icon at the top right) and run:

```bash
wget -O /boot/config/plugins/dockerMan/templates-user/my-firefly-money.xml \
  https://raw.githubusercontent.com/Muffy0906/firefly-money/main/unraid/firefly-money.xml
```

Then go to **Docker → Add Container**, pick **firefly-money** under **Template**, fill in the Firefly URL, token and dashboard password, and click **Apply**. Updates show up on the Docker tab like any other container.

### Running behind a reverse proxy

Point your proxy (Caddy, Traefik, Nginx Proxy Manager, Cloudflare Tunnel…) at the container's port. Two things to know:
- **Use HTTPS** for anything beyond your home network. The session cookie is sent with every request (and marked `Secure` when the proxy says the request came over HTTPS with `X-Forwarded-Proto`).
- Installing as an app only works over HTTPS (or on `localhost`).

## Security notes

- Money has **one shared password** and no user accounts. Treat it like the key to your finances. The safest setup is on your LAN or behind a VPN (Tailscale, WireGuard), or behind a reverse proxy that adds its own sign-in (Authelia, Cloudflare Access…).
- Sign-in attempts are limited to 10 a minute (after a first 5) per address, and API calls to 50 a second with large bursts allowed, which only stops floods. Behind a reverse proxy all visitors share the proxy's address, so someone guessing passwords can briefly lock you out of signing in too (an already signed-in device keeps working).
- The Firefly token isn't exposed to the browser, but anyone with the dashboard password can do anything the token can (read, edit, delete).
- If you tick *Keep me signed in*, the session lasts 30 days and is renewed while you use the app. Without it, the session ends when the browser closes (or after 12 hours unused). Either way, no Firefly data is kept on the device: it lives only in the open tab. **Sign out** (or any trip back to the sign-in screen) ends the session. Don't tick it on shared computers.
- Sessions are signed with a key made from `DASH_PASSWORD` and `FIREFLY_TOKEN`, so changing either one signs out every device. There's no list of sessions on the server, so that's also how to sign out a lost device.
- The Apple Pay key (Settings → Apple Pay) can only add expenses, not read anything. It's made from `DASH_PASSWORD` and `FIREFLY_TOKEN` too, so changing either one replaces it. Its endpoint allows 20 payments a minute per address.
- Found a security problem? Please report it privately through this repo's **Security → Report a vulnerability** page rather than a public issue.

## Try it without Firefly (demo mode)

The quickest way is the [online demo](https://muffy0906.github.io/firefly-money/). To run the same demo locally, a small Python server with made-up data is included:

```bash
npm install && npm run build      # once, and again after changing app/src (or keep npm run watch running)
python3 dev/mock_server.py
# open http://127.0.0.1:8765 and sign in with: demo
```

It implements only the endpoints the UI needs. Writes are accepted but not saved (deletes are the exception).

The online demo is the same data ported to TypeScript (`app/src/demo/mockapi.ts`), answered in the browser by `demo.ts`, so it's plain files on GitHub Pages. `npm run build:demo` builds it into `site/`, and `.github/workflows/pages.yml` publishes it on every push to `main` (one-time setup: **Settings → Pages → Source: GitHub Actions**). If you change the demo data, change both copies. To see how many people visit the demo, set a repository variable `GOATCOUNTER` (**Settings → Secrets and variables → Actions → Variables**) to your [GoatCounter](https://www.goatcounter.com) site code: it counts page views without cookies or personal data, and only the demo has it, never the app you host.

## Development

- The app is HTML, CSS and TypeScript with no framework. [esbuild](https://esbuild.github.io/) bundles the TypeScript into `app/assets/js/`, which isn't kept in git (the Docker build runs it for you):
  - **`app/index.html`**: the page itself (nginx fills in `FIREFLY_URL` and the version stamp at startup).
  - **`app/assets/money.css`**: all styles and themes.
  - **`app/src/`**: the TypeScript, as ES modules. `boot.ts` runs in `<head>` (shell and theme before first paint) and becomes `boot.js`. `main.ts` imports everything else, in the order it runs, and becomes `app.js`:
    - `core/`: `base` (state and formatting helpers), `helpers`, `api` (requests, caching, the on-device copy), `feed` (transaction rows), `lists` (accounts, categories, budgets…), `dom` (drawer, toasts, view transitions), `auth` (sign-in/out), `router`, `login` (sign-in screen, themes, startup) and `events` (attaches the markup's `data-on*` handlers).
    - `pages/`: one module per page (overview, transactions, accounts, budgets, rules, forecast, inbox, …).
    - `features/`: things used across pages (transaction form, bulk edit, dashboard, charts, quick add, palette, gestures, the iPhone app shell, …).
    - `demo/`: the online demo only (`npm run build:demo`), not part of the app itself.
  - A module only imports from modules listed above it in `main.ts`, so modules run in a fixed order. Code that needs something from further down calls it through `App` instead.
  - Markup is built with the `html` template tag from `core/html.ts`: ``html`<b>${name}</b>` `` escapes `name`, while nested `html` results (and arrays of them, or `htmlList(…)`) go in as markup. Don't join `html` results with `+`, which turns them back into plain text that gets escaped; put them side by side in a template instead. The smoke test turns on a check that reports both mistakes.
  - Markup handlers are written as `data-onclick="App.name('arg', this.value)"` (also `data-onchange`, `data-onsubmit`, …), never `onclick=`: the Content-Security-Policy blocks inline script, and `events.ts` only runs calls to methods of the global `App` object. Each module adds the methods its markup needs with `Object.assign(App, { … })`.
- **Commands:** `npm run build` builds once, `npm run watch` rebuilds on every save, `npm run check` type-checks with `tsc`, `npm run lint` runs [oxlint](https://oxc.rs/docs/guide/usage/linter), and `npm test` runs the unit tests in `test/` (Vitest). The types are loose for now (the code came from plain JavaScript) and get stricter over time.
- Preferences are stored in `localStorage` under `money.*` / `moneyTheme`. The ones listed in `SYNCED` in `features/sync.ts` (dashboard layout, dismissed insights, forecast, loan plan…) are also saved to the Firefly user preference `money_settings` and pulled in at sign-in and when the app comes back to the foreground; the latest change wins. Theme, privacy and density stay on the device. Everything else lives in Firefly.
- **Publishing a new version:** push to `main`, and GitHub Actions builds a new `latest` image in a few minutes (see the repo's **Actions** tab). For a numbered release, push a tag: `git tag v1.2.0 && git push --tags`.
- **Unit tests** (`test/*.test.ts`) cover the logic that doesn't need a server: the `data-on*` handler parser, the `html` template tag, date helpers, quick-add date words, the Overview's snap grid, loan payment plans, payee names, subscription detection and savings-goal pace. Pure logic like that lives in modules without side effects (for example `features/grid.ts`, `features/nldate.ts`, `features/subs.ts`, `features/pace.ts`) so it can be tested on its own.
- **Smoke test:** opens every page and every "new …" form on desktop and phone sizes against the demo server, and fails on any JavaScript error:

  ```bash
  pip install playwright && playwright install chromium
  npm run build
  python3 dev/mock_server.py &
  python3 dev/smoke_test.py                           # add --shots docs/screenshots to refresh the images
  ```

## Browser support

Developed and tested in Chromium-based browsers (Chrome, Edge) on desktop and phone sizes. It uses only standard web features and should work in current Safari and Firefox. Please open an issue if something looks off there. Animated transitions need the View Transitions API (Chrome/Edge 111+, Safari 18+); other browsers switch views instantly instead. Vibration only works in browsers that support it (mainly Chrome on Android).

## Limitations

- Only one currency is shown per total (your Firefly primary currency). Foreign amounts are shown on individual transactions.
- Your Firefly profile, 2FA, API tokens and user management aren't available through Firefly's API, so change those in Firefly itself.
- Inline edits and the quick-add box handle single-split transactions. Split transactions open the full editor.

## Disclaimer

**Built with AI assistance.** Most of the code in this project was written with the help of an AI assistant (Claude, by Anthropic), directed, reviewed and tested by a human maintainer. It has been checked with the included smoke test and used against a real Firefly III server, but it hasn't had an independent code review. Read the code before trusting it with your finances, and report anything that looks wrong.

This is an independent project. It is not affiliated with or endorsed by Firefly III or its author. "Firefly III" is used only to describe what this app works with. Use it at your own risk and keep backups of your Firefly database.

## Questions and feedback

Have a question, an idea, or want to show off your setup? Start a thread in [Discussions](https://github.com/Muffy0906/firefly-money/discussions). Use [Issues](https://github.com/Muffy0906/firefly-money/issues) for bugs and concrete feature requests.

## License

[MIT](LICENSE): you may use, change, share and sell Money freely, as long as the copyright notice stays with it. It comes with no warranty.

Contributions are welcome. Please open an issue or start a [discussion](https://github.com/Muffy0906/firefly-money/discussions) first for anything big.
