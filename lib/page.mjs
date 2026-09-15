// Pure status page rendering.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => `$${n.toFixed(2)}`;

function card(l, w, hit, limit = w.priceMax) {
  const where = `${esc(l.secLabel || 'Section not assigned')} &middot; Row ${esc(l.rowLabel || 'not assigned')}`;
  const why = hit
    ? (l.unassigned ? 'Fits your price — <b>exact seats not assigned yet</b>' : `${w.quantity} together, within your ${money(limit)} limit`)
    : `${money(l.price - limit)} over your ${money(limit)} limit${l.unassigned ? ' &middot; exact seats not assigned yet' : ''}`;
  const buy = l.link ? `<a class="buy" href="${esc(l.link)}" target="_blank" rel="noopener noreferrer">Buy &rarr;</a>` : '<span></span>';
  return `<article class="find${hit ? ' hit' : ''}"><span class="pill">${hit ? 'Match' : 'Closest'}</span>
<div><p class="seat">${where} &middot; <b>${money(l.price)}</b> <span class="ea">all-in, each</span></p><p class="why">${why}</p></div>${buy}</article>`;
}

export function criteriaHtml(w, { sections = w.sections, rowMax = w.rowMax, priceMax = w.priceMax, excluding = null } = {}) {
  const where = sections ? `sections ${sections.map(esc).join(', ')}` : (excluding ? 'any other section' : 'any section');
  const rows = rowMax !== undefined ? ` &middot; rows 1&ndash;${esc(rowMax)}` : ' &middot; any row';
  return `${esc(w.quantity)} seats together &middot; ${where}${rows} &middot; ${money(priceMax)} or less each`;
}

function listHtml(w, matches, closest, { limit, shown, emptyText }) {
  const hits = matches.length
    ? matches.slice(0, shown).map((l) => card(l, w, true, limit)).join('\n')
      + (matches.length > shown ? `<div class="none">…and ${matches.length - shown} more listings fit.</div>` : '')
    : `<div class="none">${emptyText}</div>`;
  return hits + '\n' + closest.map((l) => card(l, w, false, limit)).join('\n');
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
  const missing = result?.missing?.length
    ? `<div class="alert soft">Not included in this check: <b>${result.missing.map((m) => esc(m.site)).join(', ')}</b> — TicketWhiz could not get ${result.missing.length === 1 ? 'its' : 'their'} listings after 3 tries (${result.missing.map((m) => esc(m.why)).join('; ')}). Seats listed only there were not checked.</div>`
    : '';
  const alertsOn = w.preferred && w.alertOn !== 'general' ? 'preferred' : 'general';
  let body = '';
  if (result && w.preferred) {
    const p = result.preferred ?? { matches: [], closest: [], priceMax: w.preferred.priceMax ?? w.priceMax };
    body += `<h2>Preferred sections${alertsOn === 'preferred' ? ' <span class="tag">email alerts</span>' : ''}</h2>
<p class="crit">${criteriaHtml(w, { sections: w.preferred.sections, rowMax: w.preferred.rowMax, priceMax: p.priceMax })}</p>
${listHtml(w, p.matches, p.closest, { limit: p.priceMax, shown: shownMatches, emptyText: 'No pair in your preferred sections at this price right now. Cheapest there:' })}
<h2>Any other section${alertsOn === 'general' ? ' <span class="tag">email alerts</span>' : ' <span class="tag quiet">page only</span>'}</h2>
<p class="crit">${criteriaHtml(w, { sections: null, excluding: true })}</p>
`;
  }
  if (result) {
    body += listHtml(w, result.matches ?? [], result.closest ?? [], {
      limit: w.priceMax, shown: shownMatches,
      emptyText: 'Nothing fits right now. Cheapest that fit everything except price:',
    });
  }
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
.wrap{padding-bottom:40px}h2{font-size:1.15rem;margin:28px 0 2px;letter-spacing:-.005em}.wrap .crit{padding:0 0 6px;max-width:none}.tag{font-size:.68rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:var(--hitbg);color:var(--hit);padding:3px 8px;border-radius:2px;vertical-align:middle;margin-left:6px}.tag.quiet{background:var(--rule);color:var(--ink2)}
.alert{background:var(--badbg);color:var(--bad);border-radius:3px;padding:12px 16px;margin-top:18px;font-size:.93rem}.alert.soft{background:var(--nearbg);color:var(--near)}
.find{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--near);border-radius:3px;padding:14px 18px;margin:10px 0;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}
.find.hit{border-left-color:var(--hit)}.pill{background:var(--nearbg);color:var(--near);font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:2px;white-space:nowrap}
.find.hit .pill{background:var(--hitbg);color:var(--hit)}.seat{margin:0}.ea{color:var(--ink2);font-size:.85rem;font-weight:400}
.why{margin:2px 0 0;color:var(--ink2);font-size:.88rem}.buy{background:var(--gold);color:#203731;text-decoration:none;font-weight:700;font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;padding:7px 13px;border-radius:2px;white-space:nowrap}
.none{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--rule);border-radius:3px;padding:14px 18px;color:var(--ink2);margin:14px 0 4px}
nav{padding-bottom:32px;font-size:.88rem;color:var(--ink2)}nav a{color:var(--ink2)}
@media(max-width:620px){.find{grid-template-columns:1fr}}</style></head><body>
<header><div class="hd"><h1>${esc(w.title)}</h1><div class="sub">${esc(w.subtitle)}</div></div></header>
${banner || missing ? `<div class="alertwrap">${banner}${missing}</div>` : ''}
<p class="meta">${meta}</p>
${w.preferred ? '' : `<p class="crit">Watching for: ${criteriaHtml(w)}</p>`}
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
