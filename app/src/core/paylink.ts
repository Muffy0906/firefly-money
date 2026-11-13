import { LS } from './helpers';

/* ================= Pay now: the card issuer's own sign-in / payment page =================
   Nothing is paid in the app; the button only opens the issuer's site in a new tab.
   Known issuers are matched by account name; a card can have its own link (LS payUrls, by account id; synced). */
const ISSUERS: [RegExp, string][] = [
  [/\bamerican\s*express\b|\bamex\b/i, 'https://www.americanexpress.com/en-us/account/login'],
  [/\bcapital\s*one\b|\bcap\s*one\b|\bsavor\b|\bventure\b|\bquicksilver\b/i, 'https://verified.capitalone.com/auth/signin'],
  [/\bapple\s*card\b/i, 'https://card.apple.com'],
  [/\bdiscover\b/i, 'https://portal.discover.com/customersvcs/universalLogin/ac_main'],
  [/\bciti(bank)?\b|\bcostco\s*anywhere\b|\bdouble\s*cash\b/i, 'https://www.citi.com/login'],
  [/\bchase\b|\bsapphire\b|\bfreedom\b|\bamazon\s*(prime\s*)?(rewards|visa|card)\b|\bunited\s*(club|explorer|quest)\b/i, 'https://secure.chase.com/web/auth/dashboard'],
  [/\bbank\s*of\s*america\b|\bbofa\b|\bboa\b/i, 'https://www.bankofamerica.com/'],
  [/\bwells\s*fargo\b/i, 'https://connect.secure.wellsfargo.com/auth/login/present'],
  [/\bu\.?s\.?\s*bank\b|\busbank\b/i, 'https://onlinebanking.usbank.com/'],
  [/\bbarclay(s|card)?\b/i, 'https://www.barclaycardus.com/servicing/home'],
  [/\bsynchrony\b/i, 'https://www.mysynchrony.com/'],
  [/\bbilt\b/i, 'https://www.biltrewards.com/'],
  [/\bpaypal\b/i, 'https://www.paypal.com/myaccount/credit'],
];
export const safeUrl = (s: string): string => {
  let t = String(s || '').trim();
  if (!t) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = 'https://' + t;
  try { const u = new URL(t); return u.protocol === 'https:' && u.hostname.includes('.') ? u.href : ''; } catch (e) { return ''; }
};
export const issuerUrl = (name: string): string => ISSUERS.find(([re]) => re.test(name))?.[1] ?? '';
// Your own link for this card if set, else the known issuer's; '' when neither (no button)
export function payUrl(id: string, name: string): string {
  const own = safeUrl((LS.get('payUrls', {}) as Record<string, string>)[id]);
  return own || issuerUrl(name);
}
export const customPayUrl = (id: string): string => safeUrl((LS.get('payUrls', {}) as Record<string, string>)[id]);
export function setPayUrl(id: string, url: string) {
  const m = { ...(LS.get('payUrls', {}) as Record<string, string>) };
  const u = safeUrl(url);
  if (u && u !== issuerUrl('')) m[id] = u; else delete m[id];
  LS.set('payUrls', m);
}
