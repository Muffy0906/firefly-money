/* Shared UI pieces. Each helper returns the exact markup the pages used to repeat by hand, on the CSS tokens in
   money.css, so a pattern changes in one place. Docs: docs/ui-components.md. Like head() and emptyState() in dom.ts,
   they return html``: put the result in html`` or String() it, never join it with +. Handlers stay literal
   data-on* strings in the calling page (App.x(...)), so the helpers take pre-built html for anything with one. */
import { type Html, html } from './html';

type Link = { href: string; label: string };

// A panel's heading and its lead line; with link, the heading shares a row with a link on the right
export const panelHead = (title: string | Html, lead?: string | Html, link?: Link) => html`${link
  ? html`<div class="panel-head"><h2>${title}</h2><a class="link" href="${link.href}">${link.label}</a></div>`
  : html`<h2>${title}</h2>`}${lead == null ? '' : html`<p class="lead">${lead}</p>`}`;

// A whole panel: heading, lead, body. cls adds classes (chart, flush, quiet), style is written inline as before
export const panel = (title: string | Html, lead: string | Html | undefined, body: unknown, o: { link?: Link; cls?: string; style?: string } = {}) =>
  html`<section class="panel${o.cls ? ' ' + o.cls : ''}"${o.style ? html` style="${o.style}"` : ''}>${panelHead(title, lead, o.link)}${body}</section>`;

// One line of muted text inside a panel: nothing to show here
export const emptyNote = (text: string | Html) => html`<p class="empty">${text}</p>`;

// A tick, a title and a line: the page is done, there is nothing to do. pad is the vertical padding in px
export const doneState = (title: string, text: string | Html, pad = 60) =>
  html`<div class="center-empty" style="padding:${pad}px 20px"><div style="font-size:40px">✓</div><h2 style="font-size:18px;margin:12px 0 4px">${title}</h2>${text}</div>`;

// A figure with a small caption above it, and an optional line under it. A sub of null, undefined or false is left out
export const kpi = (label: string | Html, value: unknown, sub?: unknown, cls = '') =>
  html`<div class="kpi"><div class="eyebrow">${label}</div><div class="val num ${cls}">${value}</div>${sub == null || sub === false ? '' : html`<div class="sub-s">${sub}</div>`}</div>`;
