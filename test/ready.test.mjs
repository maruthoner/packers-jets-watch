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

import { classifyFeed, feedSite, feedsPending, feedsFailed } from '../lib/ready.mjs';

const answer = (o = {}) => JSON.stringify({ count: 2, site_name: 'event365', platform_stats: [{ status: 200, tickets_num: 2 }],
  ticketnetwork_map_tickets: [{}, {}], status: 200, message: 'Fetched successfully', ...o });

test('a successful marketplace answer counts its tickets', () => {
  assert.deepEqual(classifyFeed({ httpStatus: 200, body: answer() }), { ok: true, tickets: 2 });
});

test('zero tickets is a valid answer, not a failure', () => {
  assert.deepEqual(classifyFeed({ httpStatus: 200, body: answer({ ticketnetwork_map_tickets: [], platform_stats: [{ status: 200 }] }) }), { ok: true, tickets: 0 });
});

test('marketplace answers that did not deliver are failures', () => {
  assert.equal(classifyFeed({ httpStatus: 502, body: '' }).ok, false);
  assert.equal(classifyFeed({ httpStatus: 200, body: '<html>' }).ok, false);
  assert.equal(classifyFeed({ httpStatus: 200, body: 'null' }).ok, false);
  assert.match(classifyFeed({ httpStatus: 200, body: answer({ status: 500, message: 'upstream timeout' }) }).why, /upstream timeout/);
  assert.equal(classifyFeed({ httpStatus: 200, body: answer({ platform_stats: [{ status: 504 }] }) }).ok, false);
  assert.equal(classifyFeed({ httpStatus: 200, body: answer({ ticketnetwork_map_tickets: undefined }) }).ok, false);
});

test('marketplace name comes from the request, case-insensitively', () => {
  assert.equal(feedSite('https://api-v2.ticketwhiz.com/data/real-time-platform/?site_name=TicketNetwork&event_id=x&seats=0'), 'ticketnetwork');
  assert.equal(feedSite('not a url'), null);
});

test('pending and failed marketplaces are listed', () => {
  const feeds = { stubhub: { state: 'ok', tickets: 3 }, viagogo: { state: 'pending' }, event365: { state: 'failed', why: 'HTTP 502' } };
  assert.deepEqual(feedsPending(feeds), ['viagogo']);
  assert.deepEqual(feedsFailed(feeds), [{ site: 'event365', why: 'HTTP 502' }]);
});

import { emptyPageReason } from '../lib/ready.mjs';

test('an empty page after every marketplace settled says which side was empty', () => {
  const empty = { ...s(), n: 0, sources: [] };
  assert.match(emptyPageReason({ a: { state: 'ok', tickets: 0 }, b: { state: 'ok', tickets: 0 } }, empty), /every marketplace answered with 0 tickets/);
  assert.match(emptyPageReason({ a: { state: 'ok', tickets: 0 }, b: { state: 'failed', why: 'HTTP 502' } }, empty), /1 marketplace failed/);
  assert.match(emptyPageReason({ a: { state: 'ok', tickets: 1200 }, b: { state: 'ok', tickets: 34 } }, empty), /returned 1,234 tickets but the page listed none/);
});

test('not an empty-page failure while listings exist or marketplaces are still answering', () => {
  assert.equal(emptyPageReason({ a: { state: 'ok', tickets: 5 } }, s()), null);
  assert.equal(emptyPageReason({ a: { state: 'pending' } }, { ...s(), n: 0 }), null);
  assert.equal(emptyPageReason({}, { ...s(), n: 0 }), null);
});
