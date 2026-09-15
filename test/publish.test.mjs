import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { publish } from '../lib/publish.mjs';

// Real git, real remote: a bare repo plus two working clones standing in for
// "a long-running watch job" and "someone pushing a change meanwhile".
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pub-'));
  const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  sh(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
  const seed = join(root, 'seed');
  sh(root, 'clone', '-q', join(root, 'remote.git'), 'seed');
  sh(seed, 'config', 'user.email', 't@t'); sh(seed, 'config', 'user.name', 't');
  mkdirSync(join(seed, 'docs'), { recursive: true }); mkdirSync(join(seed, 'data/jets'), { recursive: true });
  writeFileSync(join(seed, 'watchers.mjs'), 'priceMax: 360\n');
  writeFileSync(join(seed, 'docs/index.html'), 'old page\n');
  writeFileSync(join(seed, 'data/jets/state.json'), '{}\n');
  sh(seed, 'add', '-A'); sh(seed, 'commit', '-q', '-m', 'seed'); sh(seed, 'push', '-q', 'origin', 'main');
  const clone = (name) => {
    const dir = join(root, name);
    sh(root, 'clone', '-q', join(root, 'remote.git'), name);
    sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
    return { dir, git: (args) => sh(dir, ...args) };
  };
  return { root, sh, job: clone('job'), editor: clone('editor') };
}

const FILES = ['docs/index.html', 'data/jets/state.json'];

test('REGRESSION: a status publish never reverts a change pushed while the job was running', async () => {
  const { sh, job, editor } = setup();
  // Someone changes the criteria after the long-running job checked out.
  writeFileSync(join(editor.dir, 'watchers.mjs'), 'priceMax: 100\n');
  editor.git(['commit', '-q', '-am', 'new criteria']); editor.git(['push', '-q', 'origin', 'main']);
  // The job, still holding the old checkout, publishes its status.
  writeFileSync(join(job.dir, 'docs/index.html'), 'new page\n');
  const res = await publish({ git: job.git, files: FILES, message: 'status' });
  assert.equal(res.status, 'pushed');
  editor.git(['pull', '-q', 'origin', 'main']);
  assert.equal(readFileSync(join(editor.dir, 'watchers.mjs'), 'utf8'), 'priceMax: 100\n', 'criteria change must survive');
  assert.equal(readFileSync(join(editor.dir, 'docs/index.html'), 'utf8'), 'new page\n');
  const changed = sh(editor.dir, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n');
  assert.deepEqual(changed, ['docs/index.html'], 'the status commit touches only status files');
});

test('two jobs publishing different files both land (no lost updates, no rebase)', async () => {
  const { job, editor } = setup();
  writeFileSync(join(editor.dir, 'data/jets/state.json'), '{"a":1}\n');
  assert.equal((await publish({ git: editor.git, files: FILES, message: 's1' })).status, 'pushed');
  writeFileSync(join(job.dir, 'docs/index.html'), 'page from job\n');
  assert.equal((await publish({ git: job.git, files: ['docs/index.html'], message: 's2' })).status, 'pushed');
  editor.git(['pull', '-q', 'origin', 'main']);
  assert.equal(readFileSync(join(editor.dir, 'data/jets/state.json'), 'utf8'), '{"a":1}\n');
  assert.equal(readFileSync(join(editor.dir, 'docs/index.html'), 'utf8'), 'page from job\n');
});

test('nothing changed: no empty commit', async () => {
  const { job } = setup();
  const before = job.git(['rev-parse', 'HEAD']).trim();
  assert.equal((await publish({ git: job.git, files: FILES, message: 'noop' })).status, 'unchanged');
  job.git(['fetch', '-q']);
  assert.equal(job.git(['rev-parse', 'origin/main']).trim(), before);
});

test('a push rejected mid-flight is retried on top of the new remote', async () => {
  const { job, editor } = setup();
  writeFileSync(join(job.dir, 'docs/index.html'), 'retry page\n');
  let raced = false;
  const racingGit = (args) => {
    if (args[0] === 'push' && !raced) {
      raced = true; // another writer lands between our commit and our push
      writeFileSync(join(editor.dir, 'watchers.mjs'), 'raced\n');
      editor.git(['commit', '-q', '-am', 'race']); editor.git(['push', '-q', 'origin', 'main']);
    }
    return job.git(args);
  };
  const res = await publish({ git: racingGit, files: FILES, message: 'status' });
  assert.equal(res.status, 'pushed');
  assert.equal(res.attempt, 2);
  editor.git(['pull', '-q', 'origin', 'main']);
  assert.equal(readFileSync(join(editor.dir, 'watchers.mjs'), 'utf8'), 'raced\n');
  assert.equal(readFileSync(join(editor.dir, 'docs/index.html'), 'utf8'), 'retry page\n');
});

test('persistent push failure is reported, not swallowed', async () => {
  const { job } = setup();
  writeFileSync(join(job.dir, 'docs/index.html'), 'x\n');
  const broken = (args) => { if (args[0] === 'push') throw Object.assign(new Error('rejected'), { stderr: 'remote rejected' }); return job.git(args); };
  const res = await publish({ git: broken, files: FILES, message: 's', attempts: 2 });
  assert.equal(res.status, 'failed');
  assert.match(res.detail, /rejected/);
});
