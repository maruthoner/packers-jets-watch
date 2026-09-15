// Pure status page rendering.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => `$${n.toFixed(2)}`;

function card(l, w, hit) {
  const where = `${esc(l.secLabel || 'Section not assigned')} &middot; Row ${esc(l.rowLabel || 'not assigned')}`;
  const why = hit
    ? (l.unassigned ? 'Fits your price — <b>exact seats not assigned yet</b>' : `${w.quantity} together, within your ${money(w.priceMax)} limit`)
    : `${money(l.price - w.priceMax)} over your ${money(w.priceMax)} limit${l.unassigned ? ' &middot; exact seats not assigned yet' : ''}`;
  const buy = l.link ? `<a class="buy" href="${esc(l.link)}" target="_blank" rel="noopener noreferrer">Buy &rarr;</a>` : '<span></span>';
  return `<article class="find${hit ? ' hit' : ''}"><span class="pill">${hit ? 'Match' : 'Closest'}</span>
<div><p class="seat">${where} &middot; <b>${money(l.price)}</b> <span class="ea">all-in, each</span></p><p class="why">${why}</p></div>${buy}</article>`;
}

export function criteriaHtml(w) {
  const where = w.sections ? `sections ${w.sections.map(esc).join(', ')}` : 'any section';
  const rows = w.rowMax !== undefined ? ` &middot; rows 1&ndash;${esc(w.rowMax)}` : '';
  return `${esc(w.quantity)} seats together &middot; ${where}${rows} &middot; ${money(w.priceMax)} or less each`;
}

// view: { result (last successful check or null), state, others: [{title, href}] }
export function renderPage(w, { result, state, others, shownMatches = 10 }) {
  const failing = state?.lastFailure && (!state.lastSuccessISO || state.lastFailure.whenISO > state.lastSuccessISO);
  const banner = failing
    ? `<div class="alert">The latest check failed at <b>${esc(fmt(state.lastFailure.whenISO))}</b>: ${esc(state.lastFailure.reason)}.${result ? ` Showing the last successful check from <b>${esc(result.when)}</b>.` : ''}</div>`
    : '';
  const meta = result
    ? `Last successful check <b>${esc(result.when)}</b> &middot; <b>${Number(result.listings).toLocaleString('en-US')}</b> listings for ${esc(w.quantity)} together &middot; checks every 30 minutes`
    : 'No successful check yet.';
  const matches = result?.matches ?? [];
  const body = result
    ? (matches.length
        ? matches.slice(0, shownMatches).map((l) => card(l, w, true)).join('\n')
          + (matches.length > shownMatches ? `<div class="none">…and ${matches.length - shownMatches} more listings fit.</div>` : '')
        : '<div class="none">Nothing fits right now. Cheapest that fit everything except price:</div>')
      + '\n' + (result.closest ?? []).map((l) => card(l, w, false)).join('\n')
    : '';
  const nav = others.length ? `<nav>Also watching: ${others.map((o) => `<a href="${esc(o.href)}">${esc(o.title)}</a>`).join(' &middot; ')}</nav>` : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(w.title)} Seat Watch</title>
<style>:root{--g:#203731;--gold:#FFB612;--bg:#ECEFE9;--s:#fff;--ink:#16241E;--ink2:#3D4F47;--rule:#CBD4C8;--hit:#1B6A4A;--near:#94480F;--nearbg:#F7E4CE;--hitbg:#D8EBE0;--bad:#8A1C1C;--badbg:#F6DADA}
@media(prefers-color-scheme:dark){:root{--bg:#101B16;--s:#1A2A23;--ink:#E9EFE9;--ink2:#AFBFB6;--rule:#2B3B33;--hit:#6FD3A0;--near:#EFA167;--nearbg:#352113;--hitbg:#153126;--bad:#F2A3A3;--badbg:#3A1717}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif}
header{background:var(--g);color:#F2F5F0;padding:28px 0;border-bottom:5px solid var(--gold)}
h1{margin:0;font-size:2rem;letter-spacing:-.01em}
.hd,.meta,.crit,.wrap,nav,.alertwrap{max-width:900px;margin:0 auto;padding-left:24px;padding-right:24px}
.sub{color:var(--gold);font-size:.8rem;letter-spacing:.15em;text-transform:uppercase;margin-top:6px}
.meta{padding-top:18px;color:var(--ink2);font-size:.93rem}.crit{padding-top:6px;color:var(--ink2);font-size:.88rem}
.wrap{padding-bottom:40px}
.alert{background:var(--badbg);color:var(--bad);border-radius:3px;padding:12px 16px;margin-top:18px;font-size:.93rem}
.find{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--near);border-radius:3px;padding:14px 18px;margin:10px 0;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}
.find.hit{border-left-color:var(--hit)}.pill{background:var(--nearbg);color:var(--near);font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:2px;white-space:nowrap}
.find.hit .pill{background:var(--hitbg);color:var(--hit)}.seat{margin:0}.ea{color:var(--ink2);font-size:.85rem;font-weight:400}
.why{margin:2px 0 0;color:var(--ink2);font-size:.88rem}.buy{background:var(--gold);color:#203731;text-decoration:none;font-weight:700;font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;padding:7px 13px;border-radius:2px;white-space:nowrap}
.none{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--rule);border-radius:3px;padding:14px 18px;color:var(--ink2);margin:14px 0 4px}
nav{padding-bottom:32px;font-size:.88rem;color:var(--ink2)}nav a{color:var(--ink2)}
@media(max-width:620px){.find{grid-template-columns:1fr}}</style></head><body>
<header><div class="hd"><h1>${esc(w.title)}</h1><div class="sub">${esc(w.subtitle)}</div></div></header>
${banner ? `<div class="alertwrap">${banner}</div>` : ''}
<p class="meta">${meta}</p>
<p class="crit">Watching for: ${criteriaHtml(w)}</p>
<div class="wrap">
${body}
</div>
${nav}
</body></html>
`;
}

export function fmt(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET';
}
