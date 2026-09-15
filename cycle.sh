#!/usr/bin/env bash
# One check cycle for one game: read the market, decide, publish its page, alert only on a real match.
# Usage: ./cycle.sh <watcher-id>        DRY_RUN=1 skips publishing and issues.
set -uo pipefail
REPO="maruthoner/packers-jets-watch"
WID="${1:?usage: cycle.sh <watcher-id>}"

meta() { node -e "import('./watchers.mjs').then(m=>{const w=m.WATCHERS['$WID'];if(!w)process.exit(2);console.log(w.$1)})"; }
LABEL=$(meta alertLabel) || { echo "  unknown watcher $WID"; exit 0; }
RESULT=$(meta resultFile)
OUTDIR=$(meta outDir)
KICKOFF=$(meta kickoff)

# No point watching a game that has started.
if node -e "process.exit(Date.now() > Date.parse('$KICKOFF') ? 0 : 1)"; then
  echo "  [$WID] game has kicked off ($KICKOFF) — skipping"
  exit 0
fi

node watch.mjs "$WID"
RC=$?

open_issue_once() {  # $1=title  $2=body
  if [ -z "${1// }" ] || [ -z "${2// }" ]; then
    echo "  refusing to open an issue with an empty title or body"; return 1
  fi
  if [ "${DRY_RUN:-0}" = "1" ]; then echo "  DRY RUN — would open issue: $1"; return 0; fi
  if gh issue list --repo "$REPO" --state open --json title --jq '.[].title' | grep -qxF "$1"; then
    echo "  issue already open: $1"
  else
    gh issue create --repo "$REPO" --title "$1" --body "$2" --assignee maruthoner
  fi
}

fail_alert() {  # $1 = one-line reason
  open_issue_once "$LABEL seat watch check failed" \
"@maruthoner — a $LABEL check could not complete: $1

No conclusion should be drawn about seat availability from this run.

Run: https://github.com/$REPO/actions/runs/${GITHUB_RUN_ID:-unknown}"
}

if [ $RC -ne 0 ]; then
  REASON=$(node -e "try{console.log(require('./$RESULT').reason||'')}catch(e){}" 2>/dev/null)
  fail_alert "${REASON:-watch.mjs exited $RC}"
  exit 0
fi

# Decide BEFORE touching git — a rebase can leave the result file mid-flight.
SUMMARY=$(node -e '
  const r = require("./'"$RESULT"'");
  if (!r || r.ok !== true || !Array.isArray(r.matches)) { console.error("result malformed"); process.exit(3); }
  console.log(JSON.stringify({ n: r.matches.length, when: r.when, listings: r.listings, qty: r.quantity, matches: r.matches }));
' 2>&1)
if [ $? -ne 0 ] || [ -z "$SUMMARY" ]; then
  echo "  could not read $RESULT: $SUMMARY"
  fail_alert "could not read the result file after a successful check"
  exit 0
fi

COUNT=$(printf '%s' "$SUMMARY" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).n))')
# Fail CLOSED: alert only on a positive integer. Anything else is a broken check, not a match.
case "$COUNT" in
  0) MATCHED=no ;;
  ''|*[!0-9]*) echo "  match count unreadable: [$COUNT]"; fail_alert "match count came back as '$COUNT' instead of a number"; exit 0 ;;
  *) MATCHED=yes ;;
esac

# --- publish the status page ---
# Pages and results are regenerated whole each cycle, so there is nothing to merge:
# replay our files onto whatever the remote has now.
if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "  DRY RUN — skipping publish"
else
  PUBLISHED=no
  for attempt in 1 2 3; do
    git fetch -q origin main || { sleep 5; continue; }
    # --mixed, not --soft: reset the index to the remote so this commit carries ONLY
    # the status files. --soft kept the run's stale copy of every other file staged,
    # which silently reverted any change pushed while the run was alive.
    git reset -q --mixed origin/main
    git add -A "$OUTDIR" "$RESULT" 2>/dev/null || true
    STRAY=$(git diff --cached --name-only | grep -vE "^($OUTDIR/|$RESULT$)" || true)
    if [ -n "$STRAY" ]; then echo "  refusing to commit non-status files: $STRAY"; git reset -q --mixed origin/main; break; fi
    if git diff --quiet --cached; then PUBLISHED=same; break; fi
    git commit -q -m "status [$WID]: $(date -u '+%Y-%m-%d %H:%M UTC')"
    if git push -q origin HEAD:main 2>/dev/null; then PUBLISHED=yes; break; fi
    echo "  push attempt $attempt rejected; refetching"
    sleep 5
  done
  # Each cycle is a fresh process, so the consecutive-failure count lives in a file.
  # (An exported variable reset every cycle, which meant this alert could never fire.)
  FAILFILE="${RUNNER_TEMP:-/tmp}/publish-fails-$WID"
  if [ "$PUBLISHED" = "no" ]; then
    N=$(( $(cat "$FAILFILE" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$FAILFILE"
    echo "  PUBLISH FAILED ($N in a row)"
    [ "$N" -ge 2 ] && fail_alert "the status page has not published for $N cycles — checks are running but the page you see is stale"
  else
    echo 0 > "$FAILFILE"
  fi
fi

[ "$MATCHED" = "no" ] && { echo "  [$WID] no match"; exit 0; }

BODY=$(printf '%s' "$SUMMARY" | node -e '
  let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
    const r = JSON.parse(s);
    let o = "@maruthoner — **" + r.n + " match(es)** for '"$LABEL"' as of " + r.when + " — " + r.listings.toLocaleString() + " listings for " + r.qty + " together.\n\n";
    for (const m of r.matches) o += "- **" + m.secLabel + ", Row " + m.rowLabel + "** — **$" + m.price.toFixed(2) + "** all-in each (" + m.label + ")\n  " + m.link + "\n";
    o += "\nConfirm the marketplace page shows the right game and date before paying. Links carry TicketWhiz affiliate tracking.";
    console.log(o);
  });')
TITLE=$(printf '%s' "$SUMMARY" | node -e '
  let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
    const m = JSON.parse(s).matches[0];
    console.log("'"$LABEL"' seat match — " + m.secLabel + " Row " + m.rowLabel + " $" + m.price.toFixed(2));
  });')

open_issue_once "$TITLE" "$BODY"
