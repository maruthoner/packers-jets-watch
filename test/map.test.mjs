import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionKey, sectionPrices, highlightedSections, renderMap, loadVenue } from '../lib/map.mjs';

const venue = loadVenue('lambeau');
// "7 sections" / "none right now" -> 7 / 0, across the legend rows.
const legendCounts = (html) => [...html.matchAll(/<span class="n">([^<]*)<\/span>/g)]
  .map((m) => (m[1] === 'none right now' ? 0 : Number(m[1].match(/\d+/)[0])));
const shade = (html, section) => (html.match(new RegExp(`class="sec (\\w+)"><title>${section} `)) ?? [])[1];

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

test('the sections named in the lists are the ones highlighted', () => {
  const result = { lists: [
    { matches: [{ secLabel: '120' }], closest: [{ secLabel: 'Lower Level 119' }] },
    { matches: [], closest: [{ secLabel: '121' }, { secLabel: '324' }] },
  ] };
  const { match, closest } = highlightedSections(result);
  assert.deepEqual([...match], ['120']);
  assert.deepEqual([...closest].sort(), ['119', '121', '324']);
});

test('a watcher with no lists falls back to its own matches and closest', () => {
  const { match, closest } = highlightedSections({ matches: [{ secLabel: '743S' }], closest: [{ secLabel: '637S' }] });
  assert.deepEqual([...match], ['743']);
  assert.deepEqual([...closest], ['637']);
});

test('a listing with no section number highlights nothing', () => {
  const { match } = highlightedSections({ matches: [{ secLabel: 'GA' }, { secLabel: '' }] });
  assert.equal(match.size, 0);
});

test('the map draws every section and every context shape exactly once, plus the field', () => {
  const svg = renderMap(venue, { prices: {}, quantity: 2 });
  const seating = (svg.match(/class="sec (?:match|closest|plain)"/g) ?? []).length;
  const context = (svg.match(/class="sec context"/g) ?? []).length;
  assert.equal(seating, venue.sections.length);
  assert.equal(context, venue.context.length);
  assert.equal(venue.sections.length, 169);
  assert.ok(venue.context.length > 150, 'suites and lounges are drawn as context');
  assert.match(svg, /class="field"/);
});

test('the legend counts only what is highlighted, never a suite', () => {
  const svg = renderMap(venue, { prices: {}, quantity: 2, match: new Set(['120']), closest: new Set(['119', '121']) });
  assert.deepEqual(legendCounts(svg), [1, 2], 'one match, two closest');
  assert.equal((svg.match(/class="sec context"/g) ?? []).length, venue.context.length, 'suites are drawn but never counted');
});

test('every section is numbered, at a size that fits it', () => {
  const svg = renderMap(venue, { prices: {}, quantity: 2 });
  // Section numbers open with x=; the two sideline labels carry a class.
  assert.equal((svg.match(/<text x=/g) ?? []).length, venue.sections.length);
});

test('a section that is not in a list is left plain, whatever it costs', () => {
  // The map no longer prices the whole stadium (Ruth, Sep 23).
  const svg = renderMap(venue, { prices: { '136': 140, '103': 4000 }, quantity: 2, match: new Set(['120']) });
  assert.equal(shade(svg, '136'), 'plain', 'a cheap section nobody listed stays plain');
  assert.equal(shade(svg, '103'), 'plain');
  assert.equal(shade(svg, '120'), 'match');
});

test('a highlighted section still shows its price on hover', () => {
  const svg = renderMap(venue, { prices: { '136': 140 }, quantity: 2, match: new Set(['136']) });
  assert.match(svg, /class="sec match"><title>136 — from \$140\.00 each<\/title>/);
});

test('no venue renders nothing rather than a broken map', () => {
  assert.equal(renderMap(null, { quantity: 2 }), '');
  assert.equal(loadVenue('nope'), null);
});

test('a section listed without its letter still lines up with the map', () => {
  // The live regression: sections priced as "634", drawn as "634s", matched as neither.
  const { match } = highlightedSections({ matches: [{ secLabel: '634' }] });
  const svg = renderMap(venue, { prices: sectionPrices([seat({ secLabel: '634', price: 140 })]), quantity: 2, match });
  assert.match(svg, /class="sec match"><title>634S — from \$140\.00 each<\/title>/);
});

test('each sideline is labelled on the edge its own sections sit nearest', () => {
  const svg = renderMap(venue, { prices: {}, quantity: 2 });
  const sides = [...svg.matchAll(/<text class="side (home|away)" x="[\d.]+" y="([\d.]+)">([A-Z ]+)<\/text>/g)]
    .map((m) => [m[3], Number(m[2]), m[1]]);
  assert.equal(sides.length, 2);
  const packers = sides.find(([n]) => n === 'PACKERS SIDE');
  const visitor = sides.find(([n]) => n === 'VISITOR SIDE');
  assert.ok(packers && visitor, 'both sidelines are named');
  // Even sections 110-130 are drawn above the field on this map, odd 109-129 below.
  assert.ok(packers[1] < visitor[1], 'Packers side is on the edge nearest sections 110-130');
  assert.equal(packers[2], 'home');
  assert.equal(visitor[2], 'away');
  const y = (n) => venue.sections.find((s) => s[1] === n)[2].reduce((a, p) => a + p[1], 0) / 12;
  assert.ok(y('120') < y('119'), 'the map really does put the even sections on top');
});

test('a legend swatch is a swatch, not a results box', () => {
  // `class="sw none"` also matched the page's .none box rule, which padded the
  // fourth swatch to three times the size of the other three.
  const svg = renderMap(venue, { prices: {}, quantity: 2 });
  assert.match(svg, /<i class="sw sw-match"><\/i>/);
  assert.doesNotMatch(svg, /class="sw (match|closest|plain)"/);
});
