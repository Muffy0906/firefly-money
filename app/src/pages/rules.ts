import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { busy, withAuth } from '../core/auth';
import { App, S, arr, el, fmtDay, money, monthRange, type ApiData } from '../core/base';
import { closeDrawer, confirmBox, formError, head, icon, ICON_X, openDrawer, opt, toast } from '../core/dom';
import { normGroup } from '../core/feed';
import { invalidate, lists } from '../core/lists';
import { VIEWS, route } from '../core/router';

/* ================= Rules ================= */
const TRIGGERS = [
  ['description_contains', 'Description contains'], ['description_starts', 'Description starts with'], ['description_ends', 'Description ends with'], ['description_is', 'Description is'],
  ['source_account_is', 'Source account is'], ['source_account_contains', 'Source account contains'], ['destination_account_is', 'Destination account is'],
  ['destination_account_contains', 'Destination account contains'], ['account_is', 'Either account is'], ['account_contains', 'Either account contains'],
  ['amount_is', 'Amount is'], ['amount_more', 'Amount is more than'], ['amount_less', 'Amount is less than'],
  ['transaction_type', 'Transaction type is'], ['category_is', 'Category is'], ['category_contains', 'Category contains'], ['budget_is', 'Budget is'],
  ['bill_is', 'Bill is'], ['tag_is', 'Has tag'], ['tag_is_not', 'Doesn’t have tag'], ['notes_contains', 'Notes contain'], ['notes_is', 'Notes are'],
  ['currency_is', 'Currency is'], ['date_on', 'Date is'], ['date_before', 'Date is before'], ['date_after', 'Date is after'],
  ['has_no_category', 'Has no category', 1], ['has_any_category', 'Has any category', 1], ['has_no_budget', 'Has no budget', 1], ['has_any_budget', 'Has any budget', 1],
  ['has_no_tag', 'Has no tags', 1], ['has_any_tag', 'Has any tag', 1], ['has_no_bill', 'Has no bill', 1], ['has_any_bill', 'Has any bill', 1],
  ['any_notes', 'Has notes', 1], ['no_notes', 'Has no notes', 1], ['has_attachments', 'Has attachments', 1], ['reconciled', 'Is reconciled', 1],
  ['external_id_is', 'External ID is'], ['internal_reference_is', 'Internal reference is'], ['user_action', 'Any transaction (always matches)', 1],
];
const ACTIONS = [
  ['set_category', 'Set category'], ['clear_category', 'Clear category', 1], ['set_budget', 'Set budget'], ['clear_budget', 'Clear budget', 1],
  ['add_tag', 'Add tag'], ['remove_tag', 'Remove tag'], ['remove_all_tags', 'Remove all tags', 1],
  ['set_description', 'Set description'], ['append_description', 'Append to description'], ['prepend_description', 'Prepend to description'],
  ['set_source_account', 'Set source account'], ['set_destination_account', 'Set destination account / payee'], ['switch_accounts', 'Swap source and destination', 1],
  ['set_source_to_cash', 'Set source to cash', 1], ['set_destination_to_cash', 'Set destination to cash', 1],
  ['set_notes', 'Set notes'], ['append_notes', 'Append to notes'], ['prepend_notes', 'Prepend to notes'], ['clear_notes', 'Clear notes', 1],
  ['link_to_bill', 'Link to bill'], ['update_piggy', 'Add to piggy bank'], ['set_amount', 'Set amount'],
  ['convert_withdrawal', 'Convert to expense'], ['convert_deposit', 'Convert to income'], ['convert_transfer', 'Convert to transfer'], ['delete_transaction', 'Delete the transaction', 1],
];
const trigLabel = Object.fromEntries(TRIGGERS.map(t => [t[0], t[1]])), actLabel = Object.fromEntries(ACTIONS.map(t => [t[0], t[1]]));
const noVal = new Set([...TRIGGERS, ...ACTIONS].filter(t => t[2]).map(t => t[0]));
function ruleSummary(at: ApiData) {
  const tr = (at.triggers || []).filter((t: ApiData) => t.active !== false && t.type !== 'user_action').map((t: ApiData) => (t.prohibited ? 'NOT ' : '') + (trigLabel[t.type] || t.type).toLowerCase() + (noVal.has(t.type) ? '' : ' “' + t.value + '”'));
  const ac = (at.actions || []).filter((t: ApiData) => t.active !== false).map((t: ApiData) => (actLabel[t.type] || t.type).toLowerCase() + (noVal.has(t.type) || !t.value ? '' : ' “' + t.value + '”'));
  return (tr.length ? 'When ' + tr.join(at.strict ? ' and ' : ' or ') : 'Every transaction') + ' → ' + (ac.join(', ') || 'nothing');
}
VIEWS.rules = async (r, paint) => {
  await lists();
  const [groups, rules] = await Promise.all([getAll('/rule-groups'), getAll('/rules')]);
  S.ruleGroups = groups.sort((a, b) => (a.attributes.order || 0) - (b.attributes.order || 0));
  S.rules = Object.fromEntries(rules.map(x => [String(x.id), x.attributes]));
  const q = (r.q.q || '').toLowerCase();
  const match = (at: ApiData) => !q || (at.title + ' ' + JSON.stringify(at.triggers.map((t: ApiData) => t.value)) + ' ' + JSON.stringify(at.actions.map((t: ApiData) => t.value))).toLowerCase().includes(q);
  const byGroup: any = {};
  rules.forEach(x => { (byGroup[String(x.attributes.rule_group_id)] = byGroup[String(x.attributes.rule_group_id)] || []).push(x); });
  const ruleHtml = htmlList(S.ruleGroups.map(g => {
    const list = (byGroup[String(g.id)] || []).sort((a: ApiData, b: ApiData) => (a.attributes.order || 0) - (b.attributes.order || 0)), shown = list.filter((x: ApiData) => match(x.attributes));
    if (q && !shown.length) return '';
    return html`<details class="panel flush rulegroup" style="margin-bottom:14px"${q ? ' open' : ''}><summary><div><div class="desc">${g.attributes.title}${g.attributes.active === false ? html` <span class="chip">Inactive</span>` : ''}</div><div class="sub-s">${list.length} rule${list.length === 1 ? '' : 's'}${g.attributes.description ? ' · ' + g.attributes.description : ''}</div></div><div style="display:flex;gap:8px" data-onclick="event.preventDefault()"><button class="btn small" data-onclick="App.runRules('group','${g.id}')">Run…</button><button class="btn small" data-onclick="App.ruleForm(null,'${g.id}')">+ Rule</button><button class="btn small" data-onclick="App.groupForm('${g.id}')">Edit</button></div></summary>${shown.length ? html`<table class="tbl"><tbody>${htmlList(shown.map((x: ApiData) => {
        const at = x.attributes;
        return html`<tr${at.active ? '' : html` style="opacity:.55"`}><td class="sel"><input type="checkbox" title="Active"${at.active ? ' checked' : ''} data-onchange="App.toggleRule('${x.id}',this.checked)"></td><td data-text="${(at.title + ' ' + ruleSummary(at)).toLowerCase()}"><div class="desc">${at.title}${at.stop_processing ? html` <span class="chip">Stops group</span>` : ''}${at.trigger === 'update-journal' ? html` <span class="chip">On update</span>` : ''}</div><div class="sub-s">${ruleSummary(at)}</div></td><td class="act"><button class="btn small" data-onclick="App.runRules('rule','${x.id}')">Run…</button> <button class="btn small" data-onclick="App.ruleForm('${x.id}')">Edit</button></td></tr>`;
      }))}</tbody></table>` : html`<div class="center-empty" style="padding:24px">No rules in this group.</div>`}</details>`;
  }));
  paint(html`${head('Rules', rules.length + ' rule' + (rules.length === 1 ? '' : 's') + ' in ' + groups.length + ' group' + (groups.length === 1 ? '' : 's') + '. Groups run top to bottom when a transaction is added.',
      html`<button class="btn" data-onclick="App.groupForm()">+ New group</button><button class="btn primary" data-onclick="App.ruleForm()">+ New rule</button>`)}<div class="toolbar"><form class="search" data-onsubmit="event.preventDefault();App.rulesSearch(this)">${icon('search')}<input type="search" name="q" placeholder="Search rules by name, text or category" value="${r.q.q || ''}" data-oninput="App.liveRuleFilter(this.value)"></form>${q ? html`<a class="link" href="#/rules">Clear</a>` : ''}</div>${ruleHtml || html`<section class="panel"><div class="center-empty">${q ? 'No rules match.' : 'No rules yet.'}</div></section>`}`);
};
async function toggleRule(id: string, on: boolean) {
  const at = S.rules![id];
  await withAuth(async () => { const row = document.querySelector<HTMLElement>('input[data-onchange*="toggleRule(\'' + id + '\'"]'); if (row) row.closest('tr')!.style.opacity = on ? '' : '.55';
    await api('/rules/' + id, { method: 'PUT', body: { title: at.title, rule_group_id: String(at.rule_group_id), active: on } }); at.active = on; toast(on ? 'Rule turned on' : 'Rule turned off'); });
}
function condRow(kind: string, t: ApiData, i: number) {
  const list = kind === 't' ? TRIGGERS : ACTIONS, has = list.some(x => x[0] === t.type);
  return html`<div class="editor-row" data-${kind}="${i}"><select data-f="type" data-onchange="App.ruleRowType(this)">${has ? '' : opt(t.type, t.type, t.type)}${htmlList(list.map(x => opt(x[0], x[1], t.type)))}</select><input type="text" data-f="value" value="${t.value || ''}"${noVal.has(t.type) ? html` disabled placeholder="No value needed"` : html` placeholder="Value"`}><span style="display:flex;gap:6px;align-items:center">${kind === 't' ? html`<label class="check" style="margin:0;font-size:12px" title="Match when this is NOT true"><input type="checkbox" data-f="prohibited"${t.prohibited ? ' checked' : ''}>Not</label>` : ''}<button type="button" class="x" data-onclick="App.removeRow(this)" aria-label="Remove">${ICON_X}</button></span></div>`;
}
function ruleRowType(sel: HTMLSelectElement) { const inp = sel.parentElement!.querySelector<HTMLInputElement>('[data-f=value]')!; const nv = noVal.has(sel.value); inp.disabled = nv; inp.placeholder = nv ? 'No value needed' : 'Value'; if (nv) inp.value = ''; }
function ruleForm(id?: string | null, groupId?: string) {
  const at = id ? S.rules![id] : { title: '', rule_group_id: groupId || (S.ruleGroups![0] || {}).id, trigger: 'store-journal', strict: true, active: true, stop_processing: false,
    triggers: [{ type: 'description_contains', value: '' }], actions: [{ type: 'set_category', value: '' }] };
  S.form = { id };
  openDrawer(id ? 'Edit rule' : 'New rule',
    html`<form id="ruleForm" data-onsubmit="event.preventDefault();App.saveRule()"><label>Name<input type="text" id="r-title" value="${at.title}" required></label><div class="grid2"><label>Group<select id="r-group">${htmlList(S.ruleGroups!.map(g => opt(g.id, g.attributes.title, String(at.rule_group_id))))}</select></label><label>Runs<select id="r-when">${opt('store-journal', 'When a transaction is added', at.trigger)}${opt('update-journal', 'When a transaction is changed', at.trigger)}</select></label></div><label>Match<select id="r-strict">${opt('1', 'All of these conditions', at.strict ? '1' : '0')}${opt('0', 'Any of these conditions', at.strict ? '1' : '0')}</select></label><div id="r-trig">${htmlList(at.triggers.filter((t: ApiData) => t.type !== 'user_action' || at.triggers.length === 1).map((t: ApiData, i: number) => condRow('t', t, i)))}</div><button type="button" class="btn small" data-onclick="App.ruleAdd('t')" style="margin-bottom:18px">+ Condition</button><div class="eyebrow">Then</div><div id="r-act">${htmlList(at.actions.map((t: ApiData, i: number) => condRow('a', t, i)))}</div><button type="button" class="btn small" data-onclick="App.ruleAdd('a')" style="margin-bottom:18px">+ Action</button><label class="check"><input type="checkbox" id="r-stop"${at.stop_processing ? ' checked' : ''}> Stop running the rest of this group when this rule matches</label><label class="check"><input type="checkbox" id="r-active"${at.active ? ' checked' : ''}> Active</label><button type="submit" hidden></button></form>`,
    html`${id ? html`<button class="btn danger" data-onclick="App.deleteRule('${id}')">Delete</button>` : ''}<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="ruleSave" data-onclick="App.submit('ruleForm')">${id ? 'Save rule' : 'Create rule'}</button>`);
}
function ruleAdd(kind: string) {
  const box = el(kind === 't' ? 'r-trig' : 'r-act'), div = document.createElement('div');
  div.innerHTML = String(condRow(kind, kind === 't' ? { type: 'description_contains', value: '' } : { type: 'set_category', value: '' }, box.children.length));
  box.appendChild(div.firstChild!);
}
async function saveRule() {
  const read = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].map((row, i) => {
    const o: any = { type: row.querySelector<HTMLInputElement>('[data-f=type]')!.value, value: row.querySelector<HTMLInputElement>('[data-f=value]')!.value.trim(), active: true, stop_processing: false };
    const p = row.querySelector<HTMLInputElement>('[data-f=prohibited]'); if (p) o.prohibited = p.checked;
    return o;
  });
  const triggers = read('#r-trig .editor-row'), actions = read('#r-act .editor-row');
  if (!el<HTMLInputElement>('r-title').value.trim()) return formError('Give the rule a name.');
  if (!triggers.length) return formError('Add at least one condition.');
  if (!actions.length) return formError('Add at least one action.');
  const missing = [...triggers, ...actions].find(t => !noVal.has(t.type) && !t.value);
  if (missing) return formError('Fill in a value for “' + (trigLabel[missing.type] || actLabel[missing.type] || missing.type) + '”.');
  triggers.forEach(t => { if (noVal.has(t.type)) t.value = 'true'; });
  const body = { title: el<HTMLInputElement>('r-title').value.trim(), rule_group_id: el<HTMLSelectElement>('r-group').value, trigger: el<HTMLSelectElement>('r-when').value, strict: el<HTMLSelectElement>('r-strict').value === '1',
    stop_processing: el<HTMLInputElement>('r-stop').checked, active: el<HTMLInputElement>('r-active').checked, triggers, actions };
  await busy(el('ruleSave'), async () => {
    await api(S.form.id ? '/rules/' + S.form.id : '/rules', { method: S.form.id ? 'PUT' : 'POST', body });
    closeDrawer(); toast(S.form && S.form.id ? 'Rule saved' : 'Rule saved'); route();
  });
}
async function deleteRule(id: string) {
  if (!await confirmBox('Delete this rule?', 'Transactions it already changed stay as they are.')) return;
  await withAuth(async () => { await api('/rules/' + id, { method: 'DELETE' }); closeDrawer(); toast('Rule deleted'); route(); });
}
function groupForm(id?: string) {
  const g = id ? S.ruleGroups!.find(x => String(x.id) === id).attributes : { title: '', description: '', active: true };
  S.form = { id };
  openDrawer(id ? 'Edit rule group' : 'New rule group',
    html`<form id="grpForm" data-onsubmit="event.preventDefault();App.saveGroup()"><label>Name<input type="text" id="g-title" value="${g.title}" required></label><label>Description<input type="text" id="g-desc" value="${g.description || ''}"></label><label class="check"><input type="checkbox" id="g-active"${g.active !== false ? ' checked' : ''}> Active</label><button type="submit" hidden></button></form>`,
    html`${id ? html`<button class="btn danger" data-onclick="App.deleteGroup('${id}')">Delete</button>` : ''}<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button><button class="btn primary" id="grpSave" data-onclick="App.submit('grpForm')">Save</button>`);
}
async function saveGroup() {
  const id = S.form.id, body = { title: el<HTMLInputElement>('g-title').value.trim(), description: el<HTMLInputElement>('g-desc').value.trim(), active: el<HTMLInputElement>('g-active').checked };
  if (!body.title) return formError('Give the group a name.');
  await busy(el('grpSave'), async () => { await api(id ? '/rule-groups/' + id : '/rule-groups', { method: id ? 'PUT' : 'POST', body }); closeDrawer(); toast('Group saved'); route(); });
}
async function deleteGroup(id: string) {
  const n = Object.values<any>(S.rules!).filter(r => String(r.rule_group_id) === id).length;
  if (!await confirmBox('Delete this group?', n ? 'Its ' + n + ' rule' + (n === 1 ? '' : 's') + ' will be deleted too.' : 'The group is empty.')) return;
  await withAuth(async () => { await api('/rule-groups/' + id, { method: 'DELETE' }); closeDrawer(); toast('Group deleted'); route(); });
}
function runRules(kind: string, id: string) {
  const name = kind === 'rule' ? S.rules![id].title : S.ruleGroups!.find(x => String(x.id) === id).attributes.title;
  S.form = { kind, id };
  const cur = monthRange(S.y, S.m);
  openDrawer('Run “' + name + '”',
    html`<p class="sub-s" style="margin-top:0">Apply ${kind === 'rule' ? 'this rule' : 'every rule in this group'} to transactions that already exist. Preview first to see what would change.</p><div class="grid2"><label>From<input type="date" id="rr-start" value="${cur.start}"></label><label>To<input type="date" id="rr-end" value="${cur.end}"></label></div><div id="rr-out"></div>`,
    html`<span class="grow"></span><button class="btn" data-onclick="App.previewRules()">Preview matches</button><button class="btn primary" id="rrGo" data-onclick="App.applyRules()">Run now</button>`);
}
async function previewRules() {
  const { kind, id } = S.form, out = el('rr-out');
  out.innerHTML = String(html`<p class="sub-s">Checking…</p>`);
  await withAuth(async () => {
    const res = await api((kind === 'rule' ? '/rules/' : '/rule-groups/') + id + '/test', { params: { start: el<HTMLInputElement>('rr-start').value, end: el<HTMLInputElement>('rr-end').value, limit: 200 } });
    const gs = arr(res).map(normGroup);
    out.innerHTML = String(html`<h3 style="font-size:14px">${gs.length} matching transaction${gs.length === 1 ? '' : 's'}</h3>${gs.length ? html`<div class="list">${htmlList(gs.slice(0, 60).map(g => html`<div class="row"><span class="name">${g.title || g.splits[0].description} <span class="sub-s">${fmtDay(g.date)}</span></span><span class="num">${money(g.total)}</span></div>`))}${gs.length > 60 ? html`<p class="sub-s">…and ${gs.length - 60} more</p>` : ''}</div>` : ''}`);
  });
}
async function applyRules() {
  const { kind, id } = S.form;
  if (!await confirmBox('Run it now?', 'Matching transactions between these dates will be changed by the rule actions.', 'Run')) return;
  await busy(el('rrGo'), async () => {
    await api((kind === 'rule' ? '/rules/' : '/rule-groups/') + id + '/trigger', { method: 'POST', params: { start: el<HTMLInputElement>('rr-start').value, end: el<HTMLInputElement>('rr-end').value } });
    invalidate(); closeDrawer(); toast('Done — Firefly applied the rules');
  });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  toggleRule,
  ruleForm,
  ruleAdd,
  ruleRowType,
  saveRule,
  deleteRule,
  groupForm,
  saveGroup,
  deleteGroup,
  runRules,
  previewRules,
  applyRules,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }
