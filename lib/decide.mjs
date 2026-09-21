// Pure decisions: validate raw listings, then pick matches. No browser, no I/O.

// Every listing id ends with the marketplace it came from ("VB17177429238vividseats").
const SOURCES = ['vividseats', 'gametime', 'seatgeek', 'viagogo', 'stubhub', 'ticketnetwork',
  'megaseats', 'event365', 'ticketmaster', 'tickpick', 'axs'];

export function sourceOf(id) {
  const s = String(id ?? '').toLowerCase();
  return SOURCES.find((name) => s.endsWith(name)) ?? 'other';
}

// Buy links arrive with the quantity zeroed out — TicketWhiz's own template value,
// emitted whatever its seat selector says. What that does at the far end, checked
// live: viagogo opens with the filter on "Any" and the listing selector on 1 ticket,
// and the TicketNetwork checkout refuses outright. Each marketplace spells the
// parameter differently (surveyed Sep 21):
//   quantity=0    seatgeek, viagogo, event365, stubhub, ticketnetwork
//   qty=0         vividseats
//   seat_count=0  gametime
//   listingQty=   viagogo, stubhub — present but empty
//   (megaseats carries no quantity at all, and is left alone)
// The parameter must follow a delimiter, so "qty" does not match inside "listingQty".
// Destinations are URL-encoded inside the affiliate wrapper on some links and plain
// on others, hence matching "?"/"&" and "%3F"/"%26", "="/"%3D".
const ZEROED = ['quantity', 'qty', 'seat_count', 'listingQty'];
const EMPTY = ['listingQty']; // observed empty rather than zero, so fill that too
const DELIM = '([?&#]|%3F|%26|%23)';

export function withQuantity(url, quantity) {
  if (!url) return url;
  const q = String(Number(quantity));
  if (!/^\d+$/.test(q)) return url;
  let out = String(url);
  for (const name of ZEROED) {
    out = out.replace(new RegExp(`${DELIM}(${name})(=|%3D)0(?![\\d])`, 'gi'), `$1$2$3${q}`);
  }
  for (const name of EMPTY) {
    out = out.replace(new RegExp(`${DELIM}(${name})(=|%3D)(?=&|%26|#|%23|$)`, 'gi'), `$1$2$3${q}`);
  }
  return out;
}

export function isSafeLink(url) {
  return /^https:\/\/[^\s"'<>]+$/i.test(String(url ?? ''));
}

// A listing that does not come with a seat. Three ways that shows up, all seen live
// on Sep 21 — the SRO-with-row-"general" shape was slipping through and appearing as
// a Preferred near miss, and would have emailed as a match had it dropped under the cap:
//   zone ticket    "301–306–OR–346–350" — spans sections, row TBD
//   standing room  "400 Standing Room Only", "400 STANDING ROOM ONLY", "SRO", "432SRO"
//   no real row    "", "ga", "GA", "general"
export function isUnassigned(listing) {
  const sec = String(listing.secLabel ?? '');
  const row = String(listing.rowLabel ?? '').trim();
  if (/(^|[\s–—-])OR([\s–—-]|$)/.test(sec)) return true;
  if (/(standing\s*room|SRO)\b/i.test(sec)) return true;
  return /^(tbd|ga|general(\s*admission)?|sro)?$/i.test(row);
}

// Turn the page's raw objects into listings we can reason about. Anything we cannot
// evaluate is counted, never silently treated as a seat.
export function normalize(raw, quantity, { exclude = [] } = {}) {
  // A marketplace can be excluded outright when its prices cannot be trusted —
  // see `excludeSources` in watchers.mjs. Excluded listings are dropped before
  // anything else looks at them, so they cannot match, cannot appear as a near
  // miss, and cannot shade a section on the map at a price nobody can pay.
  // They are counted separately from the rejections that mean something is wrong.
  const blocked = new Set(exclude.map((name) => String(name).toLowerCase()));
  const listings = [];
  const rejected = { price: 0, quantity: 0, source: 0 };
  let considered = 0;
  for (const r of raw) {
    if (blocked.size && blocked.has(sourceOf(r.id))) { rejected.source++; continue; }
    considered++;
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
      link: isSafeLink(r.link) ? withQuantity(String(r.link), quantity) : null,
    };
    l.unassigned = isUnassigned(l);
    listings.push(l);
  }
  return { listings, rejected, considered };
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

// "Section 750S" / "741 S" / "Upper Level 336" / "336" -> "750" / "741" / "336".
// Sellers are inconsistent about a section's trailing letter — the same seats
// arrive as both "634" and "634S" — so the number alone is what they agree on.
export function sectionKey(label) {
  const m = String(label ?? '').match(/\d{3,4}/);
  return m ? m[0] : null;
}

// A list can name its sections outright, or name the levels it covers — `levels: [1, 3, 4]`
// means everything numbered in the 100s, 300s and 400s. Levels are used where naming
// 120 sections one by one would be unreadable and would silently miss any section the
// marketplaces turn out to use that the venue map does not list (Ruth, Sep 21).
export function sectionFits(l, w) {
  if (!w.sections && !w.levels) return true;
  if (l.unassigned) return false; // cannot promise a location we do not know
  const groups = l.secLabel.match(/\d+/g) ?? [];
  if (groups.length !== 1) return false; // "301-306-OR-346-350" is not one section
  const n = groups[0];
  if (w.sections && !w.sections.includes(Number(n))) return false;
  if (w.levels && !w.levels.includes(Number(n[0]))) return false;
  return true;
}

// "sections in the 100s, 300s and 400s" / "sections 137, 139" / "any section"
export function sectionsText(spec) {
  if (spec.levels?.length) {
    const parts = spec.levels.map((n) => `${n}00s`);
    const joined = parts.length === 1 ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    return `sections in the ${joined}`;
  }
  if (spec.sections) return `sections ${spec.sections.join(', ')}`;
  return 'any section';
}

function rowFits(l, w) {
  if (w.rowMax === undefined && w.rowMin === undefined) return true;
  if (!/^\d+$/.test(l.rowLabel)) return false; // TBD/GA rows cannot satisfy a row rule
  const row = Number(l.rowLabel);
  return (w.rowMax === undefined || row <= w.rowMax) && (w.rowMin === undefined || row >= w.rowMin);
}

const CENT = 0.005;

// One card per section. Three listings from the same section tell Ruth about one
// part of the stadium; three sections tell her where the affordable end is
// (Ruth, Sep 20). Listings come in cheapest-first, so the first seen for a section
// is that section's cheapest. A listing with no section number stands alone.
function cheapestPerSection(sorted) {
  const seen = new Set();
  return sorted.filter((l) => {
    const k = sectionKey(l.secLabel);
    if (k === null) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function decide(listings, w) {
  // assignedOnly: standing room and other listings with no seat are never a match
  // (Ruth, Sep 20 — she wants seats, and SRO is the cheapest thing in this market).
  const seated = w.assignedOnly ? listings.filter((l) => !l.unassigned) : listings;
  const located = seated.filter((l) => sectionFits(l, w) && rowFits(l, w));
  const sorted = located.slice().sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
  return {
    matches: sorted.filter((l) => l.price <= w.priceMax + CENT),
    closest: cheapestPerSection(sorted.filter((l) => l.price > w.priceMax + CENT)).slice(0, w.closest ?? 3),
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
      id: spec.id, label: spec.label, sections: spec.sections, levels: spec.levels, rowMax: spec.rowMax,
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
