// Commit a fixed set of generated files on top of whatever the remote has now.
//
// Why this shape:
// - Files are regenerated whole each cycle, so there is nothing to merge; replay them
//   onto the latest remote instead of rebasing (rebase broke on shallow clones, Sep 4).
// - Reset with --mixed so the index matches the remote and only the named files are
//   staged. --soft kept a long-running job's stale copy of every file staged and
//   silently reverted changes pushed meanwhile (Sep 14).
// - Anything staged beyond the named files is refused, never committed.

export async function publish({ git, files, message, remote = 'origin', branch = 'main', attempts = 3, pause = () => {} }) {
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      git(['fetch', '-q', remote, branch]);
      git(['reset', '-q', '--mixed', `${remote}/${branch}`]);
      git(['add', '--', ...files]);
      const staged = git(['diff', '--cached', '--name-only']).split('\n').map((s) => s.trim()).filter(Boolean);
      const stray = staged.filter((f) => !files.includes(f));
      if (stray.length) {
        git(['reset', '-q', '--mixed', `${remote}/${branch}`]);
        return { status: 'refused', detail: `unexpected files staged: ${stray.join(', ')}` };
      }
      if (staged.length === 0) return { status: 'unchanged' };
      git(['commit', '-q', '-m', message]);
      git(['push', '-q', remote, `HEAD:${branch}`]);
      return { status: 'pushed', attempt };
    } catch (e) {
      lastError = String(e.stderr || e.message || e).trim().split('\n').slice(-1)[0];
      await pause(attempt);
    }
  }
  return { status: 'failed', detail: lastError };
}
