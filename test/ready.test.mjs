import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notReadyReason, isReady } from '../lib/ready.mjs';

const s = (o = {}) => ({ label: 'Live Prices', qtyText: '2 Seats', n: 12000, sources: ['gametime', 'vividseats'], unsellable: 0, ...o });

test('refreshing is not ready (cold load showed partial data under this label)', () => {
  assert.match(notReadyReason(s({ label: 'Refreshing Marketplaces' }), 2), /page status/);
});

test('missing status label is not ready', () => {
  assert.match(notReadyReason(s({ label: null }), 2), /page status/);
});

test('wrong seat selector is not ready', () => {
  assert.match(notReadyReason(s({ qtyText: '2 Seats' }), 3), /seat selector/);
  assert.equal(notReadyReason(s({ qtyText: '1 Seat' }), 1), null);
});

test('data still filtered for the old quantity is not ready', () => {
  assert.match(notReadyReason(s({ unsellable: 40 }), 2), /not sellable/);
});

test('empty list is not ready', () => {
  assert.match(notReadyReason(s({ n: 0 }), 2), /no listings/);
});

test('one good sample is not enough', () => {
  assert.equal(isReady(null, s(), 2), false);
});

test('two identical good samples are ready', () => {
  assert.equal(isReady(s(), s(), 2), true);
});

test('a marketplace arriving between samples is not ready', () => {
  assert.equal(isReady(s(), s({ sources: ['event365', 'gametime', 'vividseats'] }), 2), false);
});

test('count still moving is not ready', () => {
  assert.equal(isReady(s({ n: 11982 }), s({ n: 12089 }), 2), false);
});

test('a good sample after a refreshing one is not ready yet', () => {
  assert.equal(isReady(s({ label: 'Refreshing Marketplaces' }), s(), 2), false);
});
