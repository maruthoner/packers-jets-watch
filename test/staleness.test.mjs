import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, lastSuccess, activeWatchers, minutesSince, STALE_AFTER_MIN, ALERT_AFTER_MIN } from '../lib/staleness.mjs';

const NOW = Date.parse('2026-09-21T15:00:00Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const ahead = { falcons: { id: 'falcons', kickoff: '2026-09-25T00:15:00Z' } };
const played = { falcons: { id: 'falcons', kickoff: '2026-09-20T00:15:00Z' } };
const at = (min) => verdict({ watchers: ahead, states: [{ lastSuccessISO: ago(min) }], now: NOW });

test('a recent check is fine, and the boundary itself is not yet stale', () => {
  assert.equal(at(1).action, 'ok');
  assert.equal(at(STALE_AFTER_MIN - 1).action, 'ok');
  assert.equal(at(STALE_AFTER_MIN).action, 'restart', 'two missed cycles is stale');
});

test('a long stall asks for a person instead of restarting again', () => {
  assert.equal(at(ALERT_AFTER_MIN - 1).action, 'restart');
  assert.equal(at(ALERT_AFTER_MIN).action, 'alert');
  assert.match(at(ALERT_AFTER_MIN).reason, /restarting has not fixed it/);
});

test('once every game has been played it stays quiet', () => {
  // Never restart a watcher that has correctly stopped; its state goes stale by design.
  const v = verdict({ watchers: played, states: [{ lastSuccessISO: ago(9999) }], now: NOW });
  assert.equal(v.action, 'idle');
});

test('the freshest game decides, not the stalest', () => {
  const states = [{ lastSuccessISO: ago(500) }, { lastSuccessISO: ago(5) }];
  assert.equal(verdict({ watchers: ahead, states, now: NOW }).action, 'ok');
});

test('missing or unreadable state counts as never having checked', () => {
  assert.equal(lastSuccess([null, {}, { lastSuccessISO: 'nonsense' }]), null);
  assert.equal(minutesSince(null, NOW), null);
  const v = verdict({ watchers: ahead, states: [null], now: NOW });
  assert.equal(v.action, 'restart');
  assert.match(v.reason, /no successful check has ever been recorded/);
});

test('only games still ahead are considered', () => {
  const mixed = { a: { id: 'a', kickoff: '2026-09-20T00:00:00Z' }, b: { id: 'b', kickoff: '2026-09-25T00:00:00Z' } };
  assert.deepEqual(activeWatchers(mixed, NOW).map((w) => w.id), ['b']);
});

test('the reported age is the one acted on', () => {
  const v = at(88);
  assert.equal(v.minutes, 88);
  assert.match(v.reason, /88 minutes ago/);
});
