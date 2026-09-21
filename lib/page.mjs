// Pure status page rendering. The venue map is passed in already loaded so this
// module stays free of file IO.
import { renderMap, MAP_CSS } from './map.mjs';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => `$${n.toFixed(2)}`;

function card(l, w, hit, limit = w.priceMax) {
  const where = `${esc(l.secLabel || 'Section not assigned')} &middot; Row ${esc(l.rowLabel || 'not assigned')}`;
  const why = hit
    ? (l.unassigned ? 'Fits your price — <b>exact seats not assigned yet</b>' : `${w.quantity} together, within your ${money(limit)} limit`)
    : `${money(l.price - limit)} over your ${money(limit)} limit${l.unassigned ? ' &middot; exact seats not assigned yet' : ''}`;
  const buy = l.link ? `<a class="buy" href="${esc(l.link)}" target="_blank" rel="noopener noreferrer">Buy &rarr;</a>` : '<span></span>';
  return `<article class="find${hit ? ' hit' : ''}"><span class="pill">${hit ? 'Match' : 'Closest'}</span>
<div><p class="seat">${where} &middot; <b>${money(l.price)}</b></p><p class="why">${why}</p></div>${buy}</article>`;
}

export function criteriaHtml(w, { sections = w.sections, rowMax = w.rowMax, rowMin = w.rowMin, priceMax = w.priceMax, excluding = null } = {}) {
  const where = sections ? `sections ${sections.map(esc).join(', ')}` : (excluding ? 'any other section' : 'any section');
  const rows = rowsHtml(rowMin, rowMax);
  // The quantity is already in the "last successful check" line at the top (Ruth, Sep 19).
  return `${where}${rows} &middot; ${money(priceMax)} or less each`;
}

const upperFirst = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function rowsHtml(rowMin, rowMax) {
  if (rowMin === undefined && rowMax === undefined) return ' &middot; any row';
  if (rowMax === 1 && rowMin === undefined) return ' &middot; row 1 only';
  if (rowMin === 2 && rowMax === undefined) return ' &middot; any row except row 1';
  if (rowMin !== undefined && rowMax !== undefined) return ` &middot; rows ${esc(rowMin)}&ndash;${esc(rowMax)}`;
  if (rowMin !== undefined) return ` &middot; row ${esc(rowMin)} or higher`;
  return ` &middot; rows 1&ndash;${esc(rowMax)}`;
}

// A count of each kind, in place of the old sentence (Ruth, Sep 20). It shows in
// both states: the run of the play is as worth saying when something fits as when
// nothing does.
function tally(matches, closest) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`;
  return `<div class="tally"><b${matches.length ? ' class="good"' : ''}>${plural(matches.length, 'exact match')}</b>`
    + ` &middot; ${plural(closest.length, 'close match')}</div>`;
}

function listHtml(w, matches, closest, { limit, shown }) {
  const hits = matches.slice(0, shown).map((l) => card(l, w, true, limit)).join('\n')
    + (matches.length > shown ? `<div class="none">…and ${matches.length - shown} more listings fit.</div>` : '');
  return tally(matches, closest) + '\n' + hits + '\n' + closest.map((l) => card(l, w, false, limit)).join('\n');
}

// view: { result (last successful check or null), state, others: [{title, href}] }
export function renderPage(w, { result, state, others, venue = null, shownMatches = 10 }) {
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
  let body = '';
  for (const list of result?.lists ?? []) {
    body += `<h2>${esc(list.label)}</h2>
<p class="crit">${upperFirst(criteriaHtml(w, { sections: list.sections, rowMax: list.rowMax, rowMin: list.rowMin, priceMax: list.priceMax }))}</p>
${listHtml(w, list.matches, list.closest, { limit: list.priceMax, shown: shownMatches })}
`;
  }
  if (result?.lists?.length && w.otherSections !== false) {
    body += `<h2>Other sections</h2>\n<p class="crit">${criteriaHtml(w, { sections: null, rowMax: undefined, rowMin: undefined, excluding: true })}</p>\n`;
  }
  if (result && w.otherSections !== false) {
    body += listHtml(w, result.matches ?? [], result.closest ?? [], {
      limit: w.priceMax, shown: shownMatches,
    });
  }
  const map = venue && result
    ? renderMap(venue, { prices: result.sectionPrices ?? {}, priceMax: w.priceMax, quantity: w.quantity })
    : '';
  const notes = w.notes?.length
    ? `<h2>Notes</h2>
<dl class="notes">${w.notes.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`
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
.wrap{padding-bottom:40px}h2{font-size:1.15rem;margin:28px 0 2px;letter-spacing:-.005em}.wrap .crit{padding:0 0 6px;max-width:none}
.alert{background:var(--badbg);color:var(--bad);border-radius:3px;padding:12px 16px;margin-top:18px;font-size:.93rem}.alert.soft{background:var(--nearbg);color:var(--near)}
.find{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--near);border-radius:3px;padding:14px 18px;margin:10px 0;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}
.find.hit{border-left-color:var(--hit)}.pill{background:var(--nearbg);color:var(--near);font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:2px;white-space:nowrap}
.find.hit .pill{background:var(--hitbg);color:var(--hit)}.seat{margin:0}
.why{margin:2px 0 0;color:var(--ink2);font-size:.88rem}.buy{background:var(--gold);color:#203731;text-decoration:none;font-weight:700;font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;padding:7px 13px;border-radius:2px;white-space:nowrap}
.tally{background:var(--s);border:1px solid var(--rule);border-radius:3px;padding:12px 18px;margin:14px 0 4px;font-size:.95rem;color:var(--ink2)}
.tally b{font-weight:700;color:var(--ink)}.tally b.good{color:var(--hit)}
.none{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--rule);border-radius:3px;padding:14px 18px;color:var(--ink2);margin:14px 0 4px}
nav{padding-bottom:32px;font-size:.88rem;color:var(--ink2)}nav a{color:var(--ink2)}
dl.notes{margin:10px 0 0;background:var(--s);border:1px solid var(--rule);border-radius:3px;padding:16px 18px}
dl.notes dt{font-weight:700;font-size:.9rem}dl.notes dd{margin:2px 0 12px;color:var(--ink2);font-size:.9rem}
dl.notes dd:last-child{margin-bottom:0}
@media(max-width:620px){.find{grid-template-columns:1fr}}
${MAP_CSS}</style></head><body>
<header><div class="hd"><h1>${esc(w.title)}</h1><div class="sub">${esc(w.subtitle)}</div></div></header>
${banner || missing ? `<div class="alertwrap">${banner}${missing}</div>` : ''}
<p class="meta">${meta}</p>
<div class="wrap">
${body}
${map}
${notes}
</div>
${nav}
</body></html>
`;
}

export function fmt(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET';
}
