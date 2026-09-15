import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, validate, decide, sourceOf, isSafeLink, isUnassigned } from '../lib/decide.mjs';

const raw = (o = {}) => ({ id: 'X1vividseats', secLabel: '327', rowLabel: '19', allIn: 90, splits: [2], link: 'https://example.com/buy', ...o });
const W = { id: 't', quantity: 2, priceMax: 100, minListings: 3, closest: 3 };

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

test('too few listings fails validation', () => {
  assert.match(validate({ rawCount: 2, rejected: { price: 0, quantity: 0 } }, W), /only 2 listings/);
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
