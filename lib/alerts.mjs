// Pure alert planning. Given the previous state and this check's outcome, return the
// next state and the GitHub actions to take. Emails only happen on events worth
// acting on: seats appear, cheaper seats appear, or checks keep failing.
//
// How notification works here (verified Sep 2): a bot issue that @mentions and
// assigns the owner emails them; a comment that @mentions emails them; editing an
// issue body emails nobody. So "quiet updates" are body edits, "alerts" are
// new issues or mentioning comments.

export const FAIL_THRESHOLD = 2;   // consecutive failed checks before alerting
export const EMPTY_THRESHOLD = 2;  // consecutive empty checks before calling seats gone
const CENT = 0.005;

export function initialState() {
  return {
    failStreak: 0, failIssue: null, failActive: false, lastFailure: null,
    matchIssue: null, matchActive: false, notifiedBest: null, emptyStreak: 0,
    lastSuccessISO: null,
  };
}

const money = (n) => `$${n.toFixed(2)}`;

export function matchTitle(w) {
  return `${w.matchLabel ?? w.alertLabel}: ${w.quantity} seats together at ${money(w.priceMax)} or less`;
}
export function failTitle(w) {
  return `${w.alertLabel}: seat watch checks are failing`;
}

function criteriaText(w) {
  const where = w.sections ? `sections ${w.sections.join(', ')}` : 'any section';
  const rows = w.rowMax !== undefined ? `, rows 1–${w.rowMax}` : '';
  return `${w.quantity} seats together, ${where}${rows}, ${money(w.priceMax)} or less each (all-in)`;
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

export function plan(prev, outcome, w, ctx) {
  const s = { ...initialState(), ...prev };
  // An "active" flag without an issue to talk in means an earlier alert never landed
  // (for example the issue could not be created). Treat it as not yet alerted.
  if (s.matchActive && !s.matchIssue) { s.matchActive = false; s.notifiedBest = null; }
  if (s.failActive && !s.failIssue) s.failActive = false;
  const actions = [];
  const owner = `@${ctx.owner}`;

  if (!outcome.ok) {
    s.failStreak += 1;
    s.lastFailure = { reason: outcome.reason, whenISO: outcome.whenISO };
    if (s.failStreak >= FAIL_THRESHOLD && !s.failActive) {
      const body = `${owner} — the last ${s.failStreak} checks for **${w.title}** could not complete.\n\n`
        + `Latest reason: ${outcome.reason}\n\n`
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

  const { matches } = outcome;
  if (matches.length > 0) {
    s.emptyStreak = 0;
    const best = matches[0].price;
    const current = `**Watching for:** ${criteriaText(w)}\n\n**As of ${outcome.when}** — ${matches.length} listing(s) fit:\n\n${seatLines(matches)}\n\n${footer}`;
    if (!s.matchActive) {
      const body = `${owner} — seats are available for **${w.title}**.\n\n${current}`;
      actions.push(s.matchIssue
        ? { type: 'comment', key: 'match', issue: s.matchIssue, body }
        : { type: 'open', key: 'match', title: matchTitle(w), body });
      s.matchActive = true;
      s.notifiedBest = best;
    } else {
      if (s.notifiedBest === null || best < s.notifiedBest - CENT) {
        actions.push({ type: 'comment', key: 'match', issue: s.matchIssue,
          body: `${owner} — cheaper seats for **${w.title}**: now from **${money(best)}** each (was ${money(s.notifiedBest ?? best)}).\n\n${seatLines(matches, 5)}\n\n${footer}` });
        s.notifiedBest = best;
      }
      if (s.matchIssue) actions.push({ type: 'edit', key: 'match', issue: s.matchIssue, body: current });
    }
  } else if (s.matchActive) {
    s.emptyStreak += 1;
    if (s.emptyStreak >= EMPTY_THRESHOLD) {
      if (s.matchIssue) {
        actions.push({ type: 'edit', key: 'match', issue: s.matchIssue,
          body: `**Watching for:** ${criteriaText(w)}\n\nNo listings fit as of ${outcome.when}. You'll be mentioned here again if seats come back.` });
      }
      s.matchActive = false;
      s.notifiedBest = null;
      s.emptyStreak = 0;
    }
  }
  return { state: s, actions };
}
