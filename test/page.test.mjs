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

test('games with preferred sections render the preferred list first, labelled as the one that emails', () => {
  const w = { ...W, preferred: { sections: [339, 137], priceMax: 100 }, alertOn: 'preferred' };
  const html = renderPage(w, {
    result: result({
      preferred: { priceMax: 100, matches: [listing({ id: 'p', secLabel: '339', rowLabel: '24', price: 98 })], closest: [] },
      matches: [listing({ id: 'g', secLabel: '327', price: 90 })],
    }),
    state: {}, others: [],
  });
  const pref = html.indexOf('Preferred sections'), general = html.indexOf('Any other section');
  assert.ok(pref > 0 && general > pref, 'preferred section comes first');
  assert.match(html.slice(pref, general), /email alerts/);
  assert.match(html.slice(general), /page only/);
  assert.match(html.slice(pref, general), /339 &middot; Row 24/);
  assert.ok(!html.slice(pref, general).includes('327'), 'general seat not in preferred section');
});

test('an empty preferred list says so and shows the cheapest there', () => {
  const w = { ...W, preferred: { sections: [339], priceMax: 100 } };
  const html = renderPage(w, {
    result: result({ preferred: { priceMax: 100, matches: [], closest: [listing({ id: 'c', secLabel: '339', price: 140 })] } }),
    state: {}, others: [],
  });
  assert.match(html, /No pair in your preferred sections at this price right now/);
  assert.match(html, /\$40\.00 over your \$100\.00 limit/);
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
