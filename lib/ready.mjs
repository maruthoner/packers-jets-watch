// Pure readiness rules for a TicketWhiz market read.
//
// Observed on the live page (Sep 15): the page asks each marketplace separately
// (GET api-v2.ticketwhiz.com/data/real-time-platform/?site_name=X), merges the answers
// into one list, and shows "Live Prices" once every request has settled — including
// when a marketplace failed or never answered. So the label says "done asking", not
// "everyone answered". On Sep 15 two checks settled on "Live Prices" with event365
// missing and ~3,000 fewer listings. Completeness therefore comes from the
// marketplace answers themselves; the page samples confirm the merged list is stable.
// The page re-asks every marketplace about every 2 minutes.

export const FEED_PATH = '/data/real-time-platform/';

export function feedSite(url) {
  try { return (new URL(url).searchParams.get('site_name') || '').toLowerCase() || null; } catch { return null; }
}

// One marketplace answer -> { ok: true, tickets } or { ok: false, why }.
// A successful answer carries status 200 at the top and in platform_stats; zero tickets
// is a valid answer (Ticketmaster always returns 0 here).
export function classifyFeed({ httpStatus, body }) {
  if (httpStatus !== 200) return { ok: false, why: `HTTP ${httpStatus}` };
  let j;
  try { j = JSON.parse(body); } catch { return { ok: false, why: 'unreadable answer' }; }
  if (!j || typeof j !== 'object') return { ok: false, why: 'unreadable answer' };
  if (j.status !== 200) return { ok: false, why: `answered "${j.message ?? `status ${j.status}`}"` };
  const stat = Array.isArray(j.platform_stats) ? j.platform_stats[0] : null;
  if (stat && stat.status !== 200) return { ok: false, why: `marketplace status ${stat.status}` };
  if (!Array.isArray(j.ticketnetwork_map_tickets)) return { ok: false, why: 'answer has no ticket list' };
  return { ok: true, tickets: j.ticketnetwork_map_tickets.length };
}

// feeds: { site: { state: 'pending' | 'ok' | 'failed', why?, tickets? } }
export function feedsPending(feeds) {
  return Object.keys(feeds).filter((s) => feeds[s].state === 'pending').sort();
}
export function feedsFailed(feeds) {
  return Object.keys(feeds).filter((s) => feeds[s].state === 'failed').sort()
    .map((site) => ({ site, why: feeds[site].why }));
}

// Returns why this sample is not usable yet, or null.
export function notReadyReason(sample, quantity) {
  if (!sample) return 'no sample';
  if (!new RegExp(`^${quantity} Seats?$`, 'i').test(sample.qtyText ?? '')) {
    return `seat selector reads "${sample.qtyText ?? 'nothing'}"`;
  }
  if (!/^live prices$/i.test(sample.label ?? '')) return `page status is "${sample.label ?? 'missing'}"`;
  if (!sample.n) return 'no listings loaded';
  if (sample.unsellable > 0) return `${sample.unsellable} listings not sellable in ${quantity} (still showing the old filter)`;
  return null;
}

export function sameMarket(a, b) {
  return !!a && !!b && a.n === b.n && a.sources.join(',') === b.sources.join(',');
}

// Two consecutive usable samples describing the same market.
export function isReady(prev, cur, quantity) {
  return notReadyReason(prev, quantity) === null
    && notReadyReason(cur, quantity) === null
    && sameMarket(prev, cur);
}

// All marketplaces have settled but the page still lists nothing. Seen overnight on
// Sep 17 for hours on both games. Says which side was empty so the failure is honest.
export function emptyPageReason(feeds, sample) {
  if (!sample || sample.n !== 0 || Object.keys(feeds).length === 0 || feedsPending(feeds).length) return null;
  const tickets = Object.values(feeds).reduce((t, f) => t + (f.state === 'ok' ? f.tickets : 0), 0);
  const failed = feedsFailed(feeds).length;
  if (tickets === 0) {
    return failed
      ? `TicketWhiz listed no seats: ${failed} marketplace${failed === 1 ? '' : 's'} failed and the rest returned 0 tickets`
      : 'TicketWhiz listed no seats: every marketplace answered with 0 tickets';
  }
  return `marketplaces returned ${tickets.toLocaleString('en-US')} tickets but the page listed none`;
}
