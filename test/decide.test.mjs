import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, validate, decide, sourceOf, isSafeLink, isUnassigned, withQuantity } from '../lib/decide.mjs';

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
  const r = [101, 102, 103, 104, 105].map((p, i) => raw({ id: `i${i}`, secLabel: `${300 + i}`, allIn: p }));
  const { matches, closest } = decide(normalize(r, 2).listings, W);
  assert.equal(matches.length, 0);
  assert.deepEqual(closest.map((c) => c.price), [101, 102, 103]);
});

test('closest shows one section per card, not three seats in one section', () => {
  // The live case: the three cheapest listings all sat in 743S, so the page said
  // nothing about the rest of the stadium (Ruth, Sep 20).
  const r = [
    raw({ id: 'a', secLabel: '743S', allIn: 175 }),
    raw({ id: 'b', secLabel: '743', allIn: 178 }),   // same section, written without the letter
    raw({ id: 'c', secLabel: '743S', allIn: 179 }),
    raw({ id: 'd', secLabel: '637S', allIn: 189 }),
    raw({ id: 'e', secLabel: '354', allIn: 204 }),
    raw({ id: 'f', secLabel: '634S', allIn: 212 }),
  ];
  const { closest } = decide(normalize(r, 2).listings, W);
  assert.deepEqual(closest.map((c) => [c.secLabel, c.price]), [['743S', 175], ['637S', 189], ['354', 204]]);
});

