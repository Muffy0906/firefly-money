# UI components

Shared pieces live in `app/src/core/ui.ts` (plus `head()`, `emptyState()`, `opt()` and `toast()` in `core/dom.ts`). They return `html```, so put them in `html``` or `String()` them, and never join them with `+`. Look and feel comes from the tokens in `app/assets/money.css` (`--panel`, `--line`, `--muted`, `--fs-md`, spacing in 4px steps); themes restyle `.panel`, `.kpi` and `.center-empty` there, so a helper never carries colour or theme code.

| Helper | Use for | Markup |
| --- | --- | --- |
| `panelHead(title, lead?, link?)` | Heading and lead of a panel; `link` puts a link beside the heading | `h2` + `p.lead` (or `.panel-head`) |
| `panel(title, lead, body, { link, cls, style })` | A whole simple panel | `section.panel` |
| `kpi(label, value, sub?, cls?)` | A figure with a caption; `sub` null leaves the line out | `.kpi` |
| `emptyNote(text)` | One muted line inside a panel | `p.empty` |
| `doneState(title, text, pad?)` | Tick, title and line: nothing left to do | `.center-empty` |
| `emptyState(kind, title, text, actions?)` | Drawn icon, what the page is for, next step | `.empty-state` |

Rules:
- New page code uses these before writing the markup again. `test/ui.test.ts` fails if a page writes the same KPI, done state, empty note or panel heading by hand.
- Handlers stay literal `data-on*="App.x(...)"` strings in the page, so a helper takes pre-built `html``` for anything with one.
- A new pattern that appears in three places moves here with a test in `test/ui.test.ts` that pins its exact markup.

Not shared yet: buttons and chips (handlers, many one-off variants), rows (`.row` has six layouts), drawers and sheets (built by `openDrawer` with page-specific bodies), skeletons in `core/router.ts`, and KPI cards with links or nested markup (reports, loans).
