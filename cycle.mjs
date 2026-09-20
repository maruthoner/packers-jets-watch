// Usage: node cycle.mjs [--dry-run]
// One cycle for every game still ahead: read the market, decide, alert, render, publish.
// Exit code 3 means no game is left to watch (the loop should stop).
import { spawn, execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WATCHERS } from './watchers.mjs';
import { normalize, validate, decideAll, alertLists, listSpecs } from './lib/decide.mjs';
import { plan, initialState, matchTitle, failTitle } from './lib/alerts.mjs';
import { renderPage, fmt } from './lib/page.mjs';
import { loadVenue, sectionPrices } from './lib/map.mjs';
import { publish } from './lib/publish.mjs';

const DRY = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';
const REPO = process.env.GITHUB_REPOSITORY || 'maruthoner/packers-jets-watch';
const OWNER = process.env.GITHUB_REPOSITORY_OWNER || REPO.split('/')[0];
const RUN_URL = `https://github.com/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID || 'local'}`;
const WATCH_TIMEOUT_MS = 300000; // a hung browser must not stall every other game
const TEMP = process.env.RUNNER_TEMP || tmpdir();

const log = (msg) => console.log(msg);
const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };
const writeJson = (path, value) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };
const sitePath = (w) => w.outDir.replace(/^docs\/?/, '');

// One alert entry per list that emails, each with the spec its issue is written from.
export function alertEntries(w, decided) {
  const specs = listSpecs(w);
  return alertLists(w, decided).map((l) => ({
    id: l.id ?? 'general',
    spec: specs.find((s) => s.id === l.id) ?? w,
    matches: l.matches,
  }));
}

export function paths(w) {
  return { page: `${w.outDir}/index.html`, result: `data/${w.id}/result.json`, state: `data/${w.id}/state.json` };
}

function runWatch(w) {
  const out = join(TEMP, `market-${w.id}-${process.pid}.json`);
  rmSync(out, { force: true });
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['watch.mjs', w.id, out], { stdio: 'inherit', detached: true });
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, WATCH_TIMEOUT_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      const data = readJson(out, null);
      rmSync(out, { force: true });
      if (signal) return resolve({ ok: false, reason: `market read was killed after ${WATCH_TIMEOUT_MS / 1000}s without finishing` });
      if (!data) return resolve({ ok: false, reason: `market read exited ${code} without writing a result` });
      resolve(data);
    });
  });
}

// ---- GitHub side effects, isolated so tests can replace them ----
export function githubClient({ gh = (args) => execFileSync('gh', args, { encoding: 'utf8' }) } = {}) {
  const findOpen = (title) => {
    const found = JSON.parse(gh(['issue', 'list', '--repo', REPO, '--state', 'open', '--search', `in:title "${title}"`, '--json', 'number,title']));
    return found.find((i) => i.title === title)?.number ?? null;
  };
  return {
    open(title, body) {
      const existing = findOpen(title); // state may have been lost; never duplicate an issue
      if (existing) { gh(['issue', 'comment', String(existing), '--repo', REPO, '--body', body]); return existing; }
      const url = gh(['issue', 'create', '--repo', REPO, '--title', title, '--body', body, '--assignee', OWNER]).trim();
      const n = Number(url.match(/\/issues\/(\d+)/)?.[1]);
      if (!n) throw new Error(`could not read the new issue number from "${url}"`);
      return n;
    },
    comment(issue, body) { gh(['issue', 'comment', String(issue), '--repo', REPO, '--body', body]); },
    edit(issue, body) { gh(['issue', 'edit', String(issue), '--repo', REPO, '--body', body]); },
  };
}

