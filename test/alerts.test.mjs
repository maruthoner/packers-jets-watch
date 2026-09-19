import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, initialState, FAIL_THRESHOLD, EMPTY_THRESHOLD } from '../lib/alerts.mjs';
import { executeActions } from '../cycle.mjs';

const W = { id: 'jets', title: 'Packers at Jets', alertLabel: 'Jets', quantity: 2, priceMax: 100 };
const CTX = { owner: 'maruthoner', runUrl: 'https://run' };
const seat = (price, id = `id${price}`) => ({ id, price, secLabel: '327', rowLabel: '19', link: 'https://buy', unassigned: false });
// One emailing list ('general') unless a test passes its own alert entries.
const ok = (matches, when = 'now') => ({ ok: true, whenISO: `2026-09-15T00:00:0${Math.floor(Math.random() * 9)}Z`, when,
  alerts: [{ id: 'general', spec: W, matches }] });
const okLists = (entries, when = 'now') => ({ ok: true, whenISO: '2026-09-19T00:00:00Z', when, alerts: entries });
const fail = (reason = 'blocked') => ({ ok: false, reason, whenISO: '2026-09-15T00:00:00Z' });

// Simulates GitHub so a whole sequence of checks can be replayed.
function fakeGitHub() {
  let next = 100;
  const issues = new Map();
  const emails = [];
  const client = {
    open(title, body) { const n = next++; issues.set(n, { title, body, comments: [] }); emails.push({ n, kind: 'open' }); return n; },
    comment(n, body) { issues.get(n).comments.push(body); if (body.includes('@maruthoner')) emails.push({ n, kind: 'comment' }); },
    edit(n, body) { issues.get(n).body = body; },
  };
  return { client, issues, emails };
}

function run(sequence) {
  const gh = fakeGitHub();
  let state = initialState();
  for (const outcome of sequence) {
    const p = plan(state, outcome, W, CTX);
    state = executeActions(p.actions, p.state, gh.client, { logFn: () => {} });
  }
  return { state, ...gh };
}

test('no matches ever: no email, no issue', () => {
  const r = run([ok([]), ok([]), ok([])]);
  assert.equal(r.emails.length, 0);
  assert.equal(r.issues.size, 0);
});

test('seats appear: exactly one email, mentions and title carry no price', () => {
  const r = run([ok([seat(90)])]);
  assert.equal(r.emails.length, 1);
  const [issue] = [...r.issues.values()];
  assert.equal(issue.title, 'Jets: 2 seats together at $100.00 or less');
  assert.match(issue.body, /@maruthoner/);
  assert.match(issue.body, /\$90\.00/);
});

test('same seats, or a price wiggle upward, on later checks: no more email', () => {
  const r = run([ok([seat(90)]), ok([seat(90)]), ok([seat(92), seat(95)]), ok([seat(91)])]);
  assert.equal(r.emails.length, 1, 'price moves that are not cheaper must not email (this was the #21/#22 spam)');
});

test('cheaper seats appear: one extra email, then quiet again', () => {
  const r = run([ok([seat(95)]), ok([seat(90)]), ok([seat(90)]), ok([seat(89.999)])]);
  assert.deepEqual(r.emails.map((e) => e.kind), ['open', 'comment']);
});

test('the issue body is kept current quietly', () => {
  const r = run([ok([seat(95)]), ok([seat(97, 'other')])]);
  assert.match([...r.issues.values()][0].body, /\$97\.00/);
});

test('seats vanish for one check only: no change (no flapping)', () => {
  const r = run([ok([seat(90)]), ok([]), ok([seat(90)])]);
  assert.equal(r.emails.length, 1);
  assert.equal(r.state.alerts.general.active, true);
});

test(`seats gone for ${EMPTY_THRESHOLD} checks then return: quiet close-out, one email on return, same issue`, () => {
  const r = run([ok([seat(90)]), ok([]), ok([]), ok([seat(99)])]);
  assert.deepEqual(r.emails.map((e) => e.kind), ['open', 'comment']);
  assert.equal(r.issues.size, 1);
});

test(`a single failed check does not alert; ${FAIL_THRESHOLD} in a row does, once`, () => {
  assert.equal(run([fail()]).emails.length, 0);
  const r = run([fail(), fail(), fail(), fail()]);
  assert.equal(r.emails.length, 1);
});

test('failures reset on success, and a later failure streak alerts again in the same issue', () => {
  const r = run([fail(), fail(), ok([]), fail(), fail()]);
  assert.deepEqual(r.emails.map((e) => e.kind), ['open', 'comment']);
  assert.equal(r.issues.size, 1);
  assert.match([...r.issues.values()][0].body, /recovered/);
});

test('a failed check never changes what we believe about seats', () => {
  const r = run([ok([seat(90)]), fail(), fail(), fail()]);
  assert.equal(r.state.alerts.general.active, true);
  assert.equal(r.state.alerts.general.emptyStreak, 0);
});

test('an alert that could not be sent is retried next check, not recorded as sent', () => {
  let state = initialState();
  const broken = { open() { throw new Error('API down'); }, comment() {}, edit() {} };
  let p = plan(state, ok([seat(90)]), W, CTX);
  state = executeActions(p.actions, p.state, broken, { logFn: () => {} });
  assert.equal(state.alerts.general.active, false);
  const gh = fakeGitHub();
  p = plan(state, ok([seat(90)]), W, CTX);
  state = executeActions(p.actions, p.state, gh.client, { logFn: () => {} });
  assert.equal(gh.emails.length, 1);
});

