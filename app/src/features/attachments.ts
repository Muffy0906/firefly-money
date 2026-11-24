import { html, htmlList } from '../core/html';
import { api, getAll } from '../core/api';
import { withAuth } from '../core/auth';
import { App, S, arr, el, fmtDay, money } from '../core/base';
import { confirmBox, opt, toast } from '../core/dom';
import { normGroup } from '../core/feed';
import { fmtSize, saveBlob } from '../core/helpers';
import { emptyNote } from '../core/ui';

/* ================= Attachments & links in the transaction drawer ================= */
async function loadTxExtras(gid: string, jids: string[]) {
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
    const attHtml = atts.length ? html`<div class="list">${htmlList(atts.map(a => {
      const at = a.attributes;
      return html`<div class="row"><span class="name"><button class="link" data-onclick="App.downloadAtt('${a.id}','${String(at.filename).replace(/'/g, '')}')">${at.title || at.filename}</button> <span class="sub-s">${fmtSize(at.size)}</span></span><button class="link" data-onclick="App.deleteAtt('${a.id}')">Remove</button></div>`;
    }))}</div>` : html`<p class="empty" style="padding-top:0">No files attached.</p>`;
    const linkHtml = others.length ? html`<div class="list">${htmlList(others.map(({ l, mine, g }) => {
      const t = typeById[String(l.attributes.link_type_id)] || {}, phrase = mine ? t.outward : t.inward;
      return html`<div class="row"><span class="name"><span class="sub-s">${phrase || 'linked to'}</span><br>${g ? html`<button class="link" data-onclick="App.editTx('${g.id}')">${g.title || g.splits[0].description}</button> <span class="sub-s">${fmtDay(g.date)} · ${money(g.total)}</span>` : 'Transaction #' + (mine ? l.attributes.inward_id : l.attributes.outward_id)}</span><button class="link" data-onclick="App.deleteLink('${l.id}')">Unlink</button></div>`;
    }))}</div>` : html`<p class="empty" style="padding-top:0">Not linked to anything.</p>`;
    const dirOpts = htmlList(types.flatMap(t => { const a = t.attributes; return a.inward === a.outward ? [opt(t.id + ':out', a.outward, '')] : [opt(t.id + ':out', a.outward, ''), opt(t.id + ':in', a.inward, '')]; }));
    box.innerHTML =
      String(html`<div class="extra"><h3>Attachments</h3>${attHtml}<label style="margin:12px 0 0">Add files<input type="file" id="attFile" multiple data-onchange="App.uploadAtt('${jids[0]}', this)"></label></div><div class="extra"><h3>Linked transactions</h3>${linkHtml}${types.length ? html`<div style="margin-top:12px"><div class="grid2"><label>This transaction…<select id="lnkType">${dirOpts}</select></label><label>…this one<input type="search" id="lnkQ" placeholder="Search description" data-onkeydown="App.linkKey(event)"></label></div><button class="btn small" type="button" data-onclick="App.findLink()">Find</button><div id="lnkResults" style="margin-top:10px"></div></div>` : ''}</div>`);
    S.extrasCtx = { gid, jids };
  } catch (e) { if (el('txExtras')) el('txExtras').innerHTML = String(html`<p class="sub-s">${(e as Error).message}</p>`); }
}
const refreshExtras = () => S.extrasCtx && loadTxExtras(S.extrasCtx.gid, S.extrasCtx.jids);
async function uploadAtt(jid: string, input: HTMLInputElement) {
  const files = [...input.files!]; if (!files.length) return;
  await withAuth(async () => {
    for (const f of files) {
      toast('Uploading ' + f.name + '…');
      const res = await api('/attachments', { method: 'POST', body: { filename: f.name, title: f.name, attachable_type: 'TransactionJournal', attachable_id: jid } });
      await api('/attachments/' + res.data.id + '/upload', { method: 'POST', raw: f, contentType: 'application/octet-stream' });
    }
    toast(files.length === 1 ? 'File attached' : files.length + ' files attached'); refreshExtras();
  });
}
async function downloadAtt(id: string, name: string) { await withAuth(async () => saveBlob(await api('/attachments/' + id + '/download', { as: 'blob' }), name)); }
async function deleteAtt(id: string) {
  if (!await confirmBox('Remove this file?', 'The attachment is deleted from Firefly III.', 'Remove')) return;
  await withAuth(async () => { await api('/attachments/' + id, { method: 'DELETE' }); toast('File removed'); refreshExtras(); });
}
async function findLink() {
  const q = el<HTMLInputElement>('lnkQ').value.trim(); if (!q) return;
  await withAuth(async () => {
    const res = await api('/search/transactions', { params: { query: q, search: q, limit: 8, page: 1 } });
    const gs = arr(res).map(normGroup).filter(g => g.id !== S.extrasCtx!.gid);
    el('lnkResults').innerHTML = String(gs.length ? html`<div class="list">${htmlList(gs.map(g => html`<div class="row"><span class="name">${g.title || g.splits[0].description} <span class="sub-s">${fmtDay(g.date)} · ${money(g.total)}</span></span><button class="btn small" type="button" data-onclick="App.makeLink('${g.splits[0].jid}')">Link</button></div>`))}</div>` : html`${emptyNote('No matches.')}`);
  });
}
async function makeLink(otherJid: string) {
  const [typeId, dir] = el<HTMLSelectElement>('lnkType').value.split(':'), me = S.extrasCtx!.jids[0];
  const body = dir === 'out' ? { link_type_id: typeId, outward_id: me, inward_id: otherJid } : { link_type_id: typeId, outward_id: otherJid, inward_id: me };
  await withAuth(async () => { await api('/transaction-links', { method: 'POST', body }); toast('Linked'); refreshExtras(); });
}
async function deleteLink(id: string) {
  if (!await confirmBox('Remove this link?', 'Both transactions stay; only the link between them is removed.', 'Unlink')) return;
  await withAuth(async () => { await api('/transaction-links/' + id, { method: 'DELETE' }); toast('Link removed'); refreshExtras(); });
}

// The methods markup handlers call (see events.ts), added to App and to its type
const methods = {
  loadTxExtras,
  uploadAtt,
  downloadAtt,
  deleteAtt,
  findLink,
  makeLink,
  deleteLink,
};
Object.assign(App, methods);
type Methods = typeof methods;
declare module '../core/base' { interface AppApi extends Methods {} }
