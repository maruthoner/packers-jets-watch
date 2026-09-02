import { chromium } from 'playwright';

const URL = 'https://ticketwhiz.com/events/new-york-jets-vs-green-bay-packers-tickets-09-20-2026-9c5760f98b8648c2a1c13572c2611882';

const FIND = `(() => {
  function fiberOf(el){for(const k in el){if(k.startsWith('__reactFiber$'))return el[k];}return null;}
  const el = document.getElementById('scrollable-ticket-list') || document.body;
  let node = fiberOf(el), seen = new Set(), best = null, depth = 0;
  const ok = v => Array.isArray(v) && v.length > 20 && v[0] && typeof v[0] === 'object' && 'tgPrice' in v[0];
  while (node && depth < 80) {
    [node.memoizedProps, node.memoizedState, node.pendingProps].forEach(bag => {
      if (!bag || typeof bag !== 'object') return;
      const st = [[bag, 0]];
      while (st.length) {
        const [o, d] = st.pop();
        if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) continue;
        seen.add(o);
        if (ok(o)) { if (!best || o.length > best.length) best = o; continue; }
        for (const k in o) { try { const v = o[k]; if (v && typeof v === 'object') st.push([v, d + 1]); } catch (e) {} }
      }
    });
    node = node.return; depth++;
  }
  return best ? best.length : 0;
})()`;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 900 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
});
const page = await ctx.newPage();

let status = 'unknown';
try {
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  status = resp ? resp.status() : 'no-response';
} catch (e) {
  console.log('NAVIGATION FAILED:', e.message);
  await browser.close();
  process.exit(1);
}

const title = await page.title();
const bodyStart = (await page.evaluate(() => document.body.innerText.slice(0, 300))) || '';
const blocked = /just a moment|attention required|verify you are human|access denied|cf-browser-verification/i.test(title + ' ' + bodyStart);

console.log('HTTP status :', status);
console.log('Page title  :', title);
console.log('Blocked?    :', blocked ? 'YES — Cloudflare challenge' : 'no challenge detected');

let counts = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(15000);
  const n = await page.evaluate(FIND);
  counts.push(n);
  console.log(`  +${(i + 1) * 15}s  listings: ${n}`);
  if (n >= 8000 && counts.length >= 3 && counts.at(-1) === counts.at(-2) && counts.at(-2) === counts.at(-3)) break;
}

const final = counts.at(-1) || 0;
console.log('FINAL COUNT :', final);
console.log(final >= 8000 ? 'RESULT: PASS — datacenter IP can read the full market' : 'RESULT: FAIL — blocked or incomplete');

await browser.close();
process.exit(final >= 8000 ? 0 : 1);