test('listings with no section number each stand on their own', () => {
  const r = [raw({ id: 'a', secLabel: 'GA', allIn: 200 }), raw({ id: 'b', secLabel: 'GA', allIn: 201 })];
  const { closest } = decide(normalize(r, 2).listings, W);
  assert.equal(closest.length, 2);
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
import { decideAll, alertLists } from '../lib/decide.mjs';

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

test('otherSections false leaves no general list, and seats outside the sections are dropped', () => {
  const d = decideAll(market(), { ...PREF, otherSections: false });
  assert.equal(d.general, null);
  assert.deepEqual(d.lists.map((l) => l.id), ['row1', 'rows']);
  const shown = d.lists.flatMap((l) => [...l.matches, ...l.closest]).map((m) => m.id);
  assert.ok(!shown.includes('g1') && !shown.includes('z1'), 'nothing from outside the preferred sections');
});

test('every list marked alerts emails; a game with none falls back to the general list', () => {
  const d = decideAll(market(), PREF);
  assert.deepEqual(alertLists(PREF, d).map((l) => l.id), ['row1']);
  const both = { ...PREF, preferred: PREF.preferred.map((l) => ({ ...l, alerts: true })) };
  assert.deepEqual(alertLists(both, decideAll(market(), both)).map((l) => l.id), ['row1', 'rows']);
  const none = { ...PREF, preferred: PREF.preferred.map((l) => ({ ...l, alerts: false })) };
  const d2 = decideAll(market(), none);
  assert.deepEqual(alertLists(none, d2), [d2.general]);
  const noneAndNoGeneral = { ...none, otherSections: false };
  assert.deepEqual(alertLists(noneAndNoGeneral, decideAll(market(), noneAndNoGeneral)), []);
  const noPref = decideAll(market(), W);
  assert.deepEqual(noPref.lists, []);
  assert.deepEqual(alertLists(W, noPref), [noPref.general]);
});

test('seats in the page-only lists never alert', () => {
  const others = normalize([
    raw({ id: 'g', secLabel: '327', rowLabel: '4', allIn: 90 }),
    raw({ id: 'p', secLabel: '339', rowLabel: '9', allIn: 120 }),
  ], 2).listings;
  assert.deepEqual(alertLists(PREF, decideAll(others, PREF)).flatMap((l) => l.matches), []);
});

test('lists can differ in sections, rows and price, and a seat lands in the first it fits', () => {
  const w = { ...W, otherSections: false, preferred: [
    { id: 'row1', label: 'Row 1', sections: [337, 339], rowMax: 1, priceMax: 150, alerts: true },
    { id: 'hundreds', label: 'Section 100s', sections: [137, 139], rowMax: 20, priceMax: 200, alerts: true },
    { id: 'rows', label: 'Any row', sections: [337, 339], rowMin: 2, priceMax: 150 },
  ] };
  const market2 = normalize([
    raw({ id: 'a', secLabel: '337', rowLabel: '1', allIn: 149 }),    // row 1 list
    raw({ id: 'b', secLabel: '137', rowLabel: '1', allIn: 199 }),    // 100s: row 1 counts here
    raw({ id: 'c', secLabel: '139', rowLabel: '20', allIn: 180 }),   // 100s: last row that counts
    raw({ id: 'd', secLabel: '139', rowLabel: '21', allIn: 90 }),    // 100s: row 21 is in no list
    raw({ id: 'e', secLabel: '339', rowLabel: '7', allIn: 140 }),    // any row
    raw({ id: 'f', secLabel: '137', rowLabel: '4', allIn: 240 }),    // 100s but over $200: closest there
  ], 2).listings;
  const { lists } = decideAll(market2, w);
  assert.deepEqual(lists.map((l) => l.matches.map((m) => m.id)), [['a'], ['c', 'b'], ['e']]); // cheapest first
  assert.deepEqual(lists[1].closest.map((m) => m.id), ['f']);
  const shown = lists.flatMap((l) => [...l.matches, ...l.closest]).map((m) => m.id);
  assert.ok(!shown.includes('d'), 'row 21 of a 100-level section is in no list');
  assert.deepEqual(alertLists(w, { lists, general: null }).map((l) => l.id), ['row1', 'hundreds']);
});

test('a row rule rejects rows that are not numbers', () => {
  const tbd = normalize([raw({ id: 't', secLabel: '339', rowLabel: 'TBD', allIn: 90 })], 2).listings;
  const { lists } = decideAll(tbd, PREF);
  assert.equal(lists[0].matches.length + lists[1].matches.length, 0);
});

test('assignedOnly: standing room is never a match, even under the cap', () => {
  const W3 = { id: 'f', quantity: 3, priceMax: 150, closest: 3, assignedOnly: true };
  const { listings } = normalize([
    raw({ id: 'a1vividseats', secLabel: '400 Standing Room Only', rowLabel: '', allIn: 120, splits: [3] }),
    raw({ id: 'b1vividseats', secLabel: '136', rowLabel: '5', allIn: 145, splits: [3] }),
  ], 3);
  const out = decide(listings, W3);
  assert.equal(out.matches.length, 1);
  assert.equal(out.matches[0].secLabel, '136');
});

test('without assignedOnly an unassigned listing can still match', () => {
  const W3 = { id: 'f', quantity: 3, priceMax: 150, closest: 3 };
  const { listings } = normalize([raw({ secLabel: '400 Standing Room Only', rowLabel: '', allIn: 120, splits: [3] })], 3);
  assert.equal(decide(listings, W3).matches.length, 1);
});

// --- Buy links carry the quantity being bought (Ruth, Sep 20) ---
// TicketWhiz always writes quantity=0. Live checks on 2026-09-20: viagogo then
// defaults its listing selector to 1 ticket, and the TicketNetwork checkout errors
// out altogether. Both work correctly once the real quantity is in the URL.

test('quantity=0 is replaced, encoded inside an affiliate wrapper or plain', () => {
  const viagogo = 'https://viagogo.prf.hn/click/camref:1101l4bXBI/destination:https%3A%2F%2Fwww.viagogo.com%2FE-160435466%3Fbd%3Dtrue%26quantity%3D0%26listingId%3D14108233531%26listingQty%3D';
  const tn = 'https://ticketnetwork.lusg.net/c/5762650/1592982/2322?u=https://ticketnetwork.com/e/checkout-ticket?ticketGroupId=1035917518&quantity=0';
  assert.match(withQuantity(viagogo, 3), /quantity%3D3/);
  assert.match(withQuantity(viagogo, 3), /listingQty%3D3/);
  assert.equal(withQuantity(tn, 3), tn.replace('quantity=0', 'quantity=3'));
});

test('a quantity that is already real is left alone, and 10 is not read as 1 then 0', () => {
  const ten = 'https://x.example/e?quantity=10&listingId=7';
  assert.equal(withQuantity(ten, 3), ten, 'quantity=10 is not "quantity=1" followed by a 0');
  const two = 'https://x.example/e?quantity=2';
  assert.equal(withQuantity(two, 3), two);
});

test('a link with no quantity, or no link at all, survives untouched', () => {
  assert.equal(withQuantity('https://x.example/buy', 3), 'https://x.example/buy');
  assert.equal(withQuantity(null, 3), null);
  assert.equal(withQuantity('https://x.example/e?quantity=0', NaN), 'https://x.example/e?quantity=0');
});

test('normalize puts the watcher quantity into every buy link', () => {
  const r = raw({ link: 'https://t.example/checkout?ticketGroupId=9&quantity=0', splits: [3] });
  assert.equal(normalize([r], 3).listings[0].link, 'https://t.example/checkout?ticketGroupId=9&quantity=3');
});
