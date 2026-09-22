// Is the seat watch actually still checking?
//
// The watcher is one long-lived job. When its runner hangs — as it did on Sep 18 and
// again on Sep 21 — the run stays "in progress" past its own timeout and keeps the
// concurrency group, so every later run sits queued behind it and checks simply stop.
// watchdog.yml cannot see this: it fires on a run *completing* as failed, and a hung
// run never completes. So this asks a different question — when did a check last
// succeed? — and answers it from the record the watcher itself commits.
//
// Pure: the workflow does the reading and the restarting.

export const STALE_AFTER_MIN = 50;   // two missed 20-minute cycles (Ruth, Sep 22)
export const ALERT_AFTER_MIN = 120;  // restarting is evidently not working

export function activeWatchers(watchers, now) {
  return Object.values(watchers).filter((w) => now < Date.parse(w.kickoff));
}

// The freshest successful check across the games still being watched.
export function lastSuccess(states) {
  const times = states
    .map((s) => s?.lastSuccessISO)
    .filter(Boolean)
    .map((iso) => Date.parse(iso))
    .filter((t) => Number.isFinite(t));
  return times.length ? Math.max(...times) : null;
}

export function minutesSince(at, now) {
  return at === null ? null : Math.floor((now - at) / 60000);
}

// 'idle'    no game left to watch — say nothing, do nothing
// 'ok'      a check succeeded recently enough
// 'restart' checks have stalled; clear whatever is stuck and start a fresh run
// 'alert'   restarting has not brought them back; this needs a person
export function verdict({ watchers, states, now, staleAfter = STALE_AFTER_MIN, alertAfter = ALERT_AFTER_MIN }) {
  const active = activeWatchers(watchers, now);
  if (!active.length) return { action: 'idle', minutes: null, reason: 'no game left to watch' };

  const at = lastSuccess(states);
  const minutes = minutesSince(at, now);
  if (minutes === null) {
    return { action: 'restart', minutes: null, reason: 'no successful check has ever been recorded' };
  }
  if (minutes >= alertAfter) {
    return { action: 'alert', minutes, reason: `the last successful check was ${minutes} minutes ago and restarting has not fixed it` };
  }
  if (minutes >= staleAfter) {
    return { action: 'restart', minutes, reason: `the last successful check was ${minutes} minutes ago` };
  }
  return { action: 'ok', minutes, reason: `last successful check ${minutes} minutes ago` };
}
