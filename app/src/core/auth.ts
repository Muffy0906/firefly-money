import { AuthError, CACHE, PAGES, dropSavedCopies } from './api';
import { S, el } from './base';
import { closeDrawer, formError, toast } from './dom';

/* Signing in and out, and what happens when Firefly or the session check says no.
   The server keeps the session in an HttpOnly cookie that scripts can't read (see app/session.js), so the page
   only remembers whether you ticked "Keep me signed in", which decides how long the session lasts. */

const SESSION = '/api/money-session', FLAG = 'moneySignedIn';
export function rememberedSignIn() { try { return localStorage.getItem(FLAG) === '1'; } catch (e) { return false; } }
function setRemembered(on: boolean) { S.remember = on; try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch (e) { /* storage blocked */ } }
let signingOut: Promise<unknown> = Promise.resolve();
export async function signIn(password: string, remember: boolean) {
  await signingOut;      // or the sign-out's cookie could land after this sign-in's
  const r = await fetch(SESSION, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Money': '1' }, body: JSON.stringify({ password, remember: !!remember }) });
  if (r.status === 401) throw new AuthError('That password isn’t right.');
  if (r.status === 429) throw new Error('Too many sign-in attempts. Wait a minute, then try again.');
  if (!r.ok) throw new Error('Couldn’t sign in (' + r.status + ').');
  S.signedIn = true; setRemembered(!!remember);
}
export function signOut() { signingOut = fetch(SESSION, { method: 'DELETE', headers: { 'X-Money': '1' } }).catch(() => {}); }
// Up to v1.1 the page kept the password itself (localStorage with "Keep me signed in", else sessionStorage).
// Trade it for a session once and delete it, so updating doesn't sign anyone out. When offline, try again next time.
export async function migrateSavedPassword() {
  let k = '', kept = false;
  try { k = localStorage.getItem('moneyKey') || ''; kept = !!k; k = k || sessionStorage.getItem('moneyKey') || ''; } catch (e) { return; }
  if (!k) return;
  if (kept) setRemembered(true);
  try { await signIn(k, kept); } catch (e) { if (!(e instanceof AuthError)) return; }
  try { localStorage.removeItem('moneyKey'); sessionStorage.removeItem('moneyKey'); } catch (e) { /* ignore */ }
}
// Everything this tab knows (and any copy an earlier version saved) goes when the sign-in screen shows.
function forgetDeviceData() {
  CACHE.clear(); PAGES.clear(); dropSavedCopies(); S.signedIn = false; setRemembered(false);
}
export function showLogin(msg?: string) {
  closeDrawer(); S.lists = null; forgetDeviceData();
  el('app').hidden = true; el('login').hidden = false;
  const e = el('loginErr'); e.hidden = !msg; e.textContent = msg || '';
  el<HTMLInputElement>('loginPw').value = ''; el<HTMLInputElement>('loginPw').focus();
}
export async function withAuth<T>(fn: () => Promise<T>) { try { return await fn(); } catch (e) { if (e instanceof AuthError) return showLogin(e.message); toast((e as Error).message); } }
export async function busy(btn: HTMLButtonElement | null | undefined, fn: () => Promise<unknown>) {
  if (btn) { btn.disabled = true; btn.dataset.l = btn.textContent; btn.textContent = 'Saving…'; }
  try { await fn(); } catch (e) { if (e instanceof AuthError) return showLogin(e.message); formError((e as Error).message); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = btn.dataset.l!; } }
}
