// Usage: node watch.mjs <watcher-id> <out.json>
// Reads one game's full TicketWhiz market from the page's own React state and writes
// the raw listings plus the readiness evidence. Makes no decisions. Exits non-zero with
// {ok:false, reason} when a trustworthy read was not possible.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { WATCHERS } from './watchers.mjs';
import { isReady, notReadyReason, sameMarket } from './lib/ready.mjs';

const [id, outFile] = process.argv.slice(2);
const W = WATCHERS[id];
if (!W || !outFile) {
  console.error(`usage: node watch.mjs <${Object.keys(WATCHERS).join('|')}> <out.json>`);
  process.exit(2);
}

const POLL_MS = 3000;
const READY_DEADLINE_MS = 150000;

// Runs inside the page. One function so a sample and its raw data come from the same instant.
function snapshotInPage({ quantity, withRaw }) {
  const fiberOf = (el) => { for (const k in el) if (k.startsWith('__reactFiber$')) return el[k]; return null; };

  // The listings array: the largest array of objects carrying tgAllInPrice.
  const list = (() => {
    const el = document.getElementById('scrollable-ticket-list') || document.body;
    let node = fiberOf(el), best = null, depth = 0;
    const seen = new Set();
    const ok = (v) => Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object' && 'tgAllInPrice' in v[0];
    while (node && depth < 80) {
      for (const bag of [node.memoizedProps, node.memoizedState, node.pendingProps]) {
        if (!bag || typeof bag !== 'object') continue;
        const stack = [[bag, 0]];
        while (stack.length) {
          const [o, d] = stack.pop();
          if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) continue;
          seen.add(o);
          if (ok(o)) { if (!best || o.length > best.length) best = o; continue; }
          for (const k in o) { try { const v = o[k]; if (v && typeof v === 'object') stack.push([v, d + 1]); } catch { /* getters */ } }
        }
      }
      node = node.return; depth++;
    }
    return best || [];
  })();

  const labelEl = [...document.querySelectorAll('span')].find((e) => /^(live prices|refreshing marketplaces)$/i.test((e.textContent || '').trim()));
  const qtyBtn = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && /^\s*\d+\s*Seats?\s*$/.test(b.innerText || ''));
  const names = ['vividseats', 'gametime', 'seatgeek', 'viagogo', 'stubhub', 'ticketnetwork', 'megaseats', 'event365', 'ticketmaster', 'tickpick', 'axs'];
  const sources = new Set();
  let unsellable = 0;
  for (const t of list) {
    const tid = String(t.tgID || '').toLowerCase();
    sources.add(names.find((n) => tid.endsWith(n)) || 'other');
    if (!(Array.isArray(t.splits) && t.splits.map(Number).includes(quantity))) unsellable++;
  }
  const sample = {
    label: labelEl ? labelEl.textContent.trim() : null,
    qtyText: qtyBtn ? qtyBtn.innerText.trim() : null,
    n: list.length,
    sources: [...sources].sort(),
    unsellable,
  };
  if (!withRaw) return { sample };
  return {
    sample,
    raw: list.map((t) => ({
      id: t.tgID, secLabel: t.tgUserSec || t.tgCanonSec || '', rowLabel: t.tgUserRow || '',
      allIn: t.tgAllInPrice, splits: t.splits, link: t.tgCheckoutParams || '',
    })),
  };
}

// TicketWhiz filters quantity on its server, so the page's own selector must be set.
// Its trigger is a Radix popover that opens on pointer-down; Playwright's click sends
// real pointer events, which a plain DOM .click() does not.
async function setQuantity(page, qty) {
  const trigger = page.locator('button').filter({ hasText: /^\s*\d+\s*Seats?\s*$/ }).locator('visible=true').first();
  await trigger.waitFor({ timeout: 30000 });
  if (new RegExp(`^${qty} Seats?$`).test((await trigger.innerText()).trim())) return;
  await trigger.click();
  const option = page.locator('[role=dialog] button, [data-radix-popper-content-wrapper] button')
    .filter({ hasText: new RegExp(`^\\s*${qty}\\s*$`) }).locator('visible=true').first();
  await option.waitFor({ timeout: 15000 });
  await option.click();
  await page.keyboard.press('Escape').catch(() => {});
}

const finish = (payload, code) => {
  writeFileSync(outFile, JSON.stringify({ watcher: W.id, whenISO: new Date().toISOString(), ...payload }));
  process.exit(code);
};

let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York',
  });
  const page = await ctx.newPage();
  const resp = await page.goto(W.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (resp && resp.status() >= 400) throw new Error(`page returned HTTP ${resp.status()}`);
  await setQuantity(page, W.quantity);

  const started = Date.now();
  let prev = null, cur = null;
  while (Date.now() - started < READY_DEADLINE_MS) {
    await page.waitForTimeout(POLL_MS);
    cur = (await page.evaluate(snapshotInPage, { quantity: W.quantity, withRaw: false })).sample;
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`  [${W.id}] +${secs}s n=${cur.n} ${cur.label ?? '-'} qty=${cur.qtyText ?? '-'} sources=${cur.sources.length} unsellable=${cur.unsellable}`);
    if (isReady(prev, cur, W.quantity)) {
      const snap = await page.evaluate(snapshotInPage, { quantity: W.quantity, withRaw: true });
      if (notReadyReason(snap.sample, W.quantity) === null && sameMarket(cur, snap.sample)) {
        await browser.close();
        console.log(`  [${W.id}] ready after ${secs}s: ${snap.raw.length} listings from ${snap.sample.sources.join(', ')}`);
        finish({ ok: true, sample: snap.sample, raw: snap.raw, readySeconds: secs }, 0);
      }
      cur = snap.sample; // market moved between the two reads; keep polling
    }
    prev = cur;
  }
  throw new Error(`page never settled within ${READY_DEADLINE_MS / 1000}s — last state: ${notReadyReason(cur, W.quantity) ?? 'market still changing'}`);
} catch (e) {
  if (browser) await browser.close().catch(() => {});
  finish({ ok: false, reason: String(e.message || e).split('\n')[0] }, 1);
}
