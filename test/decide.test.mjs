import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, validate, decide, sourceOf, isSafeLink, isUnassigned } from '../lib/decide.mjs';

const raw = (o = {}) => ({ id: 'X1vividseats', secLabel: '327', rowLabel: '19', allIn: 90, splits: [2], link: 'https://example.com/buy', ...o });
const W = { id: 't', quantity: 2, priceMax: 100, closest: 3 };

test('a missing price is rejected, never a $0 match', () => {
  const { listings, rejected } = normalize([raw({ allIn: null }), raw({ allIn: undefined }), raw({ allIn: NaN }), raw({ allIn: 0 }), raw({ allIn: -5 }), raw({ allIn: '' })], 2);
  assert.equal(listings.length, 0);
  assert.equal(rejected.price, 6);
});

test('numeric-string prices are accepted', () => {
  const { listings } = normalize([raw({ allIn: '95.50' })], 2);
  assert.equal(listings[0].price, 95.5);
});

test('listings that cannot sell the quantity are rejected and fail validation', () => {
  const n = normalize([raw({ splits: [1, 3] }), raw(), raw(), raw()], 2);
  assert.equal(n.rejected.quantity, 1);
  assert.match(validate({ rawCount: 4, rejected: n.rejected }, W), /seat filter did not apply/);
});

test('splits given as strings still count', () => {
  assert.equal(normalize([raw({ splits: ['2', '4'] })], 2).listings.length, 1);
});

test('a small market is valid: listings shrink as seats sell', () => {
  assert.equal(validate({ rawCount: 2, rejected: { price: 0, quantity: 0 } }, W), null);
});

test('an empty read fails validation', () => {
  assert.match(validate({ rawCount: 0, rejected: { price: 0, quantity: 0 } }, W), /no listings/);
});

test('one missing marketplace is allowed; two is too much unchecked', () => {
  const clean = { price: 0, quantity: 0 };
  assert.equal(validate({ rawCount: 500, rejected: clean, missing: [{ site: 'event365', why: 'HTTP 502' }] }, W), null);
  assert.match(validate({ rawCount: 500, rejected: clean, missing: [{ site: 'event365' }, { site: 'viagogo' }] }, W), /2 marketplaces did not answer \(event365, viagogo\)/);
});

test('more than 1% unpriced listings fails; a stray one does not', () => {
  assert.match(validate({ rawCount: 100, rejected: { price: 2, quantity: 0 } }, W), /no usable all-in price/);
  assert.equal(validate({ rawCount: 1000, rejected: { price: 1, quantity: 0 } }, W), null);
});

test('price limit is inclusive and cent-tolerant', () => {
  const { listings } = normalize([raw({ id: 'a', allIn: 100 }), raw({ id: 'b', allIn: 100.004 }), raw({ id: 'c', allIn: 100.01 })], 2);
  const { matches, closest } = decide(listings, W);
  assert.deepEqual(matches.map((m) => m.id), ['a', 'b']);
  assert.deepEqual(closest.map((m) => m.id), ['c']);
});

test('matches are sorted cheapest first, ties broken by id for stable output', () => {
  const { listings } = normalize([raw({ id: 'z', allIn: 95 }), raw({ id: 'b', allIn: 90 }), raw({ id: 'a', allIn: 90 })], 2);
  assert.deepEqual(decide(listings, W).matches.map((m) => m.id), ['a', 'b', 'z']);
});

test('closest shows only above-limit listings, capped', () => {
  const r = [101, 102, 103, 104, 105].map((p, i) => raw({ id: `i${i}`, allIn: p }));
  const { matches, closest } = decide(normalize(r, 2).listings, W);
  assert.equal(matches.length, 0);
  assert.deepEqual(closest.map((c) => c.price), [101, 102, 103]);
});

test('unsafe links are dropped, not rendered', () => {
  assert.equal(isSafeLink('javascript:alert(1)'), false);
  assert.equal(isSafeLink('http://plain.example'), false);
  assert.equal(isSafeLink('https://ok.example/a?b=1'), true);
  assert.equal(normalize([raw({ link: 'javascript:alert(1)' })], 2).listings[0].link, null);
});

test('marketplace comes from the id suffix', () => {
  assert.equal(sourceOf('VB17177429238vividseats'), 'vividseats');
  assert.equal(sourceOf('6461071221event365'), 'event365');
  assert.equal(sourceOf('???'), 'other');
  assert.equal(sourceOf(undefined), 'other');
});

test('seat-not-yet-assigned listings are recognised (observed live)', () => {
  assert.equal(isUnassigned({ secLabel: '301–306–OR–346–350', rowLabel: 'TBD' }), true);
  assert.equal(isUnassigned({ secLabel: 'Upper Level 327', rowLabel: '19' }), false);
  assert.equal(isUnassigned({ secLabel: '327', rowLabel: '' }), true);
});

