// Venue map: draws the stadium and shades each section by its cheapest listing,
// so the affordable parts of the ground are visible at a glance.
// renderMap is pure; loadVenue does the one file read and is called from cycle.mjs,
// keeping page.mjs free of IO.
import { readFileSync } from 'fs';
import { sectionKey } from './decide.mjs';

export { sectionKey };

// Local copy so this module has no import cycle with page.mjs.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const VENUES = { lambeau: 'data/lambeau-map.json' };

// Which lower-bowl sections sit on which sideline (Ruth's notes, Sep 20). Only the
// membership is stated here; which edge of the field each label lands on is worked
// out from where those sections actually are, so the map can be drawn in any
// orientation without the labels contradicting it.
const SIDES = {
  lambeau: [
    ['Packers side', 'home', [110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130]],
    ['Visitor side', 'away', [109, 111, 113, 115, 117, 119, 121, 123, 125, 127, 129]],
  ],
};
const cache = new Map();

export function loadVenue(name, root = '.') {
  if (!VENUES[name]) return null;
  if (!cache.has(name)) {
    const venue = JSON.parse(readFileSync(`${root}/${VENUES[name]}`, 'utf8'));
    const seen = new Map();
    for (const [, s] of venue.sections) {
      const k = sectionKey(s);
      if (seen.has(k)) throw new Error(`${name} map: sections ${seen.get(k)} and ${s} share the number ${k}`);
      seen.set(k, s);
    }
    venue.id = name;
    cache.set(name, venue);
  }
  return cache.get(name);
}

// Cheapest price per section across every listing we read this cycle.
export function sectionPrices(listings) {
  const out = {};
  for (const l of listings ?? []) {
    if (l.unassigned) continue;
    const k = sectionKey(l.secLabel);
    if (!k || !Number.isFinite(l.price)) continue;
    if (out[k] === undefined || l.price < out[k]) out[k] = l.price;
  }
  return out;
}

// The sections named in the lists above: the ones holding a match, and the ones
// holding a listed near miss. Everything else on the map is left plain — the map
// answers "where are the seats I am being shown", not "what does the whole
// stadium cost" (Ruth, Sep 23).
export function highlightedSections(result) {
  const lists = result?.lists?.length
    ? result.lists
    : [{ matches: result?.matches ?? [], closest: result?.closest ?? [] }];
  const pick = (kind) => new Set(lists
    .flatMap((l) => l[kind] ?? [])
    .map((l) => sectionKey(l.secLabel))
    .filter(Boolean));
  return { match: pick('matches'), closest: pick('closest') };
}

// Area centroid, so a label sits in the middle of the seating rather than being
// pulled towards whichever edge the outline has most points on.
function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a *= 0.5;
  if (!a) return { x: pts[0][0], y: pts[0][1], area: 0 };
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}

// The largest type that still sits inside the section, or null when even the
// smallest would not. Digits in this face run about 0.58em wide.
function labelSize(label, pts, c) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const size = Math.min(
    6.5,                                   // never larger than the others
    (w * 0.82) / (label.length * 0.58),    // fits across
    h * 0.62,                              // fits down
    Math.sqrt(c.area) * 0.52,              // and inside a wedge, not just its box
  );
  return size >= 3.4 ? Math.round(size * 10) / 10 : null;
}

// "PACKERS SIDE" / "VISITOR SIDE" along the turf, on whichever edge those
// sections are drawn nearest to.
function sideLabels(venue, f) {
  const spec = SIDES[venue.id];
  if (!spec) return '';
  const mid = f.y + f.h / 2;
  return spec.map(([name, kind, sections]) => {
    const keys = new Set(sections.map(String));
    const pts = venue.sections.filter(([, n]) => keys.has(sectionKey(n))).flatMap(([, , p]) => p);
    if (!pts.length) return '';
    const above = pts.reduce((a, p) => a + p[1], 0) / pts.length < mid;
    const y = above ? f.y + 13 : f.y + f.h - 6;
    return `<text class="side ${kind}" x="${(f.x + f.w / 2).toFixed(1)}" y="${y.toFixed(1)}">${esc(name.toUpperCase())}</text>`;
  }).join('');
}

