import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';

const URL = 'https://ticketwhiz.com/events/new-york-jets-vs-green-bay-packers-tickets-09-20-2026-9c5760f98b8648c2a1c13572c2611882';

const TARGETS = [
  { id: 'A', label: 'Lower bowl · Packers sideline', secs: [135,137,139,140,142], rowMax: 20, priceMax: 360,
    near: { rowMax: 25, priceMax: 430 } },
  { id: 'B', label: 'Upper deck · Packers sideline', secs: [337,338,339,340], rowMax: 1, priceMax: 250,
    near: { rowMax: 4, priceMax: 300 } },
  { id: 'C', label: 'Upper deck · Jets sideline', secs: [311,312,313,314,315,316], rowMax: 1, priceMax: 149.99,
    near: { rowMax: 4, priceMax: 180 } },
];

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
  const rows = best.map(t => {
    const s = String(t.tgUserSec||'').match(/(\\d{3})/);
    const r = String(t.tgUserRow||'').match(/^(\\d+)$/);
    return s && r ? { sec:+s[1], row:+r[1], price:t.tgPrice, qty:t.tgQty, link:String(t.tgCheckoutParams||'') } : null;
  }).filter(Boolean);
  return { n: best.length, rows };
})()`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York',
});
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

let data = { n: 0, rows: [] }, counts = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(15000);
  data = await page.evaluate(EXTRACT);
  counts.push(data.n);
  console.log(`  +${(i+1)*15}s  ${data.n}`);
  const c = counts;
  if (data.n >= 8000 && c.length >= 3 && c.at(-1) === c.at(-2) && c.at(-2) === c.at(-3)) break;
}
await browser.close();

if (data.n < 8000) {
  console.log(`FAILED: only ${data.n} listings — load incomplete or blocked`);
  writeFileSync('result.json', JSON.stringify({ ok:false, n:data.n, when:new Date().toISOString() }, null, 2));
  process.exit(1);
}

const pick = (t, bounds) => data.rows
  .filter(r => t.secs.includes(r.sec) && r.row <= bounds.rowMax && r.price <= bounds.priceMax)
  .sort((a,b) => a.price - b.price);

const matches = [], nears = [];
for (const t of TARGETS) {
  for (const r of pick(t, t).slice(0, 3)) matches.push({ ...r, target: t.id, label: t.label });
  for (const r of pick(t, t.near).slice(0, 2)) {
    if (!matches.some(m => m.sec===r.sec && m.row===r.row && m.price===r.price)) nears.push({ ...r, target: t.id, label: t.label });
  }
}

const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle:'medium', timeStyle:'short' });
const result = { ok:true, when, whenISO:new Date().toISOString(), listings:data.n, matches, nears };
writeFileSync('result.json', JSON.stringify(result, null, 2));

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const card = (r, hit) => `<article class="find${hit?' hit':''}"><span class="pill">${hit?'Match':'Near miss'}</span>
<div><p class="seat">Section ${r.sec} &middot; Row ${r.row} &middot; <b>$${r.price.toFixed(2)}</b> <span class="ea">all-in, each &middot; Target ${r.target}</span></p>
<p class="why">${esc(r.label)}</p></div>
<a class="buy" href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">Buy &rarr;</a></article>`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Packers Jets Seat Watch</title>
<style>:root{--g:#203731;--gold:#FFB612;--bg:#ECEFE9;--s:#fff;--ink:#16241E;--ink2:#3D4F47;--rule:#CBD4C8;--hit:#1B6A4A;--near:#94480F;--nearbg:#F7E4CE;--hitbg:#D8EBE0}
@media(prefers-color-scheme:dark){:root{--bg:#101B16;--s:#1A2A23;--ink:#E9EFE9;--ink2:#AFBFB6;--rule:#2B3B33;--hit:#6FD3A0;--near:#EFA167;--nearbg:#352113;--hitbg:#153126}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,sans-serif}
header{background:var(--g);color:#F2F5F0;padding:28px 24px;border-bottom:5px solid var(--gold)}
h1{margin:0;font-size:2rem;letter-spacing:-.01em}.meta{max-width:900px;margin:0 auto;padding:20px 24px 0;color:var(--ink2);font-size:.93rem}
.wrap{max-width:900px;margin:0 auto;padding:0 24px 48px}.hd{max-width:900px;margin:0 auto}
.find{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--near);border-radius:3px;padding:14px 18px;margin:10px 0;display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center}
.find.hit{border-left-color:var(--hit)}.pill{background:var(--nearbg);color:var(--near);font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:2px;white-space:nowrap}
.find.hit .pill{background:var(--hitbg);color:var(--hit)}.seat{margin:0}.ea{color:var(--ink2);font-size:.85rem;font-weight:400}
.why{margin:2px 0 0;color:var(--ink2);font-size:.88rem}.buy{background:var(--gold);color:#203731;text-decoration:none;font-weight:700;font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;padding:7px 13px;border-radius:2px;white-space:nowrap}
.none{background:var(--s);border:1px solid var(--rule);border-left:4px solid var(--rule);border-radius:3px;padding:14px 18px;color:var(--ink2)}
@media(max-width:620px){.find{grid-template-columns:1fr}}</style></head><body>
<header><div class="hd"><h1>Packers at Jets</h1><div style="color:var(--gold);font-size:.8rem;letter-spacing:.15em;text-transform:uppercase;margin-top:6px">Sun Sep 20 &middot; 1:00 PM &middot; MetLife Stadium</div></div></header>
<p class="meta">Last check <b>${esc(when)}</b> &middot; <b>${data.n.toLocaleString()}</b> listings read &middot; running on GitHub Actions</p>
<div class="wrap">
${matches.length ? matches.map(r=>card(r,true)).join('\n') : '<div class="none">No exact match this check.</div>'}
${nears.map(r=>card(r,false)).join('\n')}
</div></body></html>`);

console.log(`\nlistings: ${data.n}  matches: ${matches.length}  near misses: ${nears.length}`);
for (const m of matches) console.log(`MATCH  Target ${m.target}  Sec ${m.sec} Row ${m.row}  $${m.price}`);
for (const n of nears) console.log(`near   Target ${n.target}  Sec ${n.sec} Row ${n.row}  $${n.price}`);
