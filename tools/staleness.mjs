// Usage: node tools/staleness.mjs
// Reads the committed state for every game still ahead and prints, for the workflow:
//   action=ok|restart|alert|idle
//   minutes=<n>
//   reason=<text>
import { readFileSync, appendFileSync } from 'fs';
import { WATCHERS } from '../watchers.mjs';
import { verdict, activeWatchers } from '../lib/staleness.mjs';

const now = Date.now();
const states = activeWatchers(WATCHERS, now).map((w) => {
  try { return JSON.parse(readFileSync(`data/${w.id}/state.json`, 'utf8')); } catch { return null; }
});

const v = verdict({ watchers: WATCHERS, states, now });
const lines = [`action=${v.action}`, `minutes=${v.minutes ?? ''}`, `reason=${v.reason}`];
for (const line of lines) console.log(line);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
