import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionKey, sectionPrices, band, renderMap, loadVenue } from '../lib/map.mjs';

const venue = loadVenue('lambeau');
// "7 sections" / "none right now" -> 7 / 0, summed across the four bands.
const legendTotal = (html) => [...html.matchAll(/<span class="n">([^<]*)<\/span>/g)]
  .reduce((t, m) => t + (m[1] === 'none right now' ? 0 : Number(m[1].match(/\d+/)[0])), 0);

const seat = (o = {}) => ({ secLabel: '136', rowLabel: '5', price: 200, unassigned: false, ...o });

test('a section number is the same key whichever way it is written', () => {
  // Sellers list the same seats as both "634" and "634S"; the venue calls it 634s.
  for (const l of ['Section 750S', '741 S', 'Upper Level 336', '336', '634', '634S', '634s']) {
    assert.equal(sectionKey(l), l.match(/\d+/)[0]);
  }
});

test('the venue and the seller meet on the same key', () => {
  const names = venue.sections.map((s) => s[1]);
  assert.ok(names.includes('634s'));
  assert.equal(sectionKey('634s'), sectionKey('Section 634'));
});

test('labels with no section number have no key', () => {
  for (const l of ['GA', '', null, undefined]) assert.equal(sectionKey(l), null);
});

test('each section keeps its cheapest listing', () => {
  const prices = sectionPrices([seat({ price: 260 }), seat({ price: 203 }), seat({ secLabel: '750S', price: 310 })]);
  assert.equal(prices['136'], 203);
  assert.equal(prices['750'], 310);
});

test('listings with no assigned seat never colour a section', () => {
  const prices = sectionPrices([seat({ secLabel: '400 Standing Room Only', price: 99, unassigned: true })]);
  assert.deepEqual(prices, {});
});

test('bands are relative to the price cap', () => {
  assert.equal(band(150, 150), 'fits');
  assert.equal(band(150.004, 150), 'fits'); // cent-level rounding must not miss
  assert.equal(band(151, 150), 'near');
  assert.equal(band(225, 150), 'near');
  assert.equal(band(226, 150), 'over');
  assert.equal(band(undefined, 150), 'none');
});

test('the map draws every section and every context shape exactly once, plus the field', () => {
  const svg = renderMap(venue, { prices: {}, priceMax: 150, quantity: 3 });
  const seating = (svg.match(/class="sec (?:fits|near|over|none)"/g) ?? []).length;
  const context = (svg.match(/class="sec context"/g) ?? []).length;
  assert.equal(seating, venue.sections.length);
  assert.equal(context, venue.context.length);
  assert.equal(venue.sections.length, 169);
  assert.ok(venue.context.length > 150, 'suites and lounges are drawn as context');
  assert.match(svg, /class="field"/);
});

test('context shapes are never priced or counted in the legend', () => {
  // A suite number must not steal the shading of a seating section.
  const svg = renderMap(venue, { prices: {}, priceMax: 150, quantity: 3 });
  assert.equal(legendTotal(svg), venue.sections.length);
});

test('every section is numbered, at a size that fits it', () => {
  const svg = renderMap(venue, { prices: {}, priceMax: 150, quantity: 3 });
  // Section numbers open with x=; the two sideline labels carry a class.
  assert.equal((svg.match(/<text x=/g) ?? []).length, venue.sections.length);
});

test('legend counts account for every section', () => {
  const prices = { '136': 140, '750s': 200, '103': 400 };
  const svg = renderMap(venue, { prices, priceMax: 150, quantity: 3 });
  assert.equal(legendTotal(svg), venue.sections.length);
});

test('a section with a fitting price is shaded as fitting', () => {
  const svg = renderMap(venue, { prices: { '136': 140 }, priceMax: 150, quantity: 3 });
  assert.match(svg, /class="sec fits"><title>136 — from \$140\.00 each<\/title>/);
});

test('no venue renders nothing rather than a broken map', () => {
  assert.equal(renderMap(null, { priceMax: 150, quantity: 3 }), '');
  assert.equal(loadVenue('nope'), null);
});

test('a section listed without its letter still shades that section', () => {
  // The live regression: 27 sections priced as "634", drawn as "634s", shaded as neither.
  const svg = renderMap(venue, { prices: sectionPrices([seat({ secLabel: '634', price: 140 })]), priceMax: 150, quantity: 3 });
  assert.match(svg, /class="sec fits"><title>634S — from \$140\.00 each<\/title>/);
});

test('each sideline is labelled on the edge its own sections sit nearest', () => {
  const svg = renderMap(venue, { prices: {}, priceMax: 150, quantity: 3 });
  const sides = [...svg.matchAll(/<text class="side" x="[\d.]+" y="([\d.]+)">([A-Z ]+)<\/text>/g)]
    .map((m) => [m[2], Number(m[1])]);
  assert.equal(sides.length, 2);
  const packers = sides.find(([n]) => n === 'PACKERS SIDE');
  const visitor = sides.find(([n]) => n === 'VISITOR SIDE');
  assert.ok(packers && visitor, 'both sidelines are named');
  // Even sections 110-130 are drawn above the field on this map, odd 109-129 below.
  assert.ok(packers[1] < visitor[1], 'Packers side is on the edge nearest sections 110-130');
  const y = (n) => venue.sections.find((s) => s[1] === n)[2].reduce((a, p) => a + p[1], 0) / 12;
  assert.ok(y('120') < y('119'), 'the map really does put the even sections on top');
});

test('a legend swatch is a swatch, not a results box', () => {
  // `class="sw none"` also matched the page's .none box rule, which padded the
  // fourth swatch to three times the size of the other three.
  const svg = renderMap(venue, { prices: {}, priceMax: 150, quantity: 3 });
  assert.match(svg, /<i class="sw sw-none"><\/i>/);
  assert.doesNotMatch(svg, /class="sw (fits|near|over|none)"/);
});
