import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionKey, sectionPrices, band, renderMap, loadVenue } from '../lib/map.mjs';

const venue = loadVenue('lambeau');
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
  const counts = [...svg.matchAll(/class="key"><i class="sw \w+"><\/i>[^<]*<b>(\d+)<\/b>/g)].map((m) => Number(m[1]));
  assert.equal(counts.reduce((a, b) => a + b, 0), venue.sections.length);
});

test('every section is numbered, at a size that fits it', () => {
  const svg = renderMap(venue, { prices: {}, priceMax: 150, quantity: 3 });
  assert.equal((svg.match(/<text /g) ?? []).length, venue.sections.length);
});

test('legend counts account for every section', () => {
  const prices = { '136': 140, '750s': 200, '103': 400 };
  const svg = renderMap(venue, { prices, priceMax: 150, quantity: 3 });
  const counts = [...svg.matchAll(/class="key"><i class="sw (\w+)"><\/i>[^<]*<b>(\d+)<\/b>/g)].map((m) => Number(m[2]));
  assert.equal(counts.reduce((a, b) => a + b, 0), venue.sections.length);
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
