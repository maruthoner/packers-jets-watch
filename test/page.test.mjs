import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../lib/page.mjs';

const W = { id: 'jets', title: 'Packers at Jets', subtitle: 'Sun', quantity: 2, priceMax: 100 };
const listing = (o = {}) => ({ id: 'a', price: 90, secLabel: '327', rowLabel: '19', link: 'https://buy', unassigned: false, ...o });
const result = (o = {}) => ({ when: 'Sep 14, 9:09 PM ET', listings: 12000, matches: [listing()], closest: [], ...o });

test('hostile text from the marketplace is escaped', () => {
  const html = renderPage(W, { result: result({ matches: [listing({ secLabel: '<script>alert(1)</script>', rowLabel: '"><img src=x onerror=1>' })] }), state: {}, others: [] });
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
});

test('a listing with no safe link renders without a buy button', () => {
  const html = renderPage(W, { result: result({ matches: [listing({ link: null })] }), state: {}, others: [] });
  assert.ok(!html.includes('class="buy"'));
});

test('a failed latest check is shown, with the last good data still visible', () => {
  const html = renderPage(W, {
    result: result(),
    state: { lastSuccessISO: '2026-09-15T00:00:00Z', lastFailure: { whenISO: '2026-09-15T01:00:00Z', reason: 'blocked' } },
    others: [],
  });
  assert.match(html, /latest check failed/);
  assert.match(html, /blocked/);
  assert.match(html, /\$90\.00/);
});

test('an older failure followed by success shows no warning', () => {
  const html = renderPage(W, {
    result: result(),
    state: { lastSuccessISO: '2026-09-15T02:00:00Z', lastFailure: { whenISO: '2026-09-15T01:00:00Z', reason: 'blocked' } },
    others: [],
  });
  assert.ok(!html.includes('latest check failed'));
});

test('many matches are capped on the page with a count', () => {
  const matches = Array.from({ length: 14 }, (_, i) => listing({ id: `m${i}`, price: 80 + i / 10 }));
  const html = renderPage(W, { result: result({ matches }), state: {}, others: [] });
  assert.equal((html.match(/class="find hit"/g) || []).length, 10);
  assert.match(html, /4 more listings fit/);
});

test('unassigned seats are labelled on the page', () => {
  const html = renderPage(W, { result: result({ matches: [listing({ secLabel: '301–306–OR–346–350', rowLabel: 'TBD', unassigned: true })] }), state: {}, others: [] });
  assert.match(html, /exact seats not assigned yet/);
});

const lists = (o = {}) => [
  { id: 'row1', label: 'Row 1', sections: [339, 137], rowMax: 1, priceMax: 150,
    matches: [listing({ id: 'r', secLabel: '339', rowLabel: '1', price: 128 })], closest: [], ...(o.row1 ?? {}) },
  { id: 'rows', label: 'Any row', sections: [339, 137], rowMin: 2, priceMax: 150,
    matches: [listing({ id: 'p', secLabel: '137', rowLabel: '24', price: 98 })], closest: [], ...(o.rows ?? {}) },
];

test('each preferred list gets its own heading and criteria, in order, above other sections', () => {
  const w = { ...W, preferred: [{}, {}] };
  const html = renderPage(w, { result: result({ lists: lists(), matches: [listing({ id: 'g', secLabel: '327', price: 90 })] }), state: {}, others: [] });
  const row1 = html.indexOf('<h2>Row 1</h2>');
  const rows = html.indexOf('<h2>Any row</h2>');
  const general = html.indexOf('Other sections');
  assert.ok(row1 > 0 && rows > row1 && general > rows, 'row 1, then other rows, then other sections');
  assert.match(html.slice(row1, rows), /row 1 only/);
  assert.match(html.slice(row1, rows), /339 &middot; Row 1/);
  assert.match(html.slice(rows, general), /any row except row 1/);
  assert.match(html.slice(rows, general), /137 &middot; Row 24/);
  assert.ok(!html.slice(row1, rows).includes('137 &middot; Row 24'), 'other-row seat stays out of the row 1 list');
  assert.match(html.slice(general), /327/);
  assert.match(html.slice(row1, general), /\$150\.00 or less each/);
  assert.ok(!html.includes('seats together &middot;'), 'the quantity is not repeated under each heading');
  assert.match(html.slice(row1, rows), /<p class="crit">Sections 339, 137/, 'the criteria line starts the sentence');
  assert.match(html, /listings for 2 together/, 'the quantity still appears once, at the top');
});

test('an empty list says so and still shows the closest seats', () => {
  const w = { ...W, preferred: [{}] };
  const html = renderPage(w, { result: result({ lists: [{ ...lists()[0], matches: [], closest: [listing({ id: 'c', secLabel: '339', rowLabel: '1', price: 190 })] }] }), state: {}, others: [] });
  assert.match(html, /No 2 seats together fit this right now\./);
  assert.match(html, /\$40\.00 over your \$150\.00 limit/);
});

test('otherSections false drops the catch-all list from the page entirely', () => {
  const w = { ...W, preferred: [{}, {}], otherSections: false };
  const html = renderPage(w, { result: result({ lists: lists(), matches: [listing({ id: 'g', secLabel: '327', price: 90 })] }), state: {}, others: [] });
  assert.ok(!html.includes('Other sections'), 'no other-sections heading');
  assert.ok(!html.includes('any other section'), 'no other-sections criteria line');
  assert.ok(!html.includes('327'), 'no seat from outside the preferred sections');
  assert.match(html, /<h2>Row 1<\/h2>/);
  assert.match(html, /<h2>Any row<\/h2>/);
});

test('a marketplace left out of the check is named on the page', () => {
  const html = renderPage(W, { result: result({ missing: [{ site: 'event365', why: 'HTTP 502' }] }), state: {}, others: [] });
  assert.match(html, /Not included in this check: <b>event365<\/b>/);
  assert.match(html, /HTTP 502/);
});

test('a complete check shows no missing-marketplace note', () => {
  assert.ok(!renderPage(W, { result: result({ missing: [] }), state: {}, others: [] }).includes('Not included'));
  assert.ok(!renderPage(W, { result: result(), state: {}, others: [] }).includes('Not included'));
});

test('seat cards show the price without an "all-in, each" suffix', () => {
  assert.ok(!renderPage(W, { result: result(), state: {}, others: [] }).includes('all-in'));
});


test('row wording never reads as a one-row range or a bare number', () => {
  const w = { ...W, preferred: [{}] };
  const page = (list) => renderPage(w, { result: result({ lists: [{ ...lists()[0], ...list, matches: [], closest: [] }] }), state: {}, others: [] });
  assert.match(page({ rowMax: 1, rowMin: undefined }), /row 1 only/);
  assert.ok(!page({ rowMax: 1, rowMin: undefined }).includes('rows 1&ndash;1'));
  assert.match(page({ rowMin: 2, rowMax: undefined }), /any row except row 1/);
  assert.match(page({ rowMin: undefined, rowMax: 20 }), /rows 1&ndash;20/);
  assert.match(page({ rowMin: undefined, rowMax: undefined }), /any row/);
});

test('the notes section repeats the config, escaped, and is left out when there are none', () => {
  const w = { ...W, notes: [['Lower bowl', 'Benches & no seat backs']] };
  const html = renderPage(w, { result: null, state: {}, others: [] });
  assert.match(html, /<h2>Notes<\/h2>/);
  assert.match(html, /<dt>Lower bowl<\/dt><dd>Benches &amp; no seat backs<\/dd>/);
  assert.doesNotMatch(renderPage(W, { result: null, state: {}, others: [] }), /<h2>Notes<\/h2>/);
});
