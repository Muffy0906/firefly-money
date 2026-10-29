import { html, htmlList } from '../core/html';
import { AuthError, api, eachLimited } from '../core/api';
import { showLogin } from '../core/auth';
import { App, S, el } from '../core/base';
import { opt, toast } from '../core/dom';
import { groupUpdate } from '../core/feed';
import { invalidate } from '../core/lists';
import { route } from '../core/router';

/* ================= Bulk edit ================= */
export function selChanged() {
  S.sel = new Set([...document.querySelectorAll<HTMLInputElement>('input[data-sel]:checked')].map(i => i.dataset.sel!));
  renderBulk();
}
export function selAll(on: boolean) { document.querySelectorAll<HTMLInputElement>('input[data-sel], .selall input').forEach(i => { i.checked = on; }); selChanged(); }
function renderBulk(progress?: string) {
  const bar = el('bulkbar'); if (!bar) return;
  const n = S.sel ? S.sel.size : 0;
  if (!n) { bar.hidden = true; return; }
  const L = S.lists!;
  bar.hidden = false;
  bar.innerHTML = String(progress ? html`<strong>${progress}</strong>` :
    html`<strong>${n} selected</strong><input type="text" id="bk-cat" list="bk-dlcat" placeholder="Category" style="width:170px"><datalist id="bk-dlcat">${htmlList(L.categories.map(c => html`<option value="${c.name}">`))}</datalist><button class="btn small" data-onclick="App.bulk('category')">Set category</button><select id="bk-bud" style="width:170px">${opt('', 'Choose budget…', '')}${opt('0', 'No budget', '')}${htmlList(L.budgets.filter(b => b.active).map(b => opt(b.id, b.name, '')))}</select><button class="btn small" data-onclick="App.bulk('budget')">Set budget</button><input type="text" id="bk-tag" list="bk-dltag" placeholder="Tag" style="width:130px"><datalist id="bk-dltag">${htmlList(L.tags.map(t => html`<option value="${t.name}">`))}</datalist><button class="btn small" data-onclick="App.bulk('tag')">Add tag</button><button class="btn small danger" data-onclick="App.bulk('delete')">Delete</button><button class="link" data-onclick="App.selAll(false)">Clear</button>`);
}
async function bulk(kind: string) {
  const groups = [...(S.sel || [])].map(id => S.txMeta[id] && S.txMeta[id].g).filter(Boolean);
  if (!groups.length) return;
  let val = '';
  if (kind === 'category') { val = el<HTMLInputElement>('bk-cat').value.trim(); if (!val) return toast('Type a category first.'); }
  if (kind === 'budget') { val = el<HTMLSelectElement>('bk-bud').value; if (val === '') return toast('Choose a budget first.'); }
  if (kind === 'tag') { val = el<HTMLInputElement>('bk-tag').value.trim(); if (!val) return toast('Type a tag first.'); }
  if (kind === 'delete') return App.softDeleteTx(groups.map(g => g.id));
  let done = 0, skipped = 0, failed = 0, authErr = null as AuthError | null;
  renderBulk('Working… 0 of ' + groups.length);
  await eachLimited(groups, 4, async g => {
    if (authErr) return;
    let changed = 0;
    const body = groupUpdate(g, s => {
      if (kind === 'budget' && s.type !== 'withdrawal') return null;
      changed++;
      if (kind === 'category') return { category_name: val };
      if (kind === 'budget') return { budget_id: val };
      return { tags: [...new Set([...s.tags, val])] };
    }, { fire_webhooks: true });
    if (!changed) skipped++;
    else {
      try { await api('/transactions/' + g.id, { method: 'PUT', body }); }
      catch (e) { if (e instanceof AuthError) authErr = e; else failed++; }
    }
    renderBulk('Working… ' + (++done) + ' of ' + groups.length);
  });
  if (authErr) return showLogin(authErr.message);
  invalidate();
  toast('Updated ' + (done - skipped - failed) + ' transaction' + (done - skipped - failed === 1 ? '' : 's') +
    (skipped ? ' · ' + skipped + ' skipped (budgets only apply to expenses)' : '') + (failed ? ' · ' + failed + ' failed' : ''));
  route();
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  selChanged,
  selAll,
  bulk,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }
