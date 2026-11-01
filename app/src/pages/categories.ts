import { html, htmlList } from '../core/html';
import { AuthError, api } from '../core/api';
import { busy, showLogin } from '../core/auth';
import { App, S, absDiff, arr, el, money, money0, monthRange, type ApiData, type Period, viewPeriod, viewYM } from '../core/base';
import { closeDrawer, confirmBox, formError, head, ICON_X, monthNav, openDrawer, toast } from '../core/dom';
import { invalidate, lists } from '../core/lists';
import { VIEWS, route } from '../core/router';
import { insight } from '../features/refunds';
import { changeBars, shareChart } from '../features/charts';
import { customizeButton, pageCard, pageOpt } from '../features/pageopts';

/* ================= Categories & tags ================= */
VIEWS.categories = async (r, paint) => {
  const L = await lists(true);
  const [vy, vm] = viewYM(r), cur = viewPeriod(r), all = !!cur.all, prev = monthRange(vy, vm - 1), p = (x: Period) => ({ start: x.start, end: x.end });
  const [spNow, spPrev, inNow] = await Promise.all([
    insight('/insight/expense/category', p(cur)), all ? [] : insight('/insight/expense/category', p(prev)),
    insight('/insight/income/category', p(cur)).catch(() => []),
  ]);
  if (r.at) return;     // loading a month ahead
  const by = (res: ApiData) => Object.fromEntries(arr(res).map(x => [String(x.id), absDiff(x)]));
  const a = by(spNow), b = by(spPrev), c = by(inNow);
  const cats = L.categories.map(x => ({ ...x, now: a[x.id] || 0, prev: b[x.id] || 0, inc: c[x.id] || 0 })).sort((x, y) => y.now - x.now || x.name.localeCompare(y.name));
  // Customize: the order, whether empty ones are listed, which columns, and a chart above the table
  const sort = pageOpt('categories', 'sort'), cmp = !all && pageCard('categories', 'cmp'), earned = pageCard('categories', 'earned');
  const listed = cats.filter(x => pageOpt('categories', 'empty') || x.now || x.inc);
  if (sort === 'name') listed.sort((x, y) => x.name.localeCompare(y.name));
  if (sort === 'change' && !all) listed.sort((x, y) => Math.abs(y.now - y.prev) - Math.abs(x.now - x.prev) || y.now - x.now);
  const kind = pageOpt('categories', 'chart'), href = (x: { id: string }) => '#/transactions?category=' + x.id;
  const spentAll = cats.reduce((t, x) => t + x.now, 0);
  const pic = kind === 'none' ? '' : kind === 'change' ? (all ? '' : changeBars(cats.map(x => ({ name: x.name, now: x.now, prev: x.prev, href: href(x) }))))
    : shareChart(cats.map(x => ({ name: x.name, v: x.now, href: href(x), sub: money0(x.now) })), html`<span class="eyebrow">Spent</span><strong class="num">${money0(spentAll)}</strong>`, 'Spending by category', { limit: 8, ring: kind === 'donut' });
  const chart = kind === 'none' ? '' : html`<section class="panel cat-chart" style="margin-bottom:20px"><h2>${kind === 'change' ? 'What changed' : 'Where it went'}</h2><p class="lead">${kind === 'change' ? (all ? 'Pick a month to compare it with the one before' : 'Each category in ' + cur.short + ' against ' + prev.short + ', biggest moves first') : 'Spending by category ' + (all ? 'of all time' : 'in ' + cur.short)}</p>${pic || html`<p class="empty">${kind === 'change' ? 'Nothing changed.' : 'Nothing spent.'}</p>`}</section>`;
  const rows = htmlList(listed.map(x => {
    const d = x.now - x.prev;
    return html`<tr><td><a class="desc" href="#/transactions?category=${x.id}" style="text-decoration:none">${x.name}</a></td><td class="amt">${x.now ? money(x.now) : html`<span class="neutral">—</span>`}</td>${!cmp ? '' : html`<td class="r hide-s sub-s">${x.prev ? html`${Math.abs(d) < 1 ? 'Same' : html`<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${money0(Math.abs(d))}</span>`} vs ${money0(x.prev)}` : ''}</td>`}${earned ? html`<td class="amt hide-s">${x.inc ? html`<span class="pos">${money(x.inc)}</span>` : html`<span class="neutral">—</span>`}</td>` : ''}<td class="act"><button class="btn small" data-onclick="App.categoryForm('${x.id}')">Edit</button></td></tr>`;
  }));
  const tags = htmlList(L.tags.map(t => html`<span class="chip"><a href="#/transactions?tag=${t.id}">${t.name}</a><button title="Delete tag" data-onclick="App.deleteTag('${t.id}')">${ICON_X}</button></span>`));
  paint(html`${head('Categories & tags', '', html`${monthNav()}${customizeButton('categories')}<button class="btn primary" data-onclick="App.categoryForm()">+ New category</button>`)}${chart}<section class="panel flush" style="margin-bottom:28px">${rows ? html`<table class="tbl"><thead><tr><th>Category</th><th class="r">Spent ${all ? 'all time' : 'in ' + cur.short}</th>${!cmp ? '' : html`<th class="r hide-s">vs ${prev.short}</th>`}${earned ? html`<th class="r hide-s">Earned</th>` : ''}<th></th></tr></thead><tbody>${rows}</tbody></table>`
      : html`<div class="center-empty">${cats.length ? 'Nothing spent or earned in any category.' : 'No categories yet.'}</div>`}</section>${pageCard('categories', 'tags') ? html`<section class="panel"><div class="panel-head"><div><h2>Tags</h2><p class="lead">Click a tag to see its transactions</p></div></div><form data-onsubmit="event.preventDefault();App.addTag(this.t)" style="display:flex;gap:10px;margin-bottom:18px;max-width:420px"><input type="text" name="t" placeholder="New tag name" style="flex:1" required><button class="btn">Add tag</button></form>${tags ? html`<div class="tagcloud">${tags}</div>` : html`<p class="empty">No tags yet.</p>`}</section>` : ''}`);
};
async function categoryForm(id?: string) {
  const L = await lists(), c = id ? L.categories.find(x => x.id === id) : null;
  S.form = { id };
  openDrawer(id ? 'Edit category' : 'New category',
    html`<form id="catForm" data-onsubmit="event.preventDefault();App.saveCategory()"><label>Name<input type="text" id="c-name" value="${c ? c.name : ''}" required></label><label>Notes<textarea id="c-notes" rows="3">${c ? c.notes : ''}</textarea></label><button type="submit" hidden></button></form>`,
    html`${id ? html`<button class="btn danger" data-onclick="App.deleteThing('categories','${id}','category')">Delete</button>` : ''}<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="catSave" data-onclick="App.submit('catForm')">${id ? 'Save' : 'Create category'}</button>`);
}
async function saveCategory() {
  const id = S.form.id, name = el<HTMLInputElement>('c-name').value.trim();
  if (!name) return formError('Give the category a name.');
  await busy(el('catSave'), async () => {
    const body = { name, notes: el<HTMLTextAreaElement>('c-notes').value };
    await api(id ? '/categories/' + id : '/categories', { method: id ? 'PUT' : 'POST', body });
    invalidate(); closeDrawer(); toast(id ? 'Category saved' : 'Category created'); route();
  });
}
async function addTag(input: HTMLInputElement) {
  const tag = input.value.trim(); if (!tag) return;
  try { await api('/tags', { method: 'POST', body: { tag } }); invalidate(); toast('Tag added'); route(); }
  catch (e) { if (e instanceof AuthError) return showLogin(e.message); toast((e as Error).message); }
}
async function deleteTag(id: string) {
  const t = (S.lists!.tags.find(x => x.id === id) || {}).name || 'this tag';
  if (!await confirmBox('Delete tag “' + t + '”?', 'The tag is removed from all transactions. The transactions themselves stay.')) return;
  try { await api('/tags/' + id, { method: 'DELETE' }); invalidate(); toast('Tag deleted'); route(); }
  catch (e) { toast((e as Error).message); }
}
async function deleteThing(path: string, id: string, noun: string) {
  const extra = ({ budget: 'Transactions in this budget are kept but will no longer have a budget.', category: 'Transactions keep existing but lose this category.',
    bill: 'Linked transactions are kept.', 'piggy bank': 'The money saved stays in your account; only the goal is removed.' } as Record<string, string>)[noun] || '';
  if (!await confirmBox('Delete this ' + noun + '?', extra)) return;
  try { await api('/' + path + '/' + id, { method: 'DELETE' }); invalidate(); closeDrawer(); toast(noun[0].toUpperCase() + noun.slice(1) + ' deleted'); route(); }
  catch (e) { formError((e as Error).message); }
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  categoryForm,
  saveCategory,
  addTag,
  deleteTag,
  deleteThing,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }
