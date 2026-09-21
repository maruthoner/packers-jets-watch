// Usage: node tools/extract-map.mjs <watcher-id>
// Rebuilds data/<venue>-map.json from the seating map on the event page.
//
// Each section is stored as its own outline (a short list of points), not as a
// bounding box: real sections are angled wedges, and boxes drawn round them
// overlap their neighbours and cover the field.
//
// Two lists come out of this. `sections` is seating we can price and shade.
// `context` is everything else the stadium is made of — suites and the two
// lounges — drawn greyed underneath so the empty rings read as part of the
// building rather than as holes in the map (Ruth, Sep 20).
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';
import { WATCHERS } from '../watchers.mjs';

const id = process.argv[2] ?? 'falcons';
const W = WATCHERS[id];
if (!W?.venueMap) {
  console.error(`usage: node tools/extract-map.mjs <${Object.keys(WATCHERS).filter((k) => WATCHERS[k].venueMap).join('|')}>`);
  process.exit(2);
}

// Runs in the page. Samples each section path into a polygon.
function readMap({ points }) {
  const svg = document.querySelector('svg.venue-map-svg');
  if (!svg) return { error: 'no venue map on the page' };
  // Zones holding seats this watcher can match. Everything else is context.
  const SEATING = new Set(['low', '300_lvl', 'up_end', 'mid_end', 'low_end', 'club', 'mlpd']);
  const round = (n) => Math.round(n * 10) / 10;

  // Section ids look like sec_<zone>_<name>_<zone>; zones themselves contain
  // underscores (300_lvl), so the zone is matched by backreference.
  const best = new Map();
  for (const el of svg.querySelectorAll('path[id]')) {
    // sec_<zone>_<name>_<zone>, or sec_<name>_<name> for the two lounges.
    const m = el.id.match(/^sec_(.+)_([A-Za-z0-9]+)_\1$/) || el.id.match(/^sec_(.+)_\1$/);
    if (!m) continue;
    if (m[2] === undefined) m[2] = m[1];
    let len = 0;
    try { len = el.getTotalLength(); } catch { continue; }
    if (!len) continue;
    const key = `${m[1]}|${m[2]}`;
    // A section can be drawn more than once (fill plus outline); keep the largest.
    if (best.has(key) && best.get(key).len >= len) continue;
    const pts = [];
    for (let i = 0; i < points; i++) {
      const p = el.getPointAtLength((len * i) / points);
      pts.push([round(p.x), round(p.y)]);
    }
    best.set(key, { zone: m[1], name: m[2], len, pts, seating: SEATING.has(m[1]) });
  }

  // Their map has no field element, only sections. The field is the space the
  // lower bowl encloses: the largest rectangle, at the real proportions of a
  // football field including its end zones, that no seating intrudes on.
  const FIELD_ASPECT = 120 / 53.333; // length : width, in yards
  const pts = [...best.values()].filter((s) => s.zone === 'low').flatMap((s) => s.pts);
  const span = (i) => [Math.min(...pts.map((p) => p[i])), Math.max(...pts.map((p) => p[i]))];
  const [x0, x1] = span(0), [y0, y1] = span(1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const half = Math.min(...pts.map((p) => Math.max(Math.abs(p[0] - cx) / FIELD_ASPECT, Math.abs(p[1] - cy))));
  const field = {
    x: round(cx - half * FIELD_ASPECT), y: round(cy - half),
    w: round(half * FIELD_ASPECT * 2), h: round(half * 2),
  };

  // The map is sized by width/height, not a viewBox, so build one from them.
  const vb = svg.getAttribute('viewBox')
    || `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`;
  const all = [...best.values()];
  return {
    viewBox: vb, field,
    sections: all.filter((s) => s.seating).map((s) => [s.zone, s.name, s.pts]),
    context: all.filter((s) => !s.seating).map((s) => [s.zone.endsWith('_ste') ? `Suite ${s.name}` : '', s.pts]),
  };
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(W.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('svg.venue-map-svg path[id]', { timeout: 60000 });
  await page.waitForTimeout(2000);
  const map = await page.evaluate(readMap, { points: 12 });
  if (map.error) throw new Error(map.error);
  if (!map.sections.length) throw new Error('no sections found');
  if (!map.field) throw new Error('no field found');
  const out = `data/${W.venueMap}-map.json`;
  writeFileSync(out, JSON.stringify({
    note: 'Section outlines measured from the seating map on the event listings page. Rebuild with: node tools/extract-map.mjs ' + id,
    viewBox: map.viewBox, field: map.field, sections: map.sections, context: map.context,
  }, null, 0));
  const zones = {};
  for (const [z] of map.sections) zones[z] = (zones[z] ?? 0) + 1;
  console.log(`wrote ${out}: ${map.sections.length} seating sections`, zones);
  console.log(`plus ${map.context.length} context shapes (suites and lounges)`);
  console.log('viewBox', map.viewBox, 'field', map.field);
} finally {
  await browser.close();
}
