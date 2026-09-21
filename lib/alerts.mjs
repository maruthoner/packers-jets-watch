// Pure alert planning. Given the previous state and this check's outcome, return the
// next state and the GitHub actions to take. Emails only happen on events worth
// acting on: seats appear, cheaper seats appear, or checks keep failing.
//
// How notification works here (verified Sep 2): a bot issue that @mentions and
// assigns the owner emails them; a comment that @mentions emails them; editing an
// issue body emails nobody. So "quiet updates" are body edits, "alerts" are
// new issues or mentioning comments.

import { summarizeDiagnostics } from './ready.mjs';
import { sectionsText } from './decide.mjs';

export const FAIL_THRESHOLD = 2;   // consecutive failed checks before alerting
export const EMPTY_THRESHOLD = 2;  // consecutive empty checks before calling seats gone
const CENT = 0.005;

export function initialState() {
  return {
    failStreak: 0, failIssue: null, failActive: false, lastFailure: null,
    alerts: {},          // one entry per emailing list: { issue, active, notifiedBest, emptyStreak }
    lastSuccessISO: null,
  };
}

const newAlert = () => ({ issue: null, active: false, notifiedBest: null, emptyStreak: 0 });

const money = (n) => `$${n.toFixed(2)}`;

// One stable title per emailing list, so its alerts always land in the same issue.
export function matchTitle(spec) {
  const name = spec.label ? `${spec.alertLabel} ${spec.label.toLowerCase()}` : spec.alertLabel;
  return `${name}: ${spec.quantity} seats together at ${money(spec.priceMax)} or less`;
}
export function failTitle(w) {
  return `${w.alertLabel}: seat watch checks are failing`;
}

function rowsText({ rowMin, rowMax }) {
  if (rowMin === undefined && rowMax === undefined) return '';
  if (rowMax === 1 && rowMin === undefined) return ', row 1 only';
  if (rowMin === 2 && rowMax === undefined) return ', any row except row 1';
  if (rowMin !== undefined && rowMax !== undefined) return `, rows ${rowMin}–${rowMax}`;
  if (rowMin !== undefined) return `, row ${rowMin} or higher`;
  return `, rows 1–${rowMax}`;
}

function criteriaText(spec) {
  return `${spec.quantity} seats together, ${sectionsText(spec)}${rowsText(spec)}, ${money(spec.priceMax)} or less each (all-in)`;
}

export function seatLines(matches, limit = 8) {
  const lines = matches.slice(0, limit).map((m) => {
    const where = m.unassigned
      ? `${m.secLabel || 'Section not assigned'}, row ${m.rowLabel || 'not assigned'} — **location not assigned yet**`
      : `${m.secLabel}, row ${m.rowLabel}`;
    return `- **${money(m.price)}** each — ${where}${m.link ? `\n  ${m.link}` : ''}`;
  });
  if (matches.length > limit) lines.push(`- …and ${matches.length - limit} more on the status page`);
  return lines.join('\n');
}

const footer = 'Confirm the marketplace page shows the right game, date and quantity before paying. Links carry TicketWhiz affiliate tracking.';

// outcome.alerts: [{ id, spec, matches }] — one entry per list that emails.
export function plan(prev, outcome, w, ctx) {
  const s = { ...initialState(), ...prev, alerts: { ...(prev?.alerts ?? {}) } };
  for (const legacy of ['matchIssue', 'matchActive', 'notifiedBest', 'emptyStreak']) delete s[legacy];
  if (s.failActive && !s.failIssue) s.failActive = false;
  const actions = [];
  const owner = `@${ctx.owner}`;

  if (!outcome.ok) {
    s.failStreak += 1;
    s.lastFailure = { reason: outcome.reason, whenISO: outcome.whenISO, ...(outcome.diagnostics ? { diagnostics: outcome.diagnostics } : {}) };
    if (s.failStreak >= FAIL_THRESHOLD && !s.failActive) {
      const body = `${owner} — the last ${s.failStreak} checks for **${w.title}** could not complete.\n\n`
        + `Latest reason: ${outcome.reason}\n\n`
        + (outcome.diagnostics ? `What the page showed: ${summarizeDiagnostics(outcome.diagnostics)}\n\n` : '')
        + `No conclusion about seat availability should be drawn until checks recover. Run: ${ctx.runUrl}`;
      actions.push(s.failIssue
        ? { type: 'comment', key: 'fail', issue: s.failIssue, body }
        : { type: 'open', key: 'fail', title: failTitle(w), body });
      s.failActive = true;
    }
    return { state: s, actions };
  }

  s.lastSuccessISO = outcome.whenISO;
  if (s.failActive && s.failIssue) {
    actions.push({ type: 'edit', key: 'fail', issue: s.failIssue,
      body: `Checks for **${w.title}** recovered at ${outcome.when}. This issue stays open so a future failure can be reported here.` });
  }
  s.failActive = false;
  s.failStreak = 0;

  // Every emailing list keeps its own issue, its own "already told her" flag and its own
  // best price, so one list going quiet never silences another.
  for (const { id, spec, matches } of outcome.alerts ?? []) {
    const a = { ...newAlert(), ...(s.alerts[id] ?? {}) };
    // An "active" flag with no issue to talk in means an earlier alert never landed.
    if (a.active && !a.issue) { a.active = false; a.notifiedBest = null; }
    const key = `match:${id}`;
    const named = spec.label ? `${w.title} — ${spec.label}` : w.title;

    if (matches.length > 0) {
      a.emptyStreak = 0;
      const best = matches[0].price;
      const current = `**Watching for:** ${criteriaText(spec)}\n\n**As of ${outcome.when}** — ${matches.length} listing(s) fit:\n\n${seatLines(matches)}\n\n${footer}`;
      if (!a.active) {
        const body = `${owner} — seats are available for **${named}**.\n\n${current}`;
        actions.push(a.issue
          ? { type: 'comment', key, issue: a.issue, body }
          : { type: 'open', key, title: matchTitle(spec), body });
        a.active = true;
        a.notifiedBest = best;
      } else {
        if (a.notifiedBest === null || best < a.notifiedBest - CENT) {
          actions.push({ type: 'comment', key, issue: a.issue,
            body: `${owner} — cheaper seats for **${named}**: now from **${money(best)}** each (was ${money(a.notifiedBest ?? best)}).\n\n${seatLines(matches, 5)}\n\n${footer}` });
          a.notifiedBest = best;
        }
        if (a.issue) actions.push({ type: 'edit', key, issue: a.issue, body: current });
      }
    } else if (a.active) {
      a.emptyStreak += 1;
      if (a.emptyStreak >= EMPTY_THRESHOLD) {
        if (a.issue) {
          actions.push({ type: 'edit', key, issue: a.issue,
            body: `**Watching for:** ${criteriaText(spec)}\n\nNo listings fit as of ${outcome.when}. You'll be mentioned here again if seats come back.` });
        }
        a.active = false;
        a.notifiedBest = null;
        a.emptyStreak = 0;
      }
    }
    s.alerts[id] = a;
  }
  // Lists change (Ruth has reshaped them three times). Drop the state of any list
  // that no longer emails, so it cannot linger as a thread nothing will update.
  const live = new Set((outcome.alerts ?? []).map((entry) => entry.id));
  for (const id of Object.keys(s.alerts)) if (!live.has(id)) delete s.alerts[id];
  return { state: s, actions };
}
