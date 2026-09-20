// Venue map: draws the stadium and shades each section by its cheapest listing,
// so the affordable parts of the ground are visible at a glance.
// renderMap is pure; loadVenue does the one file read and is called from cycle.mjs,
// keeping page.mjs free of IO.
import { readFileSync } from 'fs';

// Local copy so this module has no import cycle with page.mjs.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const VENUES = { lambeau: 'data/lambeau-map.json' };
const cache = new Map();

export function loadVenue(name, root = '.') {
  if (!VENUES[name]) return null;
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(`${root}/${VENUES[name]}`, 'utf8')));
  return cache.get(name);
}

// "Section 750S" / "741 S" / "Upper Level 336" / "336" -> "750s" / "741s" / "336"
// A trailing letter only counts as a section suffix when it stands alone: in
// "400 Standing Room Only" the S begins a word, and 400S is a different section.
export function sectionKey(label) {
  const s = String(label ?? '');
  const m = s.match(/(\d{3,4})\s*([A-Za-z])?/);
  if (!m) return null;
  const startsAWord = m[2] && /^[A-Za-z]/.test(s.slice(m.index + m[0].length));
  return m[2] && !startsAWord ? `${m[1]}${m[2].toLowerCase()}` : m[1];
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

// Four bands keyed off what Ruth is willing to pay, so the map re-scales with her cap.
export function band(price, priceMax) {
  if (price === undefined) return 'none';
  if (price <= priceMax + 0.005) return 'fits';
  if (price <= priceMax * 1.5) return 'near';
  return 'over';
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

export function renderMap(venue, { prices = {}, priceMax, quantity }) {
  if (!venue) return '';
  const f = venue.field;
  const ez = f.w / 12; // end zones: 10 of the field's 120 yards, each end
  const lines = [];
  for (let i = 1; i < 10; i++) {
    const x = f.x + ez + ((f.w - 2 * ez) * i) / 10;
    lines.push(`<line x1="${x.toFixed(1)}" y1="${f.y}" x2="${x.toFixed(1)}" y2="${(f.y + f.h).toFixed(1)}"/>`);
  }

  const counts = { fits: 0, near: 0, over: 0, none: 0 };
  const shapes = venue.sections.map(([, name, pts]) => {
    const price = prices[name];
    const b = band(price, priceMax);
    counts[b]++;
    const label = name.replace(/s$/, 'S').toUpperCase();
    const title = price === undefined
      ? `${label} — no ${quantity}-together listings`
      : `${label} — from $${price.toFixed(2)} each`;
    const c = centroid(pts);
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    // Only label a section with room for the text inside its own outline; the
    // rest answer on hover, which is better than a number spilling over its
    // neighbour.
    const roomy = c.area >= 235 && Math.max(...xs) - Math.min(...xs) >= 17 && Math.max(...ys) - Math.min(...ys) >= 12;
    const text = roomy ? `<text x="${c.x.toFixed(1)}" y="${(c.y + 2.4).toFixed(1)}">${esc(label)}</text>` : '';
    return `<g class="sec ${b}"><title>${esc(title)}</title>`
      + `<polygon points="${pts.map((p) => p.join(',')).join(' ')}"/>${text}</g>`;
  }).join('');

  const legend = [
    ['fits', `$${priceMax} or less`, counts.fits],
    ['near', `up to $${Math.round(priceMax * 1.5)}`, counts.near],
    ['over', 'more than that', counts.over],
    ['none', `no ${quantity} together`, counts.none],
  ].map(([k, t, n]) => `<span class="key"><i class="sw ${k}"></i>${esc(t)} <b>${n}</b></span>`).join('');

  return `<h2>Lambeau Field</h2>
<p class="crit">Every section shaded by its cheapest listing for ${esc(quantity)} together. Hover or tap a section for its price.</p>
<div class="mapwrap">
<svg viewBox="${esc(venue.viewBox)}" role="img" aria-label="Lambeau Field seating map, shaded by cheapest price per section">
<rect class="field" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="2"/>
<rect class="ez" x="${f.x}" y="${f.y}" width="${ez.toFixed(1)}" height="${f.h}"/>
<rect class="ez" x="${(f.x + f.w - ez).toFixed(1)}" y="${f.y}" width="${ez.toFixed(1)}" height="${f.h}"/>
<g class="yard">${lines.join('')}</g>
${shapes}
</svg>
<div class="legend">${legend}</div>
<p class="mapnote">Section positions measured from the venue map on the ticket listings page; drawn here from that layout. Not to scale, and not a substitute for the seller's own seating chart.</p>
</div>`;
}

export const MAP_CSS = `.mapwrap{background:var(--s);border:1px solid var(--rule);border-radius:3px;padding:16px;margin-top:10px}
.mapwrap svg{width:100%;height:auto;display:block}
.mapwrap .field{fill:#2C4A40;stroke:none}
.mapwrap .ez{fill:#223B33;stroke:none}
.mapwrap .yard line{stroke:var(--gold);stroke-width:.7;opacity:.35}
.sec polygon{stroke:var(--s);stroke-width:.5}
.sec text{font:600 6.5px system-ui,sans-serif;text-anchor:middle;fill:#16241E;opacity:.75;pointer-events:none}
.sec.fits polygon{fill:#7FCB9B}.sec.near polygon{fill:#F3C98B}.sec.over polygon{fill:#CBD4C8}.sec.none polygon{fill:#E7EBE5}
.sec.over text,.sec.none text{opacity:.5}
@media(prefers-color-scheme:dark){.sec polygon{stroke:#1A2A23}.sec text{fill:#0F1A15}
.sec.fits polygon{fill:#5FB184}.sec.near polygon{fill:#C89A5A}.sec.over polygon{fill:#46584E}.sec.none polygon{fill:#22352C}
.sec.over text,.sec.none text{fill:#AFBFB6;opacity:.6}}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:12px;font-size:.82rem;color:var(--ink2)}
.key{display:flex;align-items:center;gap:6px}.sw{width:12px;height:12px;border-radius:2px;display:inline-block}
.sw.fits{background:#7FCB9B}.sw.near{background:#F3C98B}.sw.over{background:#CBD4C8}.sw.none{background:#E7EBE5}
@media(prefers-color-scheme:dark){.sw.fits{background:#5FB184}.sw.near{background:#C89A5A}.sw.over{background:#46584E}.sw.none{background:#22352C}}
.mapnote{margin:10px 0 0;font-size:.78rem;color:var(--ink2);opacity:.85}`;
