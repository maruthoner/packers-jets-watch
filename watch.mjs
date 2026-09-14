// Usage: node watch.mjs <watcher-id>
// Reads the full TicketWhiz market from React state for one game, decides matches,
// and writes that game's result JSON and status page. Exits non-zero when the read
// cannot be trusted, so the caller reports a broken check instead of "no match".
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { WATCHERS } from './watchers.mjs';

const W = WATCHERS[process.argv[2]];
if (!W) { console.error(`unknown watcher "${process.argv[2]}"; known: ${Object.keys(WATCHERS).join(', ')}`); process.exit(2); }

const EXTRACT = `(() => {
  function fiberOf(el){for(const k in el){if(k.startsWith('__reactFiber$'))return el[k];}return null;}
  const el = document.getElementById('scrollable-ticket-list') || document.body;
  let node = fiberOf(el), seen = new Set(), best = null, depth = 0;
  const ok = v => Array.isArray(v) && v.length > 20 && v[0] && typeof v[0]==='object' && 'tgPrice' in v[0];
  while (node && depth < 80) {
    [node.memoizedProps, node.memoizedState, node.pendingProps].forEach(bag => {
      if (!bag || typeof bag !== 'object') return;
      const st = [[bag,0]];
      while (st.length) {
        const [o,d] = st.pop();
        if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) continue;
        seen.add(o);
        if (ok(o)) { if (!best || o.length > best.length) best = o; continue; }
        for (const k in o) { try { const v = o[k]; if (v && typeof v==='object') st.push([v,d+1]); } catch(e){} }
      }
    });
    node = node.return; depth++;
  }
  if (!best) return { n: 0, rows: [] };
  return { n: best.length, rows: best.map(t => ({
    secLabel: String(t.tgUserSec || t.tgCanonSec || ''),
    rowLabel: String(t.tgUserRow || ''),
    price: t.tgPrice,
    splits: Array.isArray(t.splits) ? t.splits : [],
    link: String(t.tgCheckoutParams || ''),
  })) };
})()`;

// TicketWhiz filters quantity on its server, so the page's own selector must be set.
// Its trigger is a Radix popover that opens on pointer-down; Playwright's click sends
// real pointer events, which a plain DOM .click() does not.
async function ensureQuantity(page, qty) {
  const trigger = page.locator('button').filter({ hasText: /^\s*\d+\s*Seats?\s*$/ }).locator('visible=true').first();
  await trigger.waitFor({ timeout: 30000 });
  const current = (await trigger.innerText()).trim();
  if (current === `${qty} Seats` || current === `${qty} Seat`) return current;
  await trigger.click();
  const option = page.locator('[role=dialog] button, [data-radix-popper-content-wrapper] button')
    .filter({ hasText: new RegExp(`^\\s*${qty}\\s*$`) }).locator('visible=true').first();
  await option.waitFor({ timeout: 15000 });
  await option.click();
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(2000);
  return (await trigger.innerText()).trim();
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York',
});
const page = await ctx.newPage();
const fail = async (msg) => {
  console.log(`FAILED [${W.id}]: ${msg}`);
  writeFileSync(W.resultFile, JSON.stringify({ ok: false, watcher: W.id, reason: msg, whenISO: new Date().toISOString() }, null, 2));
  await browser.close();
  process.exit(1);
};

await page.goto(W.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

let control;
try { control = await ensureQuantity(page, W.quantity); }
catch (e) { await fail(`could not set the seat selector to ${W.quantity}: ${e.message}`); }
if (!new RegExp(`^${W.quantity} Seats?$`).test(control)) await fail(`seat selector reads "${control}", expected ${W.quantity}`);
console.log(`  [${W.id}] seat selector: ${control}`);

let data = { n: 0, rows: [] }, counts = [];
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(15000);
  data = await page.evaluate(EXTRACT);
  counts.push(data.n);
  console.log(`  [${W.id}] +${(i + 1) * 15}s  ${data.n}`);
  const c = counts;
  if (data.n >= W.minListings && c.length >= 3 && c.at(-1) === c.at(-2) && c.at(-2) === c.at(-3)) break;
}
await browser.close();

if (data.n < W.minListings) await fail(`only ${data.n} listings (floor ${W.minListings}) — load incomplete or blocked`);

// Proof the quantity filter really applied: every listing must be sellable in this quantity.
const wrongQty = data.rows.filter(r => !r.splits.includes(W.quantity)).length;
if (wrongQty > 0) await fail(`${wrongQty} of ${data.n} listings cannot sell ${W.quantity} — quantity filter did not apply`);

const num = s => { const m = String(s).match(/(\d{3})/); return m ? +m[1] : null; };
const rowNum = s => (/^\d+$/.test(String(s)) ? +s : null);
const rows = data.rows.map(r => ({ ...r, sec: num(r.secLabel), row: rowNum(r.rowLabel) }));

let matches = [], nears = [];
if (W.anySeat) {
  const sorted = rows.slice().sort((a, b) => a.price - b.price);
  matches = sorted.filter(r => r.price <= W.priceMax).slice(0, 5).map(r => ({ ...r, target: 'Any', label: `Any section · ${W.quantity} together` }));
  nears = sorted.filter(r => r.price > W.priceMax).slice(0, W.closest || 3).map(r => ({ ...r, target: 'Any', label: `Cheapest ${W.quantity} together` }));
} else {
  const pick = (t, b) => rows
    .filter(r => r.sec !== null && r.row !== null && t.secs.includes(r.sec) && r.row <= b.rowMax && r.price <= b.priceMax)
    .sort((a, b2) => a.price - b2.price);
  for (const t of W.targets) {
    for (const r of pick(t, t).slice(0, 3)) matches.push({ ...r, target: t.id, label: t.label });
    for (const r of pick(t, t.near).slice(0, 2)) {
      if (!matches.some(m => m.secLabel === r.secLabel && m.rowLabel === r.rowLabel && m.price === r.price)) nears.push({ ...r, target: t.id, label: t.label });
    }
  }
}

