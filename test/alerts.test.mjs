import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, initialState, FAIL_THRESHOLD, EMPTY_THRESHOLD } from '../lib/alerts.mjs';
import { executeActions } from '../cycle.mjs';

const W = { id: 'jets', title: 'Packers at Jets', alertLabel: 'Jets', quantity: 2, priceMax: 100 };
const CTX = { owner: 'maruthoner', runUrl: 'https://run' };
const seat = (price, id = `id${price}`) => ({ id, price, secLabel: '327', rowLabel: '19', link: 'https://buy', unassigned: false });
const ok = (matches, when = 'now') => ({ ok: true, whenISO: `2026-09-15T00:00:0${Math.floor(Math.random() * 9)}Z`, when, matches });
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
  assert.equal(r.state.matchActive, true);
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
  assert.equal(r.state.matchActive, true);
  assert.equal(r.state.emptyStreak, 0);
});

test('an alert that could not be sent is retried next check, not recorded as sent', () => {
  let state = initialState();
  const broken = { open() { throw new Error('API down'); }, comment() {}, edit() {} };
  let p = plan(state, ok([seat(90)]), W, CTX);
  state = executeActions(p.actions, p.state, broken, { logFn: () => {} });
  assert.equal(state.matchActive, false);
  const gh = fakeGitHub();
  p = plan(state, ok([seat(90)]), W, CTX);
  state = executeActions(p.actions, p.state, gh.client, { logFn: () => {} });
  assert.equal(gh.emails.length, 1);
});

test('state saying "active" but with no issue recovers by alerting again', () => {
  const p = plan({ ...initialState(), matchActive: true, notifiedBest: 90, matchIssue: null }, ok([seat(90)]), W, CTX);
  assert.equal(p.actions[0].type, 'open');
});

test('unassigned seats are called out in the alert text', () => {
  const r = run([ok([{ ...seat(90), secLabel: '301–306–OR–346–350', rowLabel: 'TBD', unassigned: true }])]);
  assert.match([...r.issues.values()][0].body, /location not assigned yet/);
});

test('the preferred alert issue has its own title; failures keep the game title', async () => {
  const { alertSpec } = await import('../cycle.mjs');
  const game = { ...W, preferred: { sections: [339], priceMax: 100 }, alertOn: 'preferred' };
  const spec = alertSpec(game);
  const opened = plan(initialState(), ok([seat(95)]), spec, CTX).actions[0];
  assert.equal(opened.title, 'Jets preferred sections: 2 seats together at $100.00 or less');
  assert.match(opened.body, /sections 339/);
  let s = initialState();
  s = plan(s, fail(), spec, CTX).state;
  assert.equal(plan(s, fail(), spec, CTX).actions[0].title, 'Jets: seat watch checks are failing');
});
