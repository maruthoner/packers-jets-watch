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
  if (w.rowMax === undefined && w.rowMin === undefined) return true;
  if (!/^\d+$/.test(l.rowLabel)) return false; // TBD/GA rows cannot satisfy a row rule
  const row = Number(l.rowLabel);
  return (w.rowMax === undefined || row <= w.rowMax) && (w.rowMin === undefined || row >= w.rowMin);
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

// A game may define any number of preferred lists (Ruth, Sep 18: row 1, then every
// other row). They are ordered: a listing belongs to the first list whose sections and
// rows it fits, and never appears again lower down. The general list holds everything
// outside the preferred sections entirely. Seats with no assigned location are never
// preferred: we cannot promise a location we do not know.
export function listSpecs(w) {
  const defined = w.preferred ? (Array.isArray(w.preferred) ? w.preferred : [w.preferred]) : [];
  return defined.map((list, i) => ({
    ...w,
    ...list,
    id: list.id ?? `list${i + 1}`,
    label: list.label ?? 'Preferred sections',
    priceMax: list.priceMax ?? w.priceMax,
    closest: list.closest ?? w.closest,
  }));
}

export function fitsSpec(l, spec) {
  return sectionFits(l, spec) && rowFits(l, spec);
}

export function decideAll(listings, w) {
  const specs = listSpecs(w);
  const lists = [];
  let pool = listings;
  for (const spec of specs) {
    lists.push({
      id: spec.id, label: spec.label, sections: spec.sections, rowMax: spec.rowMax,
      rowMin: spec.rowMin, priceMax: spec.priceMax, alerts: !!spec.alerts, ...decide(pool, spec),
    });
    pool = pool.filter((l) => !fitsSpec(l, spec));
  }
  // A game can drop the catch-all list entirely (Ruth, Sep 18: Jets shows its two lists only).
  if (specs.length && w.otherSections === false) return { lists, general: null };
  const outside = specs.length ? listings.filter((l) => !specs.some((s) => sectionFits(l, s))) : listings;
  return { lists, general: decide(outside, w) };
}

// The lists emails come from: every list marked `alerts`, else the general list alone.
export function alertLists(w, decided) {
  const flagged = decided.lists.filter((l) => l.alerts);
  if (flagged.length) return flagged;
  return decided.general ? [decided.general] : [];
}