const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
writeFileSync(W.resultFile, JSON.stringify({
  ok: true, watcher: W.id, title: W.title, alertLabel: W.alertLabel,
  when, whenISO: new Date().toISOString(), quantity: W.quantity,
  listings: data.n, matches, nears,
}, null, 2));

// ---------- status page ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const seatText = r => `${esc(r.secLabel || 'Section ?')} &middot; Row ${esc(r.rowLabel || '?')}`;
const card = (r, hit) => `<article class="find${hit ? ' hit' : ''}"><span class="pill">${hit ? 'Match' : (W.anySeat ? 'Closest' : 'Near miss')}</span>
<div><p class="seat">${seatText(r)} &middot; <b>$${r.price.toFixed(2)}</b> <span class="ea">all-in, each${W.anySeat ? '' : ` &middot; Target ${r.target}`}</span></p>
<p class="why">${esc(r.label)}${W.anySeat && !hit ? ` &mdash; $${(r.price - W.priceMax).toFixed(2)} over your $${W.priceMax} cap` : ''}</p></div>
<a class="buy" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">Buy &rarr;</a></article>`;

// Pages are served from docs/, so docs/falcons/index.html lives at <site>/falcons/.
const sitePath = o => o.outDir.replace(/^docs\/?/, '');            // '' or 'falcons'
const toRoot = '../'.repeat(sitePath(W).split('/').filter(Boolean).length);
const others = Object.values(WATCHERS).filter(o => o.id !== W.id)
  .map(o => `<a href="${toRoot}${sitePath(o) ? sitePath(o) + '/' : ''}">${esc(o.title)}</a>`).join(' &middot; ');

const criteria = W.anySeat
  ? `${W.quantity} seats together &middot; any section &middot; $${W.priceMax} or less each`
  : W.targets.map(t => `<b>${t.id}</b> ${esc(t.label)}`).join(' &middot; ');

mkdirSync(W.outDir, { recursive: true });
writeFileSync(`${W.outDir}/index.html`, `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(W.title)} Seat Watch</title>
<style>:root{--g:#203731;--gold:#FFB612;--bg:#ECEFE9;--s:#fff;--ink:#16241E;--ink2:#3D4F47;--rule:#CBD4C8;--hit:#1B6A4A;--near:#94480F;--nearbg:#F7E4CE;--hitbg:#D8EBE0}
@media(prefers-color-scheme:dark){:root{--bg:#101B16;--s:#1A2A23;--ink:#E9EFE9;--ink2:#AFBFB6;--rule:#2B3B33;--hit:#6FD3A0;--near:#EFA167;--nearbg:#352113;--hitbg:#153126}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif}
header{background:var(--g);color:#F2F5F0;padding:28px 24px;border-bottom:5px solid var(--gold)}
h1{margin:0;font-size:2rem;letter-spacing:-.01em}.hd,.meta,.wrap{max-width:900px;margin:0 auto}
.sub{color:var(--gold);font-size:.8rem;letter-spacing:.15em;text-transform:uppercase;margin-top:6px}
.meta{padding:18px 24px 0;color:var(--ink2);font-size:.93rem}.crit{padding:6px 24px 0;color:var(--ink2);font-size:.88rem}
.wrap{padding:0 24px 40px}
.find{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--near);border-radius:3px;padding:14px 18px;margin:10px 0;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}
.find.hit{border-left-color:var(--hit)}.pill{background:var(--nearbg);color:var(--near);font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:2px;white-space:nowrap}
.find.hit .pill{background:var(--hitbg);color:var(--hit)}.seat{margin:0}.ea{color:var(--ink2);font-size:.85rem;font-weight:400}
.why{margin:2px 0 0;color:var(--ink2);font-size:.88rem}.buy{background:var(--gold);color:#203731;text-decoration:none;font-weight:700;font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;padding:7px 13px;border-radius:2px;white-space:nowrap}
.none{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--rule);border-radius:3px;padding:14px 18px;color:var(--ink2);margin:14px 0 4px}
nav{max-width:900px;margin:0 auto;padding:0 24px 32px;font-size:.88rem;color:var(--ink2)}nav a{color:var(--ink2)}
@media(max-width:620px){.find{grid-template-columns:1fr}}</style></head><body>
<header><div class="hd"><h1>${esc(W.title)}</h1><div class="sub">${esc(W.subtitle)}</div></div></header>
<p class="meta">Last check <b>${esc(when)}</b> &middot; <b>${data.n.toLocaleString()}</b> listings for ${W.quantity} together &middot; checks every 30 minutes</p>
<p class="crit">Watching for: ${criteria}</p>
<div class="wrap">
${matches.length ? matches.map(r => card(r, true)).join('\n') : '<div class="none">No exact match this check.</div>'}
${nears.map(r => card(r, false)).join('\n')}
</div>
${others ? `<nav>Also watching: ${others}</nav>` : ''}
</body></html>`);

console.log(`\n[${W.id}] listings: ${data.n}  matches: ${matches.length}  shown below cap: ${nears.length}`);
for (const m of matches) console.log(`  MATCH  ${m.secLabel} Row ${m.rowLabel}  $${m.price}`);
for (const n of nears) console.log(`  close  ${n.secLabel} Row ${n.rowLabel}  $${n.price}`);
