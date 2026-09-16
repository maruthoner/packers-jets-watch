// Pure decisions: validate raw listings, then pick matches. No browser, no I/O.

// Every listing id ends with the marketplace it came from ("VB17177429238vividseats").
const SOURCES = ['vividseats', 'gametime', 'seatgeek', 'viagogo', 'stubhub', 'ticketnetwork',
  'megaseats', 'event365', 'ticketmaster', 'tickpick', 'axs'];

export function sourceOf(id) {
  const s = String(id ?? '').toLowerCase();
  return SOURCES.find((name) => s.endsWith(name)) ?? 'other';
}

export function isSafeLink(url) {
  return /^https:\/\/[^\s"'<>]+$/i.test(String(url ?? ''));
}

// A seat whose location is not fixed yet: "301–306–OR–346–350", or row "TBD".
export function isUnassigned(listing) {
  return /(^|[\s–—-])OR([\s–—-]|$)/.test(listing.secLabel) || /^(tbd|ga)?$/i.test(listing.rowLabel);
}

// Turn the page's raw objects into listings we can reason about. Anything we cannot
// evaluate is counted, never silently treated as a seat.
export function normalize(raw, quantity) {
  const listings = [];
  const rejected = { price: 0, quantity: 0 };
  for (const r of raw) {
    // tgAllInPrice is the field that means "including fees". tgPrice happens to equal it
    // today because fees show as $0, but that is not something to depend on.
    const price = Number(r.allIn);
    if (r.allIn === null || r.allIn === undefined || !Number.isFinite(price) || price <= 0) {
      rejected.price++;
      continue;
    }
    const splits = Array.isArray(r.splits) ? r.splits.map(Number) : [];
    if (!splits.includes(quantity)) {
      rejected.quantity++;
      continue;
    }
    const l = {
      id: String(r.id ?? ''),
      source: sourceOf(r.id),
      secLabel: String(r.secLabel ?? '').trim(),
      rowLabel: String(r.rowLabel ?? '').trim(),
      price,
      link: isSafeLink(r.link) ? String(r.link) : null,
    };
    l.unassigned = isUnassigned(l);
    listings.push(l);
  }
  return { listings, rejected };
}

// Returns a reason the read cannot be trusted, or null.
// Completeness is judged by the marketplaces' own answers (watch.mjs), not by a listing
// count: the market legitimately shrinks as seats sell before the game (Jets went from
// ~12,000 to ~7,400 in two days). One marketplace missing is shown on the page; more
// than one means the read covers too little of the market to rule anything out.
export function validate({ rawCount, rejected, missing = [] }, watcher) {
  if (missing.length > 1) {
    return `${missing.length} marketplaces did not answer (${missing.map((m) => m.site).join(', ')}) — too much of the market is unchecked`;
  }
  if (rawCount === 0) return 'no listings loaded';
  if (rejected.quantity > 0) {
    return `${rejected.quantity} of ${rawCount} listings cannot sell ${watcher.quantity} — the seat filter did not apply`;
  }
  // A few odd listings are tolerable; many means the price field changed shape and
  // "no match" could not honestly be claimed.
  if (rejected.price / rawCount > 0.01) {
    return `${rejected.price} of ${rawCount} listings have no usable all-in price — the page's data format may have changed`;
  }
  return null;
}

export function sectionFits(l, w) {
  if (!w.sections) return true;
  if (l.unassigned) return false; // cannot promise a location we do not know
  const groups = l.secLabel.match(/\d+/g) ?? [];
  return groups.length === 1 && w.sections.includes(Number(groups[0]));
}

function rowFits(l, w) {
  if (w.rowMax === undefined) return true;
  return /^\d+$/.test(l.rowLabel) && Number(l.rowLabel) <= w.rowMax;
}

const CENT = 0.005;

export function decide(listings, w) {
  const located = listings.filter((l) => sectionFits(l, w) && rowFits(l, w));
  const sorted = located.slice().sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
  return {
    matches: sorted.filter((l) => l.price <= w.priceMax + CENT),
    closest: sorted.filter((l) => l.price > w.priceMax + CENT).slice(0, w.closest ?? 3),
  };
}

// Split the market into a preferred list and a general list for games that define
// `preferred`. A preferred pair appears only in the preferred list (Ruth, Sep 15).
// Seats with no assigned location never count as preferred: we cannot promise them.
export function preferredSpec(w) {
  if (!w.preferred) return null;
  return {
    ...w,
    sections: w.preferred.sections,
    rowMax: w.preferred.rowMax,
    priceMax: w.preferred.priceMax ?? w.priceMax,
    closest: w.preferred.closest ?? w.closest,
  };
}

export function decideAll(listings, w) {
  const spec = preferredSpec(w);
  if (!spec) return { general: decide(listings, w), preferred: null };
  return {
    preferred: decide(listings, spec),
    general: decide(listings.filter((l) => !sectionFits(l, spec)), w),
  };
}

// Which list emails: games with a preferred list alert on it unless told otherwise.
export function alertList(w, decided) {
  return decided.preferred && w.alertOn !== 'general' ? decided.preferred : decided.general;
}
