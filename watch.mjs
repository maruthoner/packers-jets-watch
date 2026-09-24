// Usage: node watch.mjs <watcher-id> <out.json>
// Reads one game's full TicketWhiz market from the page's own React state and writes
// the raw listings plus the readiness evidence. Makes no decisions. Exits non-zero with
// {ok:false, reason} when a trustworthy read was not possible.
//
// Completeness comes from each marketplace's own answer to the page (see lib/ready.mjs).
// A marketplace that fails is retried with a fresh page load; one that still fails after
// the last try is reported in `missing`, so the status page can say what was not checked.
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { WATCHERS } from './watchers.mjs';
import { isReady, notReadyReason, sameMarket, FEED_PATH, feedSite, classifyFeed, feedsPending, feedsFailed, emptyPageReason, summarizeDiagnostics } from './lib/ready.mjs';

const [id, outFile] = process.argv.slice(2);
const W = WATCHERS[id];
if (!W || !outFile) {
  console.error(`usage: node watch.mjs <${Object.keys(WATCHERS).join('|')}> <out.json>`);
  process.exit(2);
}

const POLL_MS = 3000;
const LOAD_ATTEMPTS = 3;
const FEED_WAIT_MS = 60000;
const EMPTY_WAIT_MS = 20000;      // page still empty this long after every marketplace settled
const READY_DEADLINE_MS = 220000; // all attempts together; cycle.mjs kills the process at 300s

// Runs inside the page. One function so a sample and its raw data come from the same instant.
function snapshotInPage({ quantity, withRaw, withDiag }) {
  const fiberOf = (el) => { for (const k in el) if (k.startsWith('__reactFiber$')) return el[k]; return null; };

  // The listings array: the largest array of objects carrying tgAllInPrice.
  const list = (() => {
    const el = document.getElementById('scrollable-ticket-list') || document.body;
    let node = fiberOf(el), best = null, depth = 0;
    const census = [];
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
          if (ok(o)) { census.push(o.length); if (!best || o.length > best.length) best = o; continue; }
          for (const k in o) { try { const v = o[k]; if (v && typeof v === 'object') stack.push([v, d + 1]); } catch { /* getters */ } }
        }
      }
      node = node.return; depth++;
    }
    window.__census = census;
    return best || [];
  })();

  const labelEl = [...document.querySelectorAll('span')].find((e) => /^(live prices|refreshing marketplaces)$/i.test((e.textContent || '').trim()));
  const qtyBtn = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && /^\s*\d+\s*Seats?\s*$/.test(b.innerText || ''));
  // TicketWhiz redesigned the filter bar on Sep 24: the seat selector became a chip
  // showing the bare number instead of a "2 Seats" button. Both are live at once
  // (the runners were still being served the old one). Normalised to the old wording
  // so the readiness checks in ready.mjs keep reading one thing.
  const qtyChip = qtyBtn ? null : [...document.querySelectorAll('button[class*="shrink-0"]')]
    .find((b) => b.offsetParent !== null && /^\s*\d+\s*$/.test(b.innerText || ''));
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
    qtyText: qtyBtn ? qtyBtn.innerText.trim() : (qtyChip ? `${qtyChip.innerText.trim()} Seats` : null),
    n: list.length,
    sources: [...sources].sort(),
    unsellable,
  };
  const diag = withDiag ? (() => {
    const box = document.getElementById('scrollable-ticket-list');
    const text = ((document.querySelector('main') || document.body).innerText || '').replace(/\s+/g, ' ').trim();
    return {
      url: location.href,
      title: document.title,
      listBox: !!box,
      listBoxRows: box ? box.querySelectorAll('*').length : null,
      ticketArrays: (window.__census || []).slice().sort((a, b) => b - a).slice(0, 5),
      pageText: text.slice(0, 600),
    };
  })() : null;
  if (!withRaw) return { sample, diag };
  return {
    sample, diag,
    raw: list.map((t) => ({
      id: t.tgID, secLabel: t.tgUserSec || t.tgCanonSec || '', rowLabel: t.tgUserRow || '',
      allIn: t.tgAllInPrice, splits: t.splits,
      // The checkout URL moved: tgCheckoutParams was empty on all 3,372 listings on
      // Sep 21 while ticket_link carried it, which left the page with no Buy buttons
      // for several hours. Read both, newest-known first (see `linkless` in cycle.mjs,
      // which makes it visible rather than silent if the field moves again).
      link: t.ticket_link || t.tgCheckoutParams || '',
    })),
  };
}