export function executeActions(actions, state, client, { dry = false, logFn = log } = {}) {
  const s = { ...state, alerts: { ...(state.alerts ?? {}) } };
  const listOf = (key) => (key.startsWith('match:') ? key.slice(6) : null);
  for (const a of actions) {
    if (dry) { logFn(`  DRY RUN — would ${a.type} ${a.key} issue${a.issue ? ` #${a.issue}` : ''}`); continue; }
    const id = listOf(a.key);
    try {
      if (a.type === 'open') {
        const number = client.open(a.title, a.body);
        if (id) s.alerts[id] = { ...(s.alerts[id] ?? {}), issue: number };
        else s.failIssue = number;
      } else if (a.type === 'comment') client.comment(a.issue, a.body);
      else if (a.type === 'edit') client.edit(a.issue, a.body);
      logFn(`  ${a.type} ${a.key} issue #${(id ? s.alerts[id]?.issue : s.failIssue) ?? a.issue}`);
    } catch (e) {
      logFn(`  could not ${a.type} ${a.key} issue: ${String(e.message || e).split('\n')[0]}`);
      // An alert that did not land must be retried next cycle, not recorded as sent.
      if (a.type !== 'edit') {
        if (id) s.alerts[id] = { ...(s.alerts[id] ?? {}), active: false, notifiedBest: null };
        else s.failActive = false;
      }
    }
  }
  return s;
}

async function cycleOne(w) {
  const p = paths(w);
  const prevState = readJson(p.state, initialState());
  const lastResult = readJson(p.result, null);

  const read = await runWatch(w);
  let outcome;
  let result = lastResult;
  if (!read.ok) {
    outcome = { ok: false, reason: read.reason, diagnostics: read.diagnostics ?? null, whenISO: new Date().toISOString() };
  } else {
    const { listings, rejected } = normalize(read.raw, w.quantity);
    const problem = validate({ rawCount: read.raw.length, rejected, missing: read.missing ?? [] }, w);
    if (problem) {
      outcome = { ok: false, reason: problem, whenISO: read.whenISO };
    } else {
      const decided = decideAll(listings, w);
      result = {
        watcher: w.id, whenISO: read.whenISO, when: fmt(read.whenISO), quantity: w.quantity,
        priceMax: w.priceMax, listings: listings.length, rejected, sources: read.sample.sources,
        readySeconds: read.readySeconds, feeds: read.feeds ?? null, missing: read.missing ?? [],
        matches: decided.general?.matches ?? [], closest: decided.general?.closest ?? [], lists: decided.lists,
        sectionPrices: w.venueMap ? sectionPrices(listings) : undefined,
      };
      outcome = { ok: true, whenISO: read.whenISO, when: result.when, alerts: alertEntries(w, decided) };
    }
  }
  log(outcome.ok
    ? `  [${w.id}] ${result.listings} listings${result.missing.length ? ` (not included: ${result.missing.map((m) => m.site).join(', ')})` : ''} — ${result.lists.map((l) => `${l.id}: ${l.matches.length}, `).join('')}${w.otherSections === false ? 'other sections: not listed' : `general: ${result.matches.length}`}; alerting on ${outcome.alerts.map((a) => `${a.id} ${a.matches.length}${a.matches[0] ? ` (best $${a.matches[0].price.toFixed(2)})` : ''}`).join(', ')}`
    : `  [${w.id}] CHECK FAILED: ${outcome.reason}`);

  const planned = plan(prevState, outcome, w, { owner: OWNER, runUrl: RUN_URL });
  let state = executeActions(planned.actions, planned.state, githubClient(), { dry: DRY });

  if (outcome.ok) writeJson(p.result, result);
  const others = Object.values(WATCHERS).filter((o) => o.id !== w.id).map((o) => {
    const up = '../'.repeat(sitePath(w).split('/').filter(Boolean).length);
    return { title: o.title, href: `${up}${sitePath(o) ? sitePath(o) + '/' : ''}` };
  });
  mkdirSync(w.outDir, { recursive: true });
  writeFileSync(p.page, renderPage(w, { result, state, others, venue: w.venueMap ? loadVenue(w.venueMap) : null }));
  writeJson(p.state, state);

  if (DRY) { log('  DRY RUN — not publishing'); return; }

  const gitRun = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const pub = await publish({
    git: gitRun, files: [p.page, p.result, p.state].filter((f) => existsSync(f)),
    message: `status [${w.id}]: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    pause: (n) => new Promise((r) => setTimeout(r, 4000 * n)),
  });
  log(`  [${w.id}] publish: ${pub.status}${pub.detail ? ` (${pub.detail})` : ''}`);

  // A page that silently stops updating looks healthy. Count failures locally (the state
  // file itself is what failed to publish) and alert on the second in a row.
  const counter = join(TEMP, `publish-fails-${w.id}`);
  if (pub.status === 'failed' || pub.status === 'refused') {
    const n = Number(readJson(counter, 0)) + 1;
    writeFileSync(counter, String(n));
    if (n >= 2) {
      const again = plan({ ...state, failStreak: Math.max(state.failStreak, 1) },
        { ok: false, reason: `the status page has not published for ${n} cycles (${pub.detail})`, whenISO: new Date().toISOString() },
        w, { owner: OWNER, runUrl: RUN_URL });
      executeActions(again.actions, again.state, githubClient());
    }
  } else {
    writeFileSync(counter, '0');
  }
}

async function main() {
  const now = Date.now();
  const active = Object.values(WATCHERS).filter((w) => now < Date.parse(w.kickoff));
  for (const w of Object.values(WATCHERS)) if (!active.includes(w)) log(`[${w.id}] kicked off ${w.kickoff} — no longer watched`);
  if (active.length === 0) { log('no games left to watch'); process.exit(3); }
  for (const w of active) {
    log(`::group::${w.id} — ${new Date().toISOString().slice(11, 16)} UTC`);
    try {
      await cycleOne(w);
    } catch (e) {
      // A crash is a failed check like any other: count it, alert on repeats, keep the record.
      log(`  [${w.id}] cycle crashed: ${e.stack || e}`);
      try {
        const p = paths(w);
        const failed = plan(readJson(p.state, initialState()),
          { ok: false, reason: `the check crashed: ${String(e.message || e).split('\n')[0]}`, whenISO: new Date().toISOString() },
          w, { owner: OWNER, runUrl: RUN_URL });
        writeJson(p.state, executeActions(failed.actions, failed.state, githubClient(), { dry: DRY }));
      } catch (inner) { log(`  [${w.id}] could not record the crash: ${inner.message}`); }
    }
    log('::endgroup::');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
