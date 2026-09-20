import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionKey, sectionPrices, band, renderMap, loadVenue } from '../lib/map.mjs';

const venue = loadVenue('lambeau');
const seat = (o = {}) => ({ secLabel: '136', rowLabel: '5', price: 200, unassigned: false, ...o });

test('section labels reduce to the key used by the map', () => {
  assert.equal(sectionKey('Section 750S'), '750s');
  assert.equal(sectionKey('741 S'), '741s');
  assert.equal(sectionKey('Upper Level 336'), '336');
  assert.equal(sectionKey('336'), '336');
});

test('a letter that begins a word is not a section suffix', () => {
  // 400S is a real section; "400 Standing Room Only" is not in it.
  assert.equal(sectionKey('400 Standing Room Only'), '400');
  assert.equal(sectionKey('400 STANDING ROOM ONLY'), '400');
});

test('labels with no section number have no key', () => {
  for (const l of ['GA', '', null, undefined]) assert.equal(sectionKey(l), null);
});

test('each section keeps its cheapest listing', () => {
  const prices = sectionPrices([seat({ price: 260 }), seat({ price: 203 }), seat({ secLabel: '750S', price: 310 })]);
  assert.equal(prices['136'], 203);
  assert.equal(prices['750s'], 310);
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

test('the map draws every section exactly once, plus the field', () => {
  const svg = renderMap(venue, { prices: {}, priceMax: 150, quantity: 3 });
  assert.equal((svg.match(/class="sec /g) ?? []).length, venue.sections.length);
  assert.equal(venue.sections.length, 168);
  assert.match(svg, /class="field"/);
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
