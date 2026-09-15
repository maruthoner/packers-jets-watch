// Pure readiness rules for a TicketWhiz page snapshot.
//
// Observed on the live page (Sep 14): on a cold load the list fills marketplace by
// marketplace while the status reads "Refreshing Marketplaces", then flips to
// "Live Prices" when the last one lands. During the periodic refresh (~every 2 min)
// the list keeps the previous complete data and swaps at the end. So "Live Prices"
// plus data that passes the quantity check, seen consistently twice, is a finished read.

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