// TicketWhiz filters quantity on its server, so the page's own selector must be set.
// Two designs are in the wild as of Sep 24 and a given page load may serve either:
//   old — a button reading "2 Seats", opening a popover of numbers
//   new — a filter chip plus a row of button.IndvButton numbers 1-12. The chip reads
//         "Seats" until a quantity is chosen and the number afterwards, so it cannot
//         be found by looking for a number; that mistake failed every check at 19:05.
//         The number row is usually already on the page, so it can be clicked
//         directly; the chip opens it when it is not.
// Both designs open on pointer-down, so Playwright's click is required — a DOM
// .click() does nothing.
async function setQuantity(page, qty) {
  const want = String(qty);
  const oldTrigger = page.locator('button').filter({ hasText: /^\s*\d+\s*Seats?\s*$/ }).locator('visible=true').first();
  const chip = page.locator('button[class*="shrink-0"]').filter({ hasText: /^\s*(\d+|Seats?)\s*$/i }).locator('visible=true').first();
  const number = page.locator('button.IndvButton').filter({ hasText: new RegExp(`^\\s*${want}\\s*$`) }).first();
  const chipReads = (n) => [...document.querySelectorAll('button[class*="shrink-0"]')]
    .some((b) => b.offsetParent !== null && (b.innerText || '').trim() === n);

  const deadline = Date.now() + 45000;
  let design = null;
  while (Date.now() < deadline && !design) {
    if (await oldTrigger.count().catch(() => 0)) design = 'old';
    else if (await number.count().catch(() => 0) || await chip.count().catch(() => 0)) design = 'new';
    else await page.waitForTimeout(500);
  }
  if (!design) throw new Error('the seat quantity selector never appeared');

  if (design === 'old') {
    if (new RegExp(`^${want} Seats?$`).test((await oldTrigger.innerText()).trim())) return;
    await oldTrigger.click();
    const option = page.locator('[role=dialog] button, [data-radix-popper-content-wrapper] button')
      .filter({ hasText: new RegExp(`^\\s*${want}\\s*$`) }).locator('visible=true').first();
    await option.waitFor({ timeout: 15000 });
    await option.click();
    await page.keyboard.press('Escape').catch(() => {});
    return;
  }

  if (await chip.count().catch(() => 0) && (await chip.innerText()).trim() === want) return;
  if (!(await number.isVisible().catch(() => false))) {
    await chip.click();
    await number.waitFor({ state: 'visible', timeout: 15000 });
  }
  await number.click();
  await page.keyboard.press('Escape').catch(() => {});
  // Confirm the filter actually took rather than assuming the click landed.
  await page.waitForFunction(chipReads, want, { timeout: 20000 });
}

// Follow every marketplace request the page makes and classify its answer.
function trackFeeds(page) {
  const feeds = {};
  const isFeed = (r) => r.method() === 'GET' && r.url().includes(FEED_PATH) && feedSite(r.url());
  page.on('request', (r) => { if (isFeed(r)) feeds[feedSite(r.url())] = { state: 'pending' }; });
  page.on('requestfailed', (r) => {
    if (isFeed(r)) feeds[feedSite(r.url())] = { state: 'failed', why: r.failure()?.errorText || 'request failed' };
  });
  page.on('response', async (r) => {
    if (!isFeed(r.request())) return;
    const site = feedSite(r.url());
    let body;
    try { body = await r.text(); } catch { feeds[site] = { state: 'failed', why: 'answer cut off' }; return; }
    const c = classifyFeed({ httpStatus: r.status(), body });
    feeds[site] = c.ok ? { state: 'ok', tickets: c.tickets } : { state: 'failed', why: c.why };
  });
  return feeds;
}

const finish = (payload, code) => {
  writeFileSync(outFile, JSON.stringify({ watcher: W.id, whenISO: new Date().toISOString(), ...payload }));
  process.exit(code);
};