test('section and row filters, when set, exclude unknown locations', () => {
  const w = { ...W, sections: [327], rowMax: 20 };
  const { listings } = normalize([
    raw({ id: 'in', secLabel: 'Upper Level 327', rowLabel: '19' }),
    raw({ id: 'row', secLabel: '327', rowLabel: '21' }),
    raw({ id: 'zone', secLabel: '301–306–OR–346–350', rowLabel: 'TBD' }),
    raw({ id: 'other', secLabel: '328', rowLabel: '1' }),
  ], 2);
  assert.deepEqual(decide(listings, w).matches.map((m) => m.id), ['in']);
});

test('without section or row filters, every located or unassigned seat counts', () => {
  const { listings } = normalize([raw({ id: 'zone', secLabel: '301–306–OR–346–350', rowLabel: 'TBD' })], 2);
  assert.equal(decide(listings, W).matches.length, 1);
});

// ---- preferred lists (Sep 15; split by row Sep 18) ----
import { decideAll, alertList } from '../lib/decide.mjs';

const SECTIONS = [337, 338, 339, 340, 236, 237, 239, 240, 135, 137, 139, 140];
const PREF = { ...W, priceMax: 100, preferred: [
  { id: 'row1', label: 'Preferred sections, row 1', sections: SECTIONS, rowMax: 1, priceMax: 150, alerts: true },
  { id: 'rows', label: 'Preferred sections, any other row', sections: SECTIONS, rowMin: 2, priceMax: 150 },
] };
const market = () => normalize([
  raw({ id: 'r1', secLabel: 'Mezzanine 237', rowLabel: '1', allIn: 130 }),     // preferred, row 1: first list
  raw({ id: 'r1b', secLabel: '340', rowLabel: '1', allIn: 160 }),              // row 1 over price: closest there
  raw({ id: 'p1', secLabel: 'Upper Level 339', rowLabel: '24', allIn: 98 }),   // preferred, other row
  raw({ id: 'p2', secLabel: '137', rowLabel: '3', allIn: 150 }),               // other row, exactly at the limit
  raw({ id: 'g1', secLabel: '327', rowLabel: '19', allIn: 90 }),               // general match
  raw({ id: 'g2', secLabel: '138', rowLabel: '1', allIn: 95 }),                // skipped section: general
  raw({ id: 'z1', secLabel: '337–340–OR–135–137', rowLabel: 'TBD', allIn: 80 }),// unassigned: never preferred
  raw({ id: 'g3', secLabel: '301', rowLabel: '1', allIn: 150 }),               // general closest
], 2).listings;
const ids = (l) => l.map((m) => m.id);

test('row 1 and other rows are separate lists, and no seat is in both', () => {
  const { lists, general } = decideAll(market(), PREF);
  assert.deepEqual(lists.map((l) => l.id), ['row1', 'rows']);
  assert.deepEqual(ids(lists[0].matches), ['r1']);
  assert.deepEqual(ids(lists[0].closest), ['r1b']);
  assert.deepEqual(ids(lists[1].matches), ['p1', 'p2']);
  assert.deepEqual(ids(general.matches), ['z1', 'g1', 'g2']);
  const all = [...lists.flatMap((l) => [...l.matches, ...l.closest]), ...general.matches, ...general.closest].map((m) => m.id);
  assert.equal(new Set(all).size, all.length, 'no listing appears in two lists');
});

test('a row-1 seat never falls into the any-other-row list, even when over its price', () => {
  const { lists } = decideAll(market(), PREF);
  assert.ok(!ids([...lists[1].matches, ...lists[1].closest]).includes('r1b'));
});

test('a section missing from the list (138) is in neither preferred list', () => {
  const { lists } = decideAll(market(), PREF);
  assert.ok(!lists.some((l) => ids(l.matches).includes('g2')));
});

test('an unassigned listing naming preferred sections is still not preferred', () => {
  assert.ok(decideAll(market(), PREF).general.matches.some((m) => m.id === 'z1'));
});

test('alerts follow the list marked alerts, and only it', () => {
  const d = decideAll(market(), PREF);
  assert.equal(alertList(PREF, d), d.lists[0]);
  const noAlertFlag = { ...PREF, preferred: PREF.preferred.map((l) => ({ ...l, alerts: false })) };
  const d2 = decideAll(market(), noAlertFlag);
  assert.equal(alertList(noAlertFlag, d2), d2.general);
  const noPref = decideAll(market(), W);
  assert.deepEqual(noPref.lists, []);
  assert.equal(alertList(W, noPref), noPref.general);
});

test('seats in the other lists never alert', () => {
  const others = normalize([
    raw({ id: 'g', secLabel: '327', rowLabel: '4', allIn: 90 }),
    raw({ id: 'p', secLabel: '339', rowLabel: '9', allIn: 120 }),
  ], 2).listings;
  assert.equal(alertList(PREF, decideAll(others, PREF)).matches.length, 0);
});

test('a row rule rejects rows that are not numbers', () => {
  const tbd = normalize([raw({ id: 't', secLabel: '339', rowLabel: 'TBD', allIn: 90 })], 2).listings;
  const { lists } = decideAll(tbd, PREF);
  assert.equal(lists[0].matches.length + lists[1].matches.length, 0);
});