export function renderMap(venue, { prices = {}, quantity, match = new Set(), closest = new Set() }) {
  if (!venue) return '';
  const f = venue.field;
  const ez = f.w / 12; // end zones: 10 of the field's 120 yards, each end
  const lines = [];
  for (let i = 1; i < 10; i++) {
    const x = f.x + ez + ((f.w - 2 * ez) * i) / 10;
    lines.push(`<line x1="${x.toFixed(1)}" y1="${f.y}" x2="${x.toFixed(1)}" y2="${(f.y + f.h).toFixed(1)}"/>`);
  }

  // Suites and lounges: the stadium around the seating, so the rings outside the
  // bowl read as part of the building instead of as gaps. Never priced, never
  // counted in the legend.
  const context = (venue.context ?? []).map(([name, pts]) =>
    `<g class="sec context">${name ? `<title>${esc(name)}</title>` : ''}`
    + `<polygon points="${pts.map((p) => p.join(',')).join(' ')}"/></g>`).join('');

  const counts = { match: 0, closest: 0, plain: 0 };
  const shapes = venue.sections.map(([, name, pts]) => {
    const key = sectionKey(name);
    const price = prices[key];
    const b = match.has(key) ? 'match' : closest.has(key) ? 'closest' : 'plain';
    counts[b]++;
    const label = name.replace(/s$/, 'S').toUpperCase();
    const title = price === undefined
      ? `${label} — no ${quantity}-together listings`
      : `${label} — from $${price.toFixed(2)} each`;
    const c = centroid(pts);
    const size = labelSize(label, pts, c);
    // Every section gets its number, shrunk to fit its own outline rather than
    // left off (Ruth, Sep 20). Below the floor the text would be unreadable
    // anyway, so those still answer on hover.
    const text = size
      ? `<text x="${c.x.toFixed(1)}" y="${(c.y + size * 0.36).toFixed(1)}" font-size="${size}">${esc(label)}</text>`
      : '';
    return `<g class="sec ${b}"><title>${esc(title)}</title>`
      + `<polygon points="${pts.map((p) => p.join(',')).join(' ')}"/>${text}</g>`;
  }).join('');

  // Two rows now: the map only marks what the lists above name.
  const howMany = (n) => (n === 0 ? 'none right now' : `${n} section${n === 1 ? '' : 's'}`);
  const legend = [
    ['match', 'Has a match', counts.match],
    ['closest', 'Closest to your price', counts.closest],
  ].map(([k, t, n]) => `<div class="key"><i class="sw sw-${k}"></i><b>${esc(t)}</b>`
    + `<span class="n">${esc(howMany(n))}</span></div>`).join('');

  return `<h2>Lambeau Field</h2>
<p class="crit">Only the sections listed above are marked. Hover or tap any section for its cheapest price for ${esc(quantity)} together.</p>
<div class="mapwrap">
<svg viewBox="${esc(venue.viewBox)}" role="img" aria-label="Lambeau Field seating map, shaded by cheapest price per section">
<rect class="field" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="2"/>
<rect class="ez" x="${f.x}" y="${f.y}" width="${ez.toFixed(1)}" height="${f.h}"/>
<rect class="ez" x="${(f.x + f.w - ez).toFixed(1)}" y="${f.y}" width="${ez.toFixed(1)}" height="${f.h}"/>
<g class="yard">${lines.join('')}</g>
${sideLabels(venue, f)}
${context}
${shapes}
</svg>
<div class="legend">${legend}</div>
</div>`;
}

export const MAP_CSS = `.mapwrap{background:var(--s);border:1px solid var(--rule);border-radius:3px;padding:16px;margin-top:10px}
.mapwrap svg{width:100%;height:auto;display:block}
.mapwrap .field{fill:#2C4A40;stroke:none}
.mapwrap .ez{fill:#223B33;stroke:none}
.mapwrap .yard line{stroke:var(--gold);stroke-width:.7;opacity:.35}
.mapwrap text.side{font:700 9px system-ui,sans-serif;letter-spacing:.22em;text-anchor:middle;pointer-events:none;paint-order:stroke fill;stroke:#16281F;stroke-width:2.6px;stroke-linejoin:round}
.mapwrap text.home{fill:var(--gold)}.mapwrap text.away{fill:#EAF1EB}
.sec polygon{stroke:var(--s);stroke-width:.5}
.sec text{font-weight:600;font-family:system-ui,sans-serif;text-anchor:middle;fill:#16241E;opacity:.75;pointer-events:none}
.sec.context polygon{fill:#DDE3DB;stroke:var(--s);stroke-width:.4}
.sec.match polygon{fill:#4FB07E}.sec.closest polygon{fill:#F0B866}.sec.plain polygon{fill:#D5DCD3}
.sec.plain text{opacity:.45}
@media(prefers-color-scheme:dark){.sec polygon{stroke:#1A2A23}.sec text{fill:#0F1A15}
.sec.context polygon{fill:#1E2E27;stroke:#16241E}
.sec.match polygon{fill:#4FA87C}.sec.closest polygon{fill:#C89A5A}.sec.plain polygon{fill:#2C3E35}
.sec.plain text{fill:#AFBFB6;opacity:.55}}
.legend{display:grid;grid-template-columns:auto 1fr auto;gap:10px 12px;align-items:center;margin-top:14px}
.key{display:contents}.legend b{font-weight:600;font-size:.88rem}
.legend .n{color:var(--ink2);font-size:.83rem;text-align:right}
.sw{width:12px;height:12px;border-radius:2px;display:inline-block;flex:none}
.sw-match{background:#4FB07E}.sw-closest{background:#F0B866}
@media(prefers-color-scheme:dark){.sw-match{background:#4FA87C}.sw-closest{background:#C89A5A}}`;