// One page load. Resolves { done: {sample, raw, feeds, missing} } or { retry: reason }.
async function attemptRead(ctx, attempt, started) {
  const page = await ctx.newPage();
  const feeds = trackFeeds(page);
  try {
    const resp = await page.goto(W.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (resp && resp.status() >= 400) throw new Error(`page returned HTTP ${resp.status()}`);
    await setQuantity(page, W.quantity);
    const loaded = Date.now();
    let prev = null, cur = null, asked = 0, emptySince = null;
    while (Date.now() - started < READY_DEADLINE_MS) {
      await page.waitForTimeout(POLL_MS);
      cur = (await page.evaluate(snapshotInPage, { quantity: W.quantity, withRaw: false })).sample;
      const secs = Math.round((Date.now() - started) / 1000);
      let pending = feedsPending(feeds);
      if (pending.length && Date.now() - loaded > FEED_WAIT_MS) {
        for (const site of pending) feeds[site] = { state: 'failed', why: `no answer after ${FEED_WAIT_MS / 1000}s` };
        pending = [];
      }
      const failed = feedsFailed(feeds);
      asked = Object.keys(feeds).length;
      const tickets = Object.values(feeds).reduce((t, f) => t + (f.state === 'ok' ? f.tickets : 0), 0);
      console.log(`  [${W.id}] try ${attempt} +${secs}s n=${cur.n} ${cur.label ?? '-'} qty=${cur.qtyText ?? '-'} sources=${cur.sources.length} unsellable=${cur.unsellable}`
        + ` marketplaces: ${asked - pending.length - failed.length} answered, ${pending.length} waiting, ${failed.length} failed, ${tickets} tickets`);
      const empty = emptyPageReason(feeds, cur);
      emptySince = empty ? (emptySince ?? Date.now()) : null;
      if (empty && Date.now() - emptySince >= EMPTY_WAIT_MS) {
        if (attempt < LOAD_ATTEMPTS) return { retry: empty };
        // Last try: record what the page actually showed, so the cause is not guesswork.
        const { diag } = await page.evaluate(snapshotInPage, { quantity: W.quantity, withRaw: false, withDiag: true });
        return { fail: { reason: `${empty} (after ${LOAD_ATTEMPTS} page loads)`, diagnostics: { ...diag, feeds, sample: cur } } };
      }
      if (asked > 0 && pending.length === 0 && isReady(prev, cur, W.quantity)) {
        if (failed.length && attempt < LOAD_ATTEMPTS) {
          return { retry: `marketplaces failed: ${failed.map((f) => `${f.site} (${f.why})`).join(', ')}` };
        }
        const snap = await page.evaluate(snapshotInPage, { quantity: W.quantity, withRaw: true });
        if (feedsPending(feeds).length === 0 && notReadyReason(snap.sample, W.quantity) === null && sameMarket(cur, snap.sample)) {
          const answered = Object.fromEntries(Object.entries(feeds).filter(([, f]) => f.state === 'ok').map(([k, f]) => [k, f.tickets]));
          return { done: { sample: snap.sample, raw: snap.raw, feeds: answered, missing: feedsFailed(feeds) }, secs };
        }
        cur = snap.sample; // market moved between the two reads; keep polling
      }
      prev = cur;
    }
    const why = asked === 0 ? 'the page never asked any marketplace'
      : feedsPending(feeds).length ? `still waiting on ${feedsPending(feeds).join(', ')}`
        : (notReadyReason(cur, W.quantity) ?? 'market still changing');
    throw new Error(`page never settled within ${READY_DEADLINE_MS / 1000}s — last state: ${why}`);
  } catch (e) {
    // A slow or momentarily different page — the seat selector never appearing, the
    // load stalling — deserves another try rather than failing the whole check.
    // On Sep 24 two checks in a row died on "locator.waitFor: Timeout 30000ms
    // exceeded" without ever using their retries, because an exception raised here
    // bypassed the retry loop entirely and went straight to the outer handler.
    // Not retried once the overall deadline has passed: there would be no time to
    // do anything but fail again.
    const why = String(e.message || e).split('\n')[0];
    if (attempt < LOAD_ATTEMPTS && Date.now() - started < READY_DEADLINE_MS) return { retry: why };
    return { fail: { reason: `${why} (after ${attempt} page load${attempt === 1 ? '' : 's'})` } };
  } finally {
    await page.close().catch(() => {});
  }
}

let browser;
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York',
  });
  const started = Date.now();
  for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
    const r = await attemptRead(ctx, attempt, started);
    if (r.retry) { console.log(`  [${W.id}] ${r.retry} — reloading (try ${attempt + 1} of ${LOAD_ATTEMPTS})`); continue; }
    if (r.fail) {
      await browser.close();
      console.log(`  [${W.id}] CHECK FAILED: ${r.fail.reason}\n  [${W.id}] page at the time: ${summarizeDiagnostics(r.fail.diagnostics)}`);
      finish({ ok: false, ...r.fail }, 1);
    }
    await browser.close();
    const { sample, raw, feeds, missing } = r.done;
    console.log(`  [${W.id}] ready after ${r.secs}s: ${raw.length} listings from ${sample.sources.join(', ')}`
      + (missing.length ? ` — NOT INCLUDED: ${missing.map((m) => `${m.site} (${m.why})`).join(', ')}` : ''));
    finish({ ok: true, sample, raw, feeds, missing, readySeconds: r.secs }, 0);
  }
} catch (e) {
  if (browser) await browser.close().catch(() => {});
  finish({ ok: false, reason: String(e.message || e).split('\n')[0] }, 1);
}