test('state saying "active" but with no issue recovers by alerting again', () => {
  const p = plan({ ...initialState(), alerts: { general: { issue: null, active: true, notifiedBest: 90, emptyStreak: 0 } } },
    ok([seat(90)]), W, CTX);
  assert.equal(p.actions[0].type, 'open');
});

test('unassigned seats are called out in the alert text', () => {
  const r = run([ok([{ ...seat(90), secLabel: '301–306–OR–346–350', rowLabel: 'TBD', unassigned: true }])]);
  assert.match([...r.issues.values()][0].body, /location not assigned yet/);
});

const ROW1 = { ...W, id: 'row1', label: 'Row 1', sections: [337, 339], rowMax: 1, priceMax: 150 };
const HUNDREDS = { ...W, id: 'hundreds', label: 'Section 100s', sections: [137, 139, 140], rowMax: 20, priceMax: 200 };

test('each emailing list has its own title and criteria; failures keep the game title', () => {
  const r = run([okLists([
    { id: 'row1', spec: ROW1, matches: [seat(140)] },
    { id: 'hundreds', spec: HUNDREDS, matches: [seat(190)] },
  ])]);
  const titles = [...r.issues.values()].map((i) => i.title);
  assert.deepEqual(titles, ['Jets row 1: 2 seats together at $150.00 or less',
    'Jets section 100s: 2 seats together at $200.00 or less']);
  const [row1, hundreds] = [...r.issues.values()];
  assert.match(row1.body, /sections 337, 339, row 1 only, \$150\.00 or less each/);
  assert.match(hundreds.body, /sections 137, 139, 140, rows 1–20, \$200\.00 or less each/);
  assert.match(hundreds.body, /Packers at Jets — Section 100s/);
  let s = initialState();
  s = plan(s, fail(), W, CTX).state;
  assert.equal(plan(s, fail(), W, CTX).actions[0].title, 'Jets: seat watch checks are failing');
});

test('two emailing lists alert independently: one going quiet never silences the other', () => {
  const gh = fakeGitHub();
  let state = initialState();
  const step = (row1Matches, hundredsMatches) => {
    const p = plan(state, okLists([
      { id: 'row1', spec: ROW1, matches: row1Matches },
      { id: 'hundreds', spec: HUNDREDS, matches: hundredsMatches },
    ]), W, CTX);
    state = executeActions(p.actions, p.state, gh.client, { logFn: () => {} });
  };
  step([seat(140)], []);                 // row 1 appears: one email
  assert.deepEqual(gh.emails.map((e) => e.n), [100]);
  step([seat(140)], [seat(190)]);        // 100s appears: its own issue, its own email
  assert.deepEqual(gh.emails.map((e) => e.n), [100, 101]);
  step([], [seat(180)]);                 // row 1 empty, 100s cheaper: only the cheaper one emails
  step([], [seat(180)]);
  assert.deepEqual(gh.emails.map((e) => e.n), [100, 101, 101]);
  assert.equal(state.alerts.row1.active, false, 'row 1 closed out after two empty checks');
  assert.equal(state.alerts.hundreds.active, true, 'section 100s still active');
  assert.equal(gh.issues.size, 2);
  step([seat(145)], [seat(180)]);        // row 1 returns: email again, same issue
  assert.deepEqual(gh.emails.map((e) => e.n), [100, 101, 101, 100]);
});

test('a legacy single-list state does not resurrect old alerts', () => {
  const legacy = { failStreak: 0, failIssue: 24, failActive: false, lastFailure: null,
    matchIssue: 26, matchActive: true, notifiedBest: 128, emptyStreak: 0, lastSuccessISO: '2026-09-18T15:00:00Z' };
  const p = plan(legacy, okLists([{ id: 'row1', spec: ROW1, matches: [seat(140)] }]), W, CTX);
  assert.equal(p.state.matchIssue, undefined, 'legacy fields are dropped');
  assert.equal(p.actions[0].type, 'open', 'the new list opens its own issue');
  assert.equal(p.state.failIssue, 24, 'the failure issue is kept');
});

test('an empty-page failure carries what the page showed into the alert and the state', () => {
  const diagnostics = { listBox: true, listBoxRows: 3, ticketArrays: [], pageText: 'No tickets match your filters',
    sample: { label: 'Live Prices', qtyText: '2 Seats' } };
  const first = plan(initialState(), { ok: false, reason: 'page listed none', diagnostics, whenISO: '2026-09-18T01:00:00Z' }, W, CTX);
  assert.deepEqual(first.state.lastFailure.diagnostics, diagnostics);
  const second = plan(first.state, { ok: false, reason: 'page listed none', diagnostics, whenISO: '2026-09-18T01:30:00Z' }, W, CTX);
  const opened = second.actions.find((a) => a.type === 'open');
  assert.match(opened.body, /What the page showed:/);
  assert.match(opened.body, /ticket list box present with 3 elements/);
  assert.match(opened.body, /No tickets match your filters/);
});

test('an ordinary failure carries no diagnostics line', () => {
  const s1 = plan(initialState(), { ok: false, reason: 'blocked', whenISO: '2026-09-18T01:00:00Z' }, W, CTX);
  const s2 = plan(s1.state, { ok: false, reason: 'blocked', whenISO: '2026-09-18T01:30:00Z' }, W, CTX);
  assert.ok(!s2.actions.find((a) => a.type === 'open').body.includes('What the page showed'));
  assert.equal(s1.state.lastFailure.diagnostics, undefined);
});
