'use strict';
/* =====================================================================
   Extra features: bulk edit, attachments, links, reconcile, rules,
   recurring, reports, settings. Extends the App defined above.
   ===================================================================== */
function saveBlob(blob, name) {
  const u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name || 'download'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); };
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 1024 ? Math.round(b / 1024) + ' KB' : (b || 0) + ' B';
async function withAuth(fn) { try { return await fn(); } catch (e) { if (e instanceof AuthError) return showLogin(e.message); toast(e.message); } }

/* ================= Bulk edit ================= */
function selChanged() {
  S.sel = new Set([...document.querySelectorAll('input[data-sel]:checked')].map(i => i.dataset.sel));
  renderBulk();
}
function selAll(on) { document.querySelectorAll('input[data-sel], .selall input').forEach(i => { i.checked = on; }); selChanged(); }
function renderBulk(progress) {
  const bar = el('bulkbar'); if (!bar) return;
  const n = S.sel ? S.sel.size : 0;
  if (!n) { bar.hidden = true; return; }
  const L = S.lists;
  bar.hidden = false;
  bar.innerHTML = progress ? '<strong>' + esc(progress) + '</strong>' :
    '<strong>' + n + ' selected</strong>' +
    '<input type="text" id="bk-cat" list="bk-dlcat" placeholder="Category" style="width:170px"><datalist id="bk-dlcat">' + L.categories.map(c => '<option value="' + esc(c.name) + '">').join('') + '</datalist>' +
    '<button class="btn small" data-onclick="App.bulk(\'category\')">Set category</button>' +
    '<select id="bk-bud" style="width:170px">' + opt('', 'Choose budget…', '') + opt('0', 'No budget', '') + L.budgets.filter(b => b.active).map(b => opt(b.id, b.name, '')).join('') + '</select>' +
    '<button class="btn small" data-onclick="App.bulk(\'budget\')">Set budget</button>' +
    '<input type="text" id="bk-tag" list="bk-dltag" placeholder="Tag" style="width:130px"><datalist id="bk-dltag">' + L.tags.map(t => '<option value="' + esc(t.name) + '">').join('') + '</datalist>' +
    '<button class="btn small" data-onclick="App.bulk(\'tag\')">Add tag</button>' +
    '<button class="btn small danger" data-onclick="App.bulk(\'delete\')">Delete</button>' +
    '<button class="link" data-onclick="App.selAll(false)">Clear</button>';
}
async function bulk(kind) {
  const groups = [...(S.sel || [])].map(id => S.txMeta[id] && S.txMeta[id].g).filter(Boolean);
  if (!groups.length) return;
  let val = '';
  if (kind === 'category') { val = el('bk-cat').value.trim(); if (!val) return toast('Type a category first.'); }
  if (kind === 'budget') { val = el('bk-bud').value; if (val === '') return toast('Choose a budget first.'); }
  if (kind === 'tag') { val = el('bk-tag').value.trim(); if (!val) return toast('Type a tag first.'); }
  if (kind === 'delete') return App.softDeleteTx(groups.map(g => g.id));
  let done = 0, skipped = 0, failed = 0, authErr = null;
  renderBulk('Working… 0 of ' + groups.length);
  await eachLimited(groups, 4, async g => {
    if (authErr) return;
    const tx = g.splits.map(s => {
      const o = { transaction_journal_id: s.jid };
      if (kind === 'category') o.category_name = val;
      if (kind === 'budget') { if (s.type !== 'withdrawal') return null; o.budget_id = val; }
      if (kind === 'tag') o.tags = [...new Set([...s.tags, val])];
      return o;
    }).filter(Boolean);
    if (!tx.length) skipped++;
    else {
      try { await api('/transactions/' + g.id, { method: 'PUT', body: { apply_rules: false, fire_webhooks: true, transactions: tx } }); }
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

/* ================= Attachments & links in the transaction drawer ================= */
async function loadTxExtras(gid, jids) {
  const box = el('txExtras'); if (!box) return;
  try {
    const [atts, linksRaw, types] = await Promise.all([
      getAll('/transactions/' + gid + '/attachments').catch(() => []),
      Promise.all(jids.map(j => getAll('/transaction-journals/' + j + '/links').catch(() => []))).then(x => x.flat()),
      S.linkTypes ? Promise.resolve(S.linkTypes) : getAll('/link-types').then(t => (S.linkTypes = t)).catch(() => []),
    ]);
    const seen = new Set(), links = linksRaw.filter(l => !seen.has(l.id) && seen.add(l.id));
    const typeById = Object.fromEntries(types.map(t => [String(t.id), t.attributes]));
    const others = await Promise.all(links.map(l => {
      const at = l.attributes, mine = jids.includes(String(at.outward_id));
      const otherId = String(mine ? at.inward_id : at.outward_id);
      return api('/transaction-journals/' + otherId).then(r => ({ l, mine, g: normGroup(r.data) })).catch(() => ({ l, mine, g: null }));
    }));
    if (!el('txExtras')) return;
    const attHtml = atts.length ? '<div class="list">' + atts.map(a => {
      const at = a.attributes;
      return '<div class="row"><span class="name"><button class="link" data-onclick="App.downloadAtt(\'' + a.id + '\',\'' + esc(String(at.filename).replace(/'/g, '')) + '\')">' + esc(at.title || at.filename) + '</button> <span class="sub-s">' + fmtSize(at.size) + '</span></span>' +
        '<button class="link" data-onclick="App.deleteAtt(\'' + a.id + '\')">Remove</button></div>';
    }).join('') + '</div>' : '<p class="empty" style="padding-top:0">No files attached.</p>';
    const linkHtml = others.length ? '<div class="list">' + others.map(({ l, mine, g }) => {
      const t = typeById[String(l.attributes.link_type_id)] || {}, phrase = mine ? t.outward : t.inward;
      return '<div class="row"><span class="name"><span class="sub-s">' + esc(phrase || 'linked to') + '</span><br>' +
        (g ? '<button class="link" data-onclick="App.editTx(\'' + g.id + '\')">' + esc(g.title || g.splits[0].description) + '</button> <span class="sub-s">' + fmtDay(g.date) + ' · ' + money(g.total) + '</span>' : 'Transaction #' + esc(mine ? l.attributes.inward_id : l.attributes.outward_id)) +
        '</span><button class="link" data-onclick="App.deleteLink(\'' + l.id + '\')">Unlink</button></div>';
    }).join('') + '</div>' : '<p class="empty" style="padding-top:0">Not linked to anything.</p>';
    const dirOpts = types.flatMap(t => { const a = t.attributes; return a.inward === a.outward ? [opt(t.id + ':out', a.outward, '')] : [opt(t.id + ':out', a.outward, ''), opt(t.id + ':in', a.inward, '')]; }).join('');
    box.innerHTML =
      '<div class="extra"><h3>Attachments</h3>' + attHtml +
        '<label style="margin:12px 0 0">Add files<input type="file" id="attFile" multiple data-onchange="App.uploadAtt(\'' + jids[0] + '\', this)"></label></div>' +
      '<div class="extra"><h3>Linked transactions</h3>' + linkHtml +
        (types.length ? '<div style="margin-top:12px"><div class="grid2"><label>This transaction…<select id="lnkType">' + dirOpts + '</select></label>' +
          '<label>…this one<input type="search" id="lnkQ" placeholder="Search description" data-onkeydown="App.linkKey(event)"></label></div>' +
          '<button class="btn small" type="button" data-onclick="App.findLink()">Find</button><div id="lnkResults" style="margin-top:10px"></div></div>' : '') +
      '</div>';
    S.extrasCtx = { gid, jids };
  } catch (e) { if (el('txExtras')) el('txExtras').innerHTML = '<p class="sub-s">' + esc(e.message) + '</p>'; }
}
const refreshExtras = () => S.extrasCtx && loadTxExtras(S.extrasCtx.gid, S.extrasCtx.jids);
async function uploadAtt(jid, input) {
  const files = [...input.files]; if (!files.length) return;
  await withAuth(async () => {
    for (const f of files) {
      toast('Uploading ' + f.name + '…');
      const res = await api('/attachments', { method: 'POST', body: { filename: f.name, title: f.name, attachable_type: 'TransactionJournal', attachable_id: jid } });
      await api('/attachments/' + res.data.id + '/upload', { method: 'POST', raw: f, contentType: 'application/octet-stream' });
    }
    toast(files.length === 1 ? 'File attached' : files.length + ' files attached'); refreshExtras();
  });
}
async function downloadAtt(id, name) { await withAuth(async () => saveBlob(await api('/attachments/' + id + '/download', { as: 'blob' }), name)); }
async function deleteAtt(id) {
  if (!await confirmBox('Remove this file?', 'The attachment is deleted from Firefly III.', 'Remove')) return;
  await withAuth(async () => { await api('/attachments/' + id, { method: 'DELETE' }); toast('File removed'); refreshExtras(); });
}
async function findLink() {
  const q = el('lnkQ').value.trim(); if (!q) return;
  await withAuth(async () => {
    const res = await api('/search/transactions', { params: { query: q, search: q, limit: 8, page: 1 } });
    const gs = arr(res).map(normGroup).filter(g => g.id !== S.extrasCtx.gid);
    el('lnkResults').innerHTML = gs.length ? '<div class="list">' + gs.map(g => '<div class="row"><span class="name">' + esc(g.title || g.splits[0].description) + ' <span class="sub-s">' + fmtDay(g.date) + ' · ' + money(g.total) + '</span></span>' +
      '<button class="btn small" type="button" data-onclick="App.makeLink(\'' + g.splits[0].jid + '\')">Link</button></div>').join('') + '</div>' : '<p class="empty">No matches.</p>';
  });
}
async function makeLink(otherJid) {
  const [typeId, dir] = el('lnkType').value.split(':'), me = S.extrasCtx.jids[0];
  const body = dir === 'out' ? { link_type_id: typeId, outward_id: me, inward_id: otherJid } : { link_type_id: typeId, outward_id: otherJid, inward_id: me };
  await withAuth(async () => { await api('/transaction-links', { method: 'POST', body }); toast('Linked'); refreshExtras(); });
}
async function deleteLink(id) {
  if (!await confirmBox('Remove this link?', 'Both transactions stay; only the link between them is removed.', 'Unlink')) return;
  await withAuth(async () => { await api('/transaction-links/' + id, { method: 'DELETE' }); toast('Link removed'); refreshExtras(); });
}

/* ================= Reconcile ================= */
VIEWS.reconcile = async (r, paint) => {
  await lists();
  const a = normAccount((await api('/accounts/' + r.id)).data);
  const end = r.q.end || todayIso(), start = r.q.start || end.slice(0, 8) + '01';
  const [before, txs] = await Promise.all([
    api('/accounts/' + r.id, { params: { date: addDays(start, -1) } }),
    getAll('/accounts/' + r.id + '/transactions', { start, end }),
  ]);
  const owed = isCard(a) || isLiab(a), disp = v => owed ? -v : v;
  const rows = [];
  txs.map(normGroup).forEach(g => g.splits.forEach(s => {
    if (s.source_id !== a.id && s.destination_id !== a.id) return;
    rows.push({ gid: g.id, jid: s.jid, date: s.date, desc: s.description, amt: s.source_id === a.id ? -s.amount : s.amount, rec: s.reconciled });
  }));
  rows.sort((x, y) => String(x.date).localeCompare(String(y.date)));
  if (!paint.live) return;
  S.rec = { a, rows, startBal: num(before.data.attributes.current_balance), owed, start, end, checked: new Set(rows.filter(x => x.rec).map(x => x.jid)) };
  paint('<p style="margin:0 0 6px"><a class="link" href="#/account/' + a.id + '">← ' + esc(a.name) + '</a></p>' +
    head('Reconcile ' + a.name, 'Tick off each transaction that appears on your statement until the difference is zero.', '') +
    '<section class="panel" style="margin-bottom:20px"><div class="grid2" style="grid-template-columns:repeat(3,1fr);gap:0 16px">' +
      '<label>Statement start<input type="date" id="rc-start" value="' + start + '" data-onchange="App.recDates()"></label>' +
      '<label>Statement end<input type="date" id="rc-end" value="' + end + '" data-onchange="App.recDates()"></label>' +
      '<label>' + (owed ? 'Statement balance owed' : 'Statement ending balance') + '<input type="number" step="0.01" id="rc-bal" value="' + esc(r.q.balance || '') + '" data-oninput="App.recCalc()" placeholder="From your statement"></label>' +
    '</div><div class="kpis" id="rc-kpis" style="margin:4px 0 0"></div><div id="rc-actions" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px"></div></section>' +
    '<section class="panel flush">' + (rows.length ? '<table class="tbl"><thead><tr><th class="sel"><input type="checkbox" data-onchange="App.recAll(this.checked)" aria-label="Tick all"></th><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>' +
      rows.map(x => '<tr><td class="sel"><input type="checkbox" data-rec="' + x.jid + '"' + (S.rec.checked.has(x.jid) ? ' checked' : '') + (x.rec ? ' disabled title="Already reconciled"' : '') + ' data-onchange="App.recTick(this)"></td>' +
        '<td class="date">' + fmtDay(x.date) + '</td><td class="desc">' + esc(x.desc) + (x.rec ? ' <span class="chip good">Reconciled</span>' : '') + '</td>' +
        '<td class="amt ' + (x.amt < 0 ? 'neg' : 'pos') + '">' + (x.amt > 0 ? '+' : '') + money(x.amt) + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="center-empty">No transactions in this period.</div>') + '</section>');
  recCalc();
};
function recCalc() {
  const R = S.rec; if (!R) return;
  const disp = v => R.owed ? -v : v;
  const cleared = R.startBal + R.rows.filter(x => R.checked.has(x.jid)).reduce((s, x) => s + x.amt, 0);
  const raw = el('rc-bal').value.trim(), stmt = raw === '' ? null : (R.owed ? -num(raw) : num(raw));
  const diff = stmt === null ? null : Math.round((stmt - cleared) * 100) / 100;
  const newly = R.rows.filter(x => R.checked.has(x.jid) && !x.rec).length;
  el('rc-kpis').innerHTML =
    '<div class="kpi"><div class="eyebrow">Balance before ' + fmtDay(R.start) + '</div><div class="val num">' + money(disp(R.startBal)) + '</div></div>' +
    '<div class="kpi"><div class="eyebrow">Ticked balance</div><div class="val num">' + money(disp(cleared)) + '</div></div>' +
    '<div class="kpi"><div class="eyebrow">Difference</div><div class="val num ' + (diff === null ? '' : diff === 0 ? 'pos' : 'neg') + '">' + (diff === null ? '—' : diff === 0 ? 'Balanced ✓' : money(disp(diff))) + '</div></div>';
  el('rc-actions').innerHTML =
    '<button class="btn primary" data-onclick="App.recFinish()"' + (newly ? '' : ' disabled') + '>Mark ' + newly + ' as reconciled</button>' +
    (diff ? '<button class="btn" data-onclick="App.recAdjust()">Add a ' + money(Math.abs(diff)) + ' adjustment</button>' : '');
  R.diff = diff;
}
function recTick(cb) { cb.checked ? S.rec.checked.add(cb.dataset.rec) : S.rec.checked.delete(cb.dataset.rec); recCalc(); }
function recAll(on) { document.querySelectorAll('input[data-rec]:not(:disabled)').forEach(cb => { cb.checked = on; on ? S.rec.checked.add(cb.dataset.rec) : S.rec.checked.delete(cb.dataset.rec); }); recCalc(); }
function recDates() { location.hash = '#/reconcile/' + S.rec.a.id + '?start=' + el('rc-start').value + '&end=' + el('rc-end').value + (el('rc-bal').value ? '&balance=' + encodeURIComponent(el('rc-bal').value) : ''); }
async function recFinish() {
  const R = S.rec, todo = R.rows.filter(x => R.checked.has(x.jid) && !x.rec);
  if (R.diff && !await confirmBox('The difference isn’t zero', 'You can still mark the ticked transactions as reconciled, but the account won’t match the statement yet.', 'Mark anyway')) return;
  await withAuth(async () => {
    let n = 0;
    await eachLimited(todo, 4, async x => { await api('/transactions/' + x.gid, { method: 'PUT', body: { apply_rules: false, transactions: [{ transaction_journal_id: x.jid, reconciled: true }] } }); n++; });
    toast(n + ' transaction' + (n === 1 ? '' : 's') + ' reconciled'); route();
  });
}
async function recAdjust() {
  const R = S.rec, d = R.diff; if (!d) return;
  await lists();
  newTx({ type: d > 0 ? 'deposit' : 'withdrawal', account: R.a.id, amount: String(Math.abs(d)), description: 'Reconciliation adjustment', date: R.end });
}

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
function ruleSummary(at) {
  const tr = (at.triggers || []).filter(t => t.active !== false && t.type !== 'user_action').map(t => (t.prohibited ? 'NOT ' : '') + (trigLabel[t.type] || t.type).toLowerCase() + (noVal.has(t.type) ? '' : ' “' + t.value + '”'));
  const ac = (at.actions || []).filter(t => t.active !== false).map(t => (actLabel[t.type] || t.type).toLowerCase() + (noVal.has(t.type) || !t.value ? '' : ' “' + t.value + '”'));
  return (tr.length ? 'When ' + tr.join(at.strict ? ' and ' : ' or ') : 'Every transaction') + ' → ' + (ac.join(', ') || 'nothing');
}
VIEWS.rules = async (r, paint) => {
  await lists();
  const [groups, rules] = await Promise.all([getAll('/rule-groups'), getAll('/rules')]);
  S.ruleGroups = groups.sort((a, b) => (a.attributes.order || 0) - (b.attributes.order || 0));
  S.rules = Object.fromEntries(rules.map(x => [String(x.id), x.attributes]));
  const q = (r.q.q || '').toLowerCase();
  const match = at => !q || (at.title + ' ' + JSON.stringify(at.triggers.map(t => t.value)) + ' ' + JSON.stringify(at.actions.map(t => t.value))).toLowerCase().includes(q);
  const byGroup = {};
  rules.forEach(x => { (byGroup[String(x.attributes.rule_group_id)] = byGroup[String(x.attributes.rule_group_id)] || []).push(x); });
  const html = S.ruleGroups.map(g => {
    const list = (byGroup[String(g.id)] || []).sort((a, b) => (a.attributes.order || 0) - (b.attributes.order || 0)), shown = list.filter(x => match(x.attributes));
    if (q && !shown.length) return '';
    return '<details class="panel flush rulegroup" style="margin-bottom:14px"' + (q ? ' open' : '') + '><summary><div><div class="desc">' + esc(g.attributes.title) +
      (g.attributes.active === false ? ' <span class="chip">Inactive</span>' : '') + '</div><div class="sub-s">' + list.length + ' rule' + (list.length === 1 ? '' : 's') +
      (g.attributes.description ? ' · ' + esc(g.attributes.description) : '') + '</div></div><div style="display:flex;gap:8px" data-onclick="event.preventDefault()">' +
      '<button class="btn small" data-onclick="App.runRules(\'group\',\'' + g.id + '\')">Run…</button><button class="btn small" data-onclick="App.ruleForm(null,\'' + g.id + '\')">+ Rule</button>' +
      '<button class="btn small" data-onclick="App.groupForm(\'' + g.id + '\')">Edit</button></div></summary>' +
      (shown.length ? '<table class="tbl"><tbody>' + shown.map(x => {
        const at = x.attributes;
        return '<tr' + (at.active ? '' : ' style="opacity:.55"') + '><td class="sel"><input type="checkbox" title="Active"' + (at.active ? ' checked' : '') + ' data-onchange="App.toggleRule(\'' + x.id + '\',this.checked)"></td>' +
          '<td data-text="' + esc((at.title + ' ' + ruleSummary(at)).toLowerCase()) + '"><div class="desc">' + esc(at.title) + (at.stop_processing ? ' <span class="chip">Stops group</span>' : '') + (at.trigger === 'update-journal' ? ' <span class="chip">On update</span>' : '') + '</div><div class="sub-s">' + esc(ruleSummary(at)) + '</div></td>' +
          '<td class="act"><button class="btn small" data-onclick="App.runRules(\'rule\',\'' + x.id + '\')">Run…</button> <button class="btn small" data-onclick="App.ruleForm(\'' + x.id + '\')">Edit</button></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="center-empty" style="padding:24px">No rules in this group.</div>') + '</details>';
  }).join('');
  paint(head('Rules', rules.length + ' rule' + (rules.length === 1 ? '' : 's') + ' in ' + groups.length + ' group' + (groups.length === 1 ? '' : 's') + '. Groups run top to bottom when a transaction is added.',
      '<button class="btn" data-onclick="App.groupForm()">+ New group</button><button class="btn primary" data-onclick="App.ruleForm()">+ New rule</button>') +
    '<div class="toolbar"><form class="search" data-onsubmit="event.preventDefault();App.rulesSearch(this)">' + icon('search') +
      '<input type="search" name="q" placeholder="Search rules by name, text or category" value="' + esc(r.q.q || '') + '" data-oninput="App.liveRuleFilter(this.value)"></form>' + (q ? '<a class="link" href="#/rules">Clear</a>' : '') + '</div>' +
    (html || '<section class="panel"><div class="center-empty">' + (q ? 'No rules match.' : 'No rules yet.') + '</div></section>'));
};
async function toggleRule(id, on) {
  const at = S.rules[id];
  await withAuth(async () => { const row = document.querySelector('input[data-onchange*="toggleRule(\'' + id + '\'"]'); if (row) row.closest('tr').style.opacity = on ? '' : '.55';
    await api('/rules/' + id, { method: 'PUT', body: { title: at.title, rule_group_id: String(at.rule_group_id), active: on } }); at.active = on; toast(on ? 'Rule turned on' : 'Rule turned off'); });
}
function condRow(kind, t, i) {
  const list = kind === 't' ? TRIGGERS : ACTIONS, has = list.some(x => x[0] === t.type);
  return '<div class="editor-row" data-' + kind + '="' + i + '"><select data-f="type" data-onchange="App.ruleRowType(this)">' + (has ? '' : opt(t.type, t.type, t.type)) + list.map(x => opt(x[0], x[1], t.type)).join('') + '</select>' +
    '<input type="text" data-f="value" value="' + esc(t.value || '') + '"' + (noVal.has(t.type) ? ' disabled placeholder="No value needed"' : ' placeholder="Value"') + '>' +
    '<span style="display:flex;gap:6px;align-items:center">' + (kind === 't' ? '<label class="check" style="margin:0;font-size:12px" title="Match when this is NOT true"><input type="checkbox" data-f="prohibited"' + (t.prohibited ? ' checked' : '') + '>Not</label>' : '') +
    '<button type="button" class="x" data-onclick="App.removeRow(this)" aria-label="Remove">×</button></span></div>';
}
function ruleRowType(sel) { const inp = sel.parentElement.querySelector('[data-f=value]'); const nv = noVal.has(sel.value); inp.disabled = nv; inp.placeholder = nv ? 'No value needed' : 'Value'; if (nv) inp.value = ''; }
function ruleForm(id, groupId) {
  const at = id ? S.rules[id] : { title: '', rule_group_id: groupId || (S.ruleGroups[0] || {}).id, trigger: 'store-journal', strict: true, active: true, stop_processing: false,
    triggers: [{ type: 'description_contains', value: '' }], actions: [{ type: 'set_category', value: '' }] };
  S.form = { id };
  openDrawer(id ? 'Edit rule' : 'New rule',
    '<form id="ruleForm" data-onsubmit="event.preventDefault();App.saveRule()"><label>Name<input type="text" id="r-title" value="' + esc(at.title) + '" required></label>' +
    '<div class="grid2"><label>Group<select id="r-group">' + S.ruleGroups.map(g => opt(g.id, g.attributes.title, String(at.rule_group_id))).join('') + '</select></label>' +
    '<label>Runs<select id="r-when">' + opt('store-journal', 'When a transaction is added', at.trigger) + opt('update-journal', 'When a transaction is changed', at.trigger) + '</select></label></div>' +
    '<label>Match<select id="r-strict">' + opt('1', 'All of these conditions', at.strict ? '1' : '0') + opt('0', 'Any of these conditions', at.strict ? '1' : '0') + '</select></label>' +
    '<div id="r-trig">' + at.triggers.filter(t => t.type !== 'user_action' || at.triggers.length === 1).map((t, i) => condRow('t', t, i)).join('') + '</div>' +
    '<button type="button" class="btn small" data-onclick="App.ruleAdd(\'t\')" style="margin-bottom:18px">+ Condition</button>' +
    '<div class="eyebrow">Then</div><div id="r-act">' + at.actions.map((t, i) => condRow('a', t, i)).join('') + '</div>' +
    '<button type="button" class="btn small" data-onclick="App.ruleAdd(\'a\')" style="margin-bottom:18px">+ Action</button>' +
    '<label class="check"><input type="checkbox" id="r-stop"' + (at.stop_processing ? ' checked' : '') + '> Stop running the rest of this group when this rule matches</label>' +
    '<label class="check"><input type="checkbox" id="r-active"' + (at.active ? ' checked' : '') + '> Active</label><button type="submit" hidden></button></form>',
    (id ? '<button class="btn danger" data-onclick="App.deleteRule(\'' + id + '\')">Delete</button>' : '') + '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button>' +
    '<button class="btn primary" id="ruleSave" data-onclick="App.submit(\'ruleForm\')">' + (id ? 'Save rule' : 'Create rule') + '</button>');
}
function ruleAdd(kind) {
  const box = el(kind === 't' ? 'r-trig' : 'r-act'), div = document.createElement('div');
  div.innerHTML = condRow(kind, kind === 't' ? { type: 'description_contains', value: '' } : { type: 'set_category', value: '' }, box.children.length);
  box.appendChild(div.firstChild);
}
async function saveRule() {
  const read = sel => [...document.querySelectorAll(sel)].map((row, i) => {
    const o = { type: row.querySelector('[data-f=type]').value, value: row.querySelector('[data-f=value]').value.trim(), active: true, stop_processing: false };
    const p = row.querySelector('[data-f=prohibited]'); if (p) o.prohibited = p.checked;
    return o;
  });
  const triggers = read('#r-trig .editor-row'), actions = read('#r-act .editor-row');
  if (!el('r-title').value.trim()) return formError('Give the rule a name.');
  if (!triggers.length) return formError('Add at least one condition.');
  if (!actions.length) return formError('Add at least one action.');
  const missing = [...triggers, ...actions].find(t => !noVal.has(t.type) && !t.value);
  if (missing) return formError('Fill in a value for “' + (trigLabel[missing.type] || actLabel[missing.type] || missing.type) + '”.');
  triggers.forEach(t => { if (noVal.has(t.type)) t.value = 'true'; });
  const body = { title: el('r-title').value.trim(), rule_group_id: el('r-group').value, trigger: el('r-when').value, strict: el('r-strict').value === '1',
    stop_processing: el('r-stop').checked, active: el('r-active').checked, triggers, actions };
  await busy(el('ruleSave'), async () => {
    await api(S.form.id ? '/rules/' + S.form.id : '/rules', { method: S.form.id ? 'PUT' : 'POST', body });
    closeDrawer(); toast(S.form && S.form.id ? 'Rule saved' : 'Rule saved'); route();
  });
}
async function deleteRule(id) {
  if (!await confirmBox('Delete this rule?', 'Transactions it already changed stay as they are.')) return;
  await withAuth(async () => { await api('/rules/' + id, { method: 'DELETE' }); closeDrawer(); toast('Rule deleted'); route(); });
}
function groupForm(id) {
  const g = id ? S.ruleGroups.find(x => String(x.id) === id).attributes : { title: '', description: '', active: true };
  S.form = { id };
  openDrawer(id ? 'Edit rule group' : 'New rule group',
    '<form id="grpForm" data-onsubmit="event.preventDefault();App.saveGroup()"><label>Name<input type="text" id="g-title" value="' + esc(g.title) + '" required></label>' +
    '<label>Description<input type="text" id="g-desc" value="' + esc(g.description || '') + '"></label>' +
    '<label class="check"><input type="checkbox" id="g-active"' + (g.active !== false ? ' checked' : '') + '> Active</label><button type="submit" hidden></button></form>',
    (id ? '<button class="btn danger" data-onclick="App.deleteGroup(\'' + id + '\')">Delete</button>' : '') + '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button>' +
    '<button class="btn primary" id="grpSave" data-onclick="App.submit(\'grpForm\')">Save</button>');
}
async function saveGroup() {
  const id = S.form.id, body = { title: el('g-title').value.trim(), description: el('g-desc').value.trim(), active: el('g-active').checked };
  if (!body.title) return formError('Give the group a name.');
  await busy(el('grpSave'), async () => { await api(id ? '/rule-groups/' + id : '/rule-groups', { method: id ? 'PUT' : 'POST', body }); closeDrawer(); toast('Group saved'); route(); });
}
async function deleteGroup(id) {
  const n = Object.values(S.rules).filter(r => String(r.rule_group_id) === id).length;
  if (!await confirmBox('Delete this group?', n ? 'Its ' + n + ' rule' + (n === 1 ? '' : 's') + ' will be deleted too.' : 'The group is empty.')) return;
  await withAuth(async () => { await api('/rule-groups/' + id, { method: 'DELETE' }); closeDrawer(); toast('Group deleted'); route(); });
}
function runRules(kind, id) {
  const name = kind === 'rule' ? S.rules[id].title : S.ruleGroups.find(x => String(x.id) === id).attributes.title;
  S.form = { kind, id };
  const cur = monthRange(S.y, S.m);
  openDrawer('Run “' + name + '”',
    '<p class="sub-s" style="margin-top:0">Apply ' + (kind === 'rule' ? 'this rule' : 'every rule in this group') + ' to transactions that already exist. Preview first to see what would change.</p>' +
    '<div class="grid2"><label>From<input type="date" id="rr-start" value="' + cur.start + '"></label><label>To<input type="date" id="rr-end" value="' + cur.end + '"></label></div>' +
    '<div id="rr-out"></div>',
    '<span class="grow"></span><button class="btn" data-onclick="App.previewRules()">Preview matches</button><button class="btn primary" id="rrGo" data-onclick="App.applyRules()">Run now</button>');
}
async function previewRules() {
  const { kind, id } = S.form, out = el('rr-out');
  out.innerHTML = '<p class="sub-s">Checking…</p>';
  await withAuth(async () => {
    const res = await api((kind === 'rule' ? '/rules/' : '/rule-groups/') + id + '/test', { params: { start: el('rr-start').value, end: el('rr-end').value, limit: 200 } });
    const gs = arr(res).map(normGroup);
    out.innerHTML = '<h3 style="font-size:14px">' + gs.length + ' matching transaction' + (gs.length === 1 ? '' : 's') + '</h3>' + (gs.length ? '<div class="list">' +
      gs.slice(0, 60).map(g => '<div class="row"><span class="name">' + esc(g.title || g.splits[0].description) + ' <span class="sub-s">' + fmtDay(g.date) + '</span></span><span class="num">' + money(g.total) + '</span></div>').join('') +
      (gs.length > 60 ? '<p class="sub-s">…and ' + (gs.length - 60) + ' more</p>' : '') + '</div>' : '');
  });
}
async function applyRules() {
  const { kind, id } = S.form;
  if (!await confirmBox('Run it now?', 'Matching transactions between these dates will be changed by the rule actions.', 'Run')) return;
  await busy(el('rrGo'), async () => {
    await api((kind === 'rule' ? '/rules/' : '/rule-groups/') + id + '/trigger', { method: 'POST', params: { start: el('rr-start').value, end: el('rr-end').value } });
    invalidate(); closeDrawer(); toast('Done — Firefly applied the rules');
  });
}

/* ================= Recurring ================= */
const REPEAT_LABEL = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
VIEWS.recurring = async (r, paint) => {
  const L = await lists();
  const recs = await getAll('/recurrences');
  S.recCache = Object.fromEntries(recs.map(x => [String(x.id), x.attributes]));
  const rows = recs.map(x => {
    const at = x.attributes, t = (at.transactions || [])[0] || {}, rep = (at.repetitions || [])[0] || {};
    const next = (at.repetitions || []).flatMap(p => p.occurrences || []).sort().filter(d => String(d).slice(0, 10) >= todayIso()).slice(0, 3);
    const sign = at.type === 'withdrawal' ? 'neg' : at.type === 'deposit' ? 'pos' : 'neutral';
    const ends = at.repeat_until ? 'until ' + fmtDate(at.repeat_until) : at.nr_of_repetitions ? at.nr_of_repetitions + ' times' : '';
    return '<tr class="click" data-onclick="App.recurForm(\'' + x.id + '\')"' + (at.active === false ? ' style="opacity:.5"' : '') + '><td><div class="desc">' + esc(at.title) + (at.active === false ? ' <span class="chip">Inactive</span>' : '') + '</div>' +
      '<div class="sub-s">' + esc(rep.description || '') + (ends ? ' · ' + ends : '') + '</div></td>' +
      '<td class="flow hide-s">' + esc(t.source_name || '') + ' → ' + esc(t.destination_name || '') + '</td>' +
      '<td class="hide-s">' + (next.length ? next.map(d => '<span class="chip">' + fmtDay(d) + '</span>').join('') : '<span class="neutral">—</span>') + '</td>' +
      '<td class="amt ' + sign + '">' + money(num(t.amount)) + '</td></tr>';
  }).join('');
  paint(head('Recurring', 'Transactions Firefly creates for you automatically on a schedule', '<button class="btn primary" data-onclick="App.recurForm()">+ New recurring</button>') +
    '<section class="panel flush">' + (rows ? '<table class="tbl"><thead><tr><th>Name</th><th class="hide-s">From → To</th><th class="hide-s">Next</th><th class="r">Amount</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<div class="center-empty">Nothing recurring yet. Add rent, a salary or a subscription and Firefly will create it for you each time.</div>') + '</section>' +
    '<p class="sub-s" style="margin-top:14px">Firefly creates these transactions on its daily cron job, so make sure the cron is set up in your Firefly install.</p>');
};
function recurForm(id, forceType) {
  const L = S.lists, at = id ? S.recCache[id] : null, rep = at ? (at.repetitions || [])[0] || {} : {};
  const type = forceType || (at ? at.type : 'withdrawal');
  const t = at && at.type === type ? (at.transactions || [])[0] || {} : at ? { amount: ((at.transactions || [])[0] || {}).amount, description: ((at.transactions || [])[0] || {}).description } : {};
  S.form = { id, type, origType: type };
  const main = type === 'deposit' ? t.destination_id : t.source_id;
  const counter = type === 'deposit' ? t.source_name : t.destination_name;
  const firstDate = at ? String(at.first_date).slice(0, 10) : todayIso();
  const endMode = at && at.repeat_until ? 'date' : at && at.nr_of_repetitions ? 'count' : 'never';
  const typeBtn = (v, l) => '<button type="button" class="' + (type === v ? 'on' : '') + '" data-onclick="App.recurType(\'' + v + '\')">' + l + '</button>';
  const counterList = type === 'withdrawal' ? [...L.expense, ...L.own.filter(isLiab)] : [...L.revenue, ...L.own.filter(isLiab)];
  openDrawer(id ? 'Edit recurring transaction' : 'New recurring transaction',
    '<form id="recForm" data-onsubmit="event.preventDefault();App.saveRecur()">' +
    '<div class="seg">' + typeBtn('withdrawal', 'Expense') + typeBtn('deposit', 'Income') + typeBtn('transfer', 'Transfer') + '</div>' +
    '<label>Name<input type="text" id="rc-title" value="' + esc(at ? at.title : '') + '" required placeholder="e.g. Rent"></label>' +
    '<div class="grid2"><label>Amount<input type="number" step="0.01" min="0.01" id="rc-amount" value="' + (t.amount ? num(t.amount) : '') + '" required></label>' +
    '<label>Description on each transaction<input type="text" id="rc-desc" value="' + esc(t.description || '') + '" placeholder="Same as name"></label></div>' +
    (type === 'transfer' ? '<div class="grid2"><label>From<select id="rc-src">' + accountOptions(t.source_id, true) + '</select></label><label>To<select id="rc-dst">' + accountOptions(t.destination_id, true) + '</select></label></div>'
      : '<div class="grid2"><label>' + (type === 'withdrawal' ? 'Paid from' : 'Deposited into') + '<select id="rc-main">' + accountOptions(main || (L.own[0] || {}).id, true) + '</select></label>' +
        '<label>' + (type === 'withdrawal' ? 'Paid to' : 'Received from') + '<input type="text" id="rc-counter" list="rc-dl" value="' + esc(counter && counter !== 'Cash account' ? counter : '') + '" required></label></div>' +
        '<datalist id="rc-dl">' + counterList.map(a => '<option value="' + esc(a.name) + '">').join('') + '</datalist>') +
    '<div class="grid2"><label>Category<input type="text" id="rc-cat" list="rc-dlcat" value="' + esc(t.category_name || '') + '"></label>' +
      (type === 'withdrawal' ? '<label>Budget<select id="rc-bud">' + opt('', 'None', t.budget_id || '') + L.budgets.filter(b => b.active).map(b => opt(b.id, b.name, String(t.budget_id || ''))).join('') + '</select></label>' : '<span></span>') + '</div>' +
    '<datalist id="rc-dlcat">' + L.categories.map(c => '<option value="' + esc(c.name) + '">').join('') + '</datalist>' +
    '<div class="grid2"><label>First date<input type="date" id="rc-first" value="' + firstDate + '" required></label>' +
    '<label>Repeats every<div style="display:flex;gap:8px;margin-top:5px"><input type="number" min="1" step="1" id="rc-every" value="' + ((rep.skip || 0) + 1) + '" style="width:70px">' +
      '<select id="rc-freq" style="flex:1">' + ['monthly', 'weekly', 'yearly', 'daily'].map(v => opt(v, REPEAT_LABEL[v] + '(s)', rep.type || 'monthly')).join('') + '</select></div></label></div>' +
    '<p class="hint">It repeats on the same day as the first date (e.g. the 1st of each month).</p>' +
    '<div class="grid2"><label>If it falls on a weekend<select id="rc-weekend">' + [[1, 'Create it anyway'], [2, 'Skip it'], [3, 'Move to the Friday before'], [4, 'Move to the Monday after']].map(([v, l]) => opt(v, l, rep.weekend || 1)).join('') + '</select></label>' +
    '<label>Ends<select id="rc-endmode" data-onchange="App.recurEnds()">' + opt('never', 'Never', endMode) + opt('date', 'On a date', endMode) + opt('count', 'After a number of times', endMode) + '</select></label></div>' +
    '<div class="grid2"><label id="rc-until-l"' + (endMode === 'date' ? '' : ' hidden') + '>End date<input type="date" id="rc-until" value="' + esc(at && at.repeat_until ? String(at.repeat_until).slice(0, 10) : '') + '"></label>' +
    '<label id="rc-count-l"' + (endMode === 'count' ? '' : ' hidden') + '>Number of times<input type="number" min="1" id="rc-count" value="' + esc(at && at.nr_of_repetitions || '') + '"></label></div>' +
    '<label>Notes<textarea id="rc-notes" rows="2">' + esc(at ? at.notes || '' : '') + '</textarea></label>' +
    '<label class="check"><input type="checkbox" id="rc-rules"' + (!at || at.apply_rules ? ' checked' : '') + '> Run my rules on each transaction it creates</label>' +
    '<label class="check"><input type="checkbox" id="rc-active"' + (!at || at.active !== false ? ' checked' : '') + '> Active</label><button type="submit" hidden></button></form>',
    (id ? '<button class="btn danger" data-onclick="App.deleteRecur(\'' + id + '\')">Delete</button>' : '') + '<span class="grow"></span><button class="btn" data-onclick="App.closeDrawer()">Cancel</button>' +
    '<button class="btn primary" id="recSave" data-onclick="App.submit(\'recForm\')">' + (id ? 'Save' : 'Create') + '</button>');
}
function recurType(t) {
  const keep = ['rc-title', 'rc-amount', 'rc-desc', 'rc-cat', 'rc-first', 'rc-every', 'rc-notes'].map(k => [k, el(k) ? el(k).value : '']);
  recurForm(S.form.id, t);
  keep.forEach(([k, v]) => { if (el(k)) el(k).value = v; });
}
function recurEnds() { const m = el('rc-endmode').value; el('rc-until-l').hidden = m !== 'date'; el('rc-count-l').hidden = m !== 'count'; }
async function accountIdFor(name, kind) {
  const L = S.lists, pool = kind === 'withdrawal' ? [...L.expense, ...L.own.filter(isLiab)] : [...L.revenue, ...L.own.filter(isLiab)];
  const hit = pool.find(a => sameName(a.name, name));
  if (hit) return hit.id;
  const res = await api('/accounts', { method: 'POST', body: { name: name.trim(), type: kind === 'withdrawal' ? 'expense' : 'revenue' } });
  return String(res.data.id);
}
async function categoryIdFor(name) {
  if (!name) return '';
  const hit = S.lists.categories.find(c => sameName(c.name, name));
  if (hit) return hit.id;
  const res = await api('/categories', { method: 'POST', body: { name: name.trim() } });
  return String(res.data.id);
}
async function saveRecur() {
  const f = S.form, v = x => el(x) ? el(x).value.trim() : '';
  const type = f.type;
  if (!v('rc-title')) return formError('Give it a name.');
  if (!(num(v('rc-amount')) > 0)) return formError('Enter an amount above zero.');
  await busy(el('recSave'), async () => {
    const tx = { description: v('rc-desc') || v('rc-title'), amount: String(num(v('rc-amount'))), currency_code: S.currency };
    if (type === 'transfer') {
      if (!v('rc-src') || !v('rc-dst') || v('rc-src') === v('rc-dst')) throw new Error('Choose two different accounts.');
      tx.source_id = v('rc-src'); tx.destination_id = v('rc-dst');
    } else {
      if (!v('rc-main')) throw new Error('Choose the account.');
      if (!v('rc-counter')) throw new Error('Say who it is ' + (type === 'withdrawal' ? 'paid to.' : 'received from.'));
      const other = await accountIdFor(v('rc-counter'), type);
      if (type === 'withdrawal') { tx.source_id = v('rc-main'); tx.destination_id = other; } else { tx.source_id = other; tx.destination_id = v('rc-main'); }
    }
    const cat = await categoryIdFor(v('rc-cat')); if (cat) tx.category_id = cat;
    if (type === 'withdrawal' && v('rc-bud')) tx.budget_id = v('rc-bud');
    const first = v('rc-first'), freq = v('rc-freq'), d = new Date(first + 'T12:00:00');
    const moment = freq === 'monthly' ? String(d.getDate()) : freq === 'weekly' ? String(d.getDay() || 7) : freq === 'yearly' ? first : '';
    const body = { type, title: v('rc-title'), first_date: first, apply_rules: el('rc-rules').checked, active: el('rc-active').checked, notes: el('rc-notes').value,
      repetitions: [{ type: freq, moment, skip: Math.max(0, parseInt(v('rc-every') || '1', 10) - 1), weekend: parseInt(v('rc-weekend'), 10) }], transactions: [tx] };
    const mode = v('rc-endmode');
    if (mode === 'date') { if (!v('rc-until')) throw new Error('Pick the end date.'); body.repeat_until = v('rc-until'); }
    if (mode === 'count') { if (!(parseInt(v('rc-count'), 10) > 0)) throw new Error('Enter how many times.'); body.nr_of_repetitions = parseInt(v('rc-count'), 10); }
    await api(f.id ? '/recurrences/' + f.id : '/recurrences', { method: f.id ? 'PUT' : 'POST', body });
    invalidate(); closeDrawer(); toast(f.id ? 'Recurring transaction saved' : 'Recurring transaction created'); route();
  });
}
async function deleteRecur(id) {
  if (!await confirmBox('Delete this recurring transaction?', 'Transactions it already created stay. It won’t create new ones.')) return;
  await withAuth(async () => { await api('/recurrences/' + id, { method: 'DELETE' }); closeDrawer(); toast('Recurring transaction deleted'); route(); });
}

/* ================= Reports ================= */
function reportRange(q) {
  const t = new Date(), y = t.getFullYear(), m = t.getMonth();
  const P = {
    'this-month': [monthRange(y, m).start, monthRange(y, m).end], 'last-month': [monthRange(y, m - 1).start, monthRange(y, m - 1).end],
    'last-3': [monthRange(y, m - 2).start, monthRange(y, m).end], 'this-year': [y + '-01-01', y + '-12-31'],
    'last-year': [(y - 1) + '-01-01', (y - 1) + '-12-31'], 'last-12': [monthRange(y, m - 11).start, monthRange(y, m).end],
  };
  if (q.start && q.end) return { start: q.start, end: q.end, preset: '' };
  const p = q.preset || 'this-month';
  return { start: P[p][0], end: P[p][1], preset: p };
}
function shareTable(title, rows, opts = {}) {
  rows = rows.filter(r => r.v > 0).sort((a, b) => b.v - a.v);
  const total = rows.reduce((s, r) => s + r.v, 0), top = rows.slice(0, opts.limit || 12), rest = rows.slice(opts.limit || 12);
  if (rest.length) top.push({ name: rest.length + ' others', v: rest.reduce((s, r) => s + r.v, 0) });
  const max = Math.max(1, ...top.map(r => r.v));
  return '<section class="panel"><div class="panel-head"><h2>' + title + '</h2><span class="num">' + money0(total) + '</span></div><p class="lead">' + (opts.lead || '') + '</p>' +
    (top.length ? top.map(r => '<div class="cat"><div class="row"><span class="name">' + (r.href ? '<a href="' + r.href + '" style="text-decoration:none">' + esc(r.name) + '</a>' : esc(r.name)) + '</span><span class="num">' + money0(r.v) +
      ' <span class="neutral">' + (total ? (r.v / total * 100).toFixed(0) : 0) + '%</span></span></div><div class="track"><div class="fill' + (opts.good ? ' good' : '') + '" style="width:' + (r.v / max * 100).toFixed(1) + '%"></div></div></div>').join('')
      : '<p class="empty">Nothing in this period.</p>') + '</section>';
}
VIEWS.reports = async (r, paint) => {
  const L = await lists();
  const R = reportRange(r.q), p = { start: R.start, end: R.end };
  const months = [];
  for (let d = new Date(R.start + 'T12:00:00'); isoDate(d) <= R.end && months.length < 36; d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12)) {
    const mr = monthRange(d.getFullYear(), d.getMonth());
    months.push({ start: mr.start < R.start ? R.start : mr.start, end: mr.end > R.end ? R.end : mr.end, label: mr.short + (months.length === 0 || d.getMonth() === 0 ? ' ’' + String(d.getFullYear()).slice(2) : '') });
  }
  const own = L.accounts.filter(a => (isAsset(a) || isLiab(a)) && a.active);
  const g = path => api(path, { params: p }).catch(() => []);
  const [inc, exp, xfer, byCat, noCat, byBud, noBud, byTag, byPayee, bySrc, byIncCat, trend, balStart, balEnd] = await Promise.all([
    g('/insight/income/total'), g('/insight/expense/total'), g('/insight/transfer/total'), g('/insight/expense/category'), g('/insight/expense/no-category'),
    g('/insight/expense/budget'), g('/insight/expense/no-budget'), g('/insight/expense/tag'), g('/insight/expense/expense'), g('/insight/income/revenue'), g('/insight/income/category'),
    Promise.all(months.map(mo => Promise.all([api('/insight/income/total', { params: mo }).catch(() => []), api('/insight/expense/total', { params: mo }).catch(() => [])])
      .then(([i, e]) => ({ label: mo.label, income: sumDiff(i), spend: sumDiff(e), go: 'report:' + mo.start + ':' + mo.end })))),
    Promise.all(own.map(a => api('/accounts/' + a.id, { params: { date: addDays(R.start, -1) } }).then(x => num(x.data.attributes.current_balance)).catch(() => null))),
    Promise.all(own.map(a => api('/accounts/' + a.id, { params: { date: R.end > todayIso() ? todayIso() : R.end } }).then(x => num(x.data.attributes.current_balance)).catch(() => null))),
  ]);
  const earned = sumDiff(inc), spent = sumDiff(exp), net = earned - spent;
  const rowsOf = (res, link) => arr(res).map(x => ({ name: x.name, v: absDiff(x), href: link && x.id ? link + x.id : '' }));
  const nwS = own.reduce((s, a, i) => s + (balStart[i] ?? 0), 0), nwE = own.reduce((s, a, i) => s + (balEnd[i] ?? 0), 0);
  const presetBtn = (k, l) => '<a class="btn small' + (R.preset === k ? ' primary' : '') + '" href="#/reports?preset=' + k + '">' + l + '</a>';
  const accRows = own.map((a, i) => ({ a, s: balStart[i], e: balEnd[i] })).filter(x => x.s !== null && x.e !== null && (x.s || x.e))
    .map(({ a, s, e }) => '<tr><td class="desc">' + esc(a.name) + '</td><td class="amt hide-s">' + money(s) + '</td><td class="amt">' + money(e) + '</td><td class="amt ' + (e - s > 0 ? 'pos' : e - s < 0 ? 'neg' : 'neutral') + '">' + (e - s > 0 ? '+' : '') + money(e - s) + '</td></tr>').join('');
  paint(head('Reports', fmtDate(R.start) + ' – ' + fmtDate(R.end), '<button class="btn" data-onclick="App.print()">Print</button>') +
    '<div class="toolbar"><div style="display:flex;gap:6px;flex-wrap:wrap">' + presetBtn('this-month', 'This month') + presetBtn('last-month', 'Last month') + presetBtn('last-3', 'Last 3 months') +
      presetBtn('this-year', 'This year') + presetBtn('last-year', 'Last year') + presetBtn('last-12', 'Last 12 months') + '</div>' +
      '<form style="display:flex;gap:8px;align-items:center" data-onsubmit="event.preventDefault();App.reportsRange(this)">' +
      '<input type="date" name="s" value="' + R.start + '"><span class="neutral">to</span><input type="date" name="e" value="' + R.end + '"><button class="btn small">Apply</button></form></div>' +
    '<div class="kpis"><div class="kpi"><div class="eyebrow">Earned</div><div class="val num pos">' + money0(earned) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Spent</div><div class="val num neg">' + money0(spent) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Net</div><div class="val num ' + (net < 0 ? 'neg' : '') + '">' + money0(net) + '</div><div class="sub-s">' + (earned ? (net / earned * 100).toFixed(0) + '% of income kept' : '') + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Moved between accounts</div><div class="val num">' + money0(sumDiff(xfer)) + '</div></div>' +
      '<div class="kpi"><div class="eyebrow">Balance change</div><div class="val num ' + (nwE - nwS < 0 ? 'neg' : 'pos') + '">' + (nwE - nwS > 0 ? '+' : '') + money0(nwE - nwS) + '</div><div class="sub-s">across your accounts</div></div></div>' +
    (months.length > 1 ? '<section class="panel chart" style="margin-bottom:20px">' + cashFlow(trend).replace('over the last six months · click a month to open it', 'by month · click a month to report on it') + '</section>' : '') +
    '<div class="cards">' +
      shareTable('Spending by category', [...rowsOf(byCat, '#/transactions?category='), { name: 'Uncategorized', v: sumDiff(noCat) }]) +
      shareTable('Spending by budget', [...rowsOf(byBud, '#/transactions?budget='), { name: 'No budget', v: sumDiff(noBud) }]) +
      shareTable('Top payees', rowsOf(byPayee, '#/account/'), { limit: 15 }) +
      shareTable('Income by source', rowsOf(bySrc, '#/account/'), { good: true }) +
      shareTable('Income by category', rowsOf(byIncCat, '#/transactions?category='), { good: true }) +
      shareTable('Spending by tag', rowsOf(byTag, '#/transactions?tag='), { lead: 'Tagged spending only' }) +
    '</div>' +
    '<section class="panel flush"><div style="padding:22px 26px 6px"><h2 style="font-size:15px;margin:0">Account balances</h2></div>' +
      (accRows ? '<table class="tbl"><thead><tr><th>Account</th><th class="r hide-s">' + fmtDay(addDays(R.start, -1)) + '</th><th class="r">' + fmtDay(R.end > todayIso() ? todayIso() : R.end) + '</th><th class="r">Change</th></tr></thead><tbody>' + accRows + '</tbody></table>' : '<div class="center-empty">No balances.</div>') +
    '</section>');
};

/* ================= Settings ================= */
const EXPORTS = [['transactions', 'Transactions'], ['accounts', 'Accounts'], ['budgets', 'Budgets'], ['categories', 'Categories'], ['tags', 'Tags'],
  ['bills', 'Bills'], ['piggy-banks', 'Piggy banks'], ['recurring', 'Recurring transactions'], ['rules', 'Rules']];
VIEWS.settings = async (r, paint) => {
  const L = await lists(true);
  const [about, rates, hooks] = await Promise.all([
    api('/about').catch(() => ({})), getAll('/exchange-rates').catch(() => null), getAll('/webhooks').catch(() => null),
  ]);
  const enabled = L.currencies.filter(c => c.enabled), disabled = L.currencies.filter(c => !c.enabled);
  const yr = new Date().getFullYear();
  const cur = '<section class="panel"><h2>Currencies</h2><p class="lead">Your main currency is <strong>' + esc(S.currency) + '</strong>. Enabled currencies can be used for foreign amounts and accounts.</p><div class="list">' +
    enabled.map(c => '<div class="row"><span class="name">' + esc(c.code) + ' · ' + esc(c.name) + (c.code === S.currency ? ' <span class="chip good">Main</span>' : '') + '</span><span style="display:flex;gap:8px">' +
      (c.code !== S.currency ? '<button class="link" data-onclick="App.currency(\'' + c.code + '\',\'primary\')">Make main</button><button class="link" data-onclick="App.currency(\'' + c.code + '\',\'disable\')">Disable</button>' : '') + '</span></div>').join('') +
    '</div><form style="display:flex;gap:8px;margin-top:14px" data-onsubmit="event.preventDefault();App.currency(this.c.value,\'enable\')"><select name="c" style="flex:1">' + disabled.map(c => opt(c.code, c.code + ' · ' + c.name, '')).join('') + '</select><button class="btn">Enable</button></form></section>';
  S.rates = rates || [];
  const showAll = r.q.rates === 'all';
  const rateHtml = rates === null ? '' : '<section class="panel"><h2>Exchange rates</h2><p class="lead">Used to convert foreign amounts in reports.</p>' +
    (rates.length ? '<div class="list">' + rates.slice(0, showAll ? 500 : 6).map(x => { const a = x.attributes; return '<div class="row"><span class="name">1 ' + esc(a.from_currency_code || a.from) + ' = ' + esc(num(a.rate)) + ' ' + esc(a.to_currency_code || a.to) +
      ' <span class="sub-s">on ' + fmtDate(a.date) + '</span></span><button class="link" data-onclick="App.deleteRate(\'' + x.id + '\')">Remove</button></div>'; }).join('') + '</div>' +
      (rates.length > 6 ? '<p style="margin:10px 0 0"><a class="link" href="#/settings' + (showAll ? '' : '?rates=all') + '">' + (showAll ? 'Show fewer' : 'Show all ' + rates.length + ' rates') + '</a></p>' : '') : '<p class="empty">No rates yet.</p>') +
    '<form style="margin-top:14px" data-onsubmit="event.preventDefault();App.addRate(this)"><div class="grid2">' +
    '<label>From<select name="f">' + enabled.map(c => opt(c.code, c.code, S.currency)).join('') + '</select></label>' +
    '<label>To<select name="t">' + enabled.map(c => opt(c.code, c.code, (enabled.find(x => x.code !== S.currency) || {}).code)).join('') + '</select></label>' +
    '<label>Rate<input type="number" step="any" min="0" name="r" required></label><label>Date<input type="date" name="d" value="' + todayIso() + '" required></label></div><button class="btn small">Add rate</button></form></section>';
  const exp = '<section class="panel"><h2>Export data</h2><p class="lead">Download CSV files you can open in Excel or Numbers.</p>' +
    '<div class="grid2"><label>From (transactions only)<input type="date" id="ex-start" value="' + (yr - 1) + '-01-01"></label><label>To<input type="date" id="ex-end" value="' + todayIso() + '"></label></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px">' + EXPORTS.map(([k, l]) => '<button class="btn small" data-onclick="App.exportData(\'' + k + '\', this)">' + l + '</button>').join('') + '</div></section>';
  const TRIG = [['STORE_TRANSACTION', 'A transaction is added'], ['UPDATE_TRANSACTION', 'A transaction is changed'], ['DESTROY_TRANSACTION', 'A transaction is deleted']];
  const hookHtml = hooks === null ? '' : '<section class="panel"><h2>Webhooks</h2><p class="lead">Firefly calls these web addresses when transactions change — for automations like Home Assistant or n8n.</p>' +
    (hooks.length ? '<div class="list">' + hooks.map(x => { const a = x.attributes, tr = a.trigger || (a.triggers || [])[0];
      return '<div class="row"><span class="name"><label class="check" style="margin:0;display:inline-flex"><input type="checkbox"' + (a.active ? ' checked' : '') + ' data-onchange="App.toggleHook(\'' + x.id + '\',this.checked)"> ' + esc(a.title) + '</label>' +
        '<br><span class="sub-s">' + esc((TRIG.find(t => t[0] === tr) || [0, tr])[1]) + ' → ' + esc(a.url) + '</span></span><button class="link" data-onclick="App.deleteHook(\'' + x.id + '\')">Delete</button></div>'; }).join('') + '</div>' : '<p class="empty">No webhooks.</p>') +
    '<form data-onsubmit="event.preventDefault();App.addHook(this)" style="margin-top:14px"><div class="grid2"><label>Name<input type="text" name="t" required></label><label>When<select name="w">' + TRIG.map(([v, l]) => opt(v, l, '')).join('') + '</select></label></div>' +
    '<label>URL<input type="text" name="u" placeholder="https://…" required></label><div class="grid2"><label>Send<select name="r">' + opt('TRANSACTIONS', 'The transaction', '') + opt('ACCOUNTS', 'The accounts involved', '') + opt('NONE', 'Nothing (just ping)', '') + '</select></label><span></span></div>' +
    '<button class="btn small">Add webhook</button></form></section>';
  const ab = (about && about.data) || {};
  const aboutHtml = '<section class="panel"><h2>About</h2><div class="list">' +
    '<div class="row"><span class="name">Money version</span><span>' + esc(moneyVersion() || 'Not stamped (local build or plain files)') + '</span></div>' +
    '<div class="row"><span class="name">Firefly III version</span><span>' + esc(ab.version || '—') + '</span></div>' +
    '<div class="row"><span class="name">API version</span><span>' + esc(ab.api_version || '—') + '</span></div>' +
    '<div class="row"><span class="name">Main currency</span><span>' + esc(S.currency) + '</span></div></div>' +
    '<p class="sub-s" style="margin-top:14px">Your Firefly profile, password, two-factor login, API tokens and user administration aren’t available through Firefly’s API, so change those in Firefly III itself.</p></section>';
  paint(head('Settings', '', '') + '<div class="cards">' + cur + rateHtml + exp + hookHtml + aboutHtml + '</div>');
};
// The build stamped into the Docker image by GitHub, e.g. "c78fd51 · 2026-09-30". Empty for a local build or plain files.
function moneyVersion() {
  const m = document.querySelector('meta[name="money-version"]'), v = m ? m.content.trim() : '';
  return v && !v.startsWith('$') ? v : '';
}
async function currency(code, action) {
  if (!code) return;
  await withAuth(async () => {
    try { await api('/currencies/' + code + '/' + action, { method: 'POST' }); }
    catch (e) {
      if (action === 'primary') await api('/currencies/' + code + '/default', { method: 'POST' });
      else if (action === 'disable' && e.status === 409) return disableInUse(code);
      else throw e;
    }
    invalidate(); toast({ enable: 'Enabled ', disable: 'Disabled ', primary: 'Main currency is now ' }[action] + code); route();
  });
}
// Firefly refuses (409) to disable a currency that anything still uses. Exchange rates are the usual
// culprit (Firefly adds a set of EUR rates itself), so offer to remove those and try again.
async function disableInUse(code) {
  const rates = (S.rates || []).filter(x => [x.attributes.from_currency_code || x.attributes.from, x.attributes.to_currency_code || x.attributes.to].includes(code));
  if (!rates.length) {
    return confirmBox(code + ' is still in use', 'Firefly won’t disable ' + code + ' while an account, bill, budget, piggy bank or transaction uses it. Change those to another currency first.', 'OK');
  }
  if (!await confirmBox(code + ' is still in use', code + ' has ' + rates.length + ' exchange rate' + (rates.length === 1 ? '' : 's') + ', which stops Firefly from disabling it. Remove ' +
    (rates.length === 1 ? 'that rate' : 'those rates') + ' and disable ' + code + '?', 'Remove & disable')) return;
  let done = 0;
  for (const x of rates) { try { await api('/exchange-rates/' + x.id, { method: 'DELETE' }); done++; } catch (e) { if (e instanceof AuthError) throw e; } }
  try {
    await api('/currencies/' + code + '/disable', { method: 'POST' });
    toast('Removed ' + done + ' rate' + (done === 1 ? '' : 's') + ' and disabled ' + code);
  } catch (e) {
    if (e.status !== 409) throw e;
    await confirmBox(code + ' is still in use', 'The exchange rates are gone, but something else still uses ' + code + ' — an account, bill, budget, piggy bank or transaction. Change those first.', 'OK');
  }
  invalidate(); route();
}
async function addRate(f) {
  if (f.f.value === f.t.value) return toast('Pick two different currencies.');
  await withAuth(async () => { await api('/exchange-rates', { method: 'POST', body: { from: f.f.value, to: f.t.value, rate: String(num(f.r.value)), date: f.d.value } }); toast('Rate added'); route(); });
}
async function deleteRate(id) { await withAuth(async () => { await api('/exchange-rates/' + id, { method: 'DELETE' }); toast('Rate removed'); route(); }); }
async function exportData(kind, btn) {
  btn.disabled = true;
  await withAuth(async () => {
    const params = { type: 'csv' };
    if (kind === 'transactions') { params.start = el('ex-start').value; params.end = el('ex-end').value; }
    const blob = await api('/data/export/' + kind, { params, as: 'blob' });
    saveBlob(blob, 'firefly-' + kind + '-' + todayIso() + '.csv');
  });
  btn.disabled = false;
}
async function addHook(f) {
  const body = { title: f.t.value.trim(), url: f.u.value.trim(), active: true, trigger: f.w.value, response: f.r.value, delivery: 'JSON',
    triggers: [f.w.value], responses: [f.r.value], deliveries: ['JSON'] };
  if (!/^https?:\/\//.test(body.url)) return toast('The URL must start with http:// or https://');
  await withAuth(async () => { await api('/webhooks', { method: 'POST', body }); toast('Webhook added'); route(); });
}
async function toggleHook(id, on) { await withAuth(async () => { await api('/webhooks/' + id, { method: 'PUT', body: { active: on } }); toast(on ? 'Webhook on' : 'Webhook off'); }); }
async function deleteHook(id) {
  if (!await confirmBox('Delete this webhook?', 'Firefly will stop calling that address.')) return;
  await withAuth(async () => { await api('/webhooks/' + id, { method: 'DELETE' }); toast('Webhook deleted'); route(); });
}

Object.assign(window.App, {
  selChanged, selAll, bulk, loadTxExtras, uploadAtt, downloadAtt, deleteAtt, findLink, makeLink, deleteLink,
  recCalc, recTick, recAll, recDates, recFinish, recAdjust,
  toggleRule, ruleForm, ruleAdd, ruleRowType, saveRule, deleteRule, groupForm, saveGroup, deleteGroup, runRules, previewRules, applyRules,
  recurForm, recurType, recurEnds, saveRecur, deleteRecur,
  currency, addRate, deleteRate, exportData, addHook, toggleHook, deleteHook,
});
