#!/usr/bin/env bash
# One check cycle: read the market, decide, publish the page, alert only on a real match.
set -uo pipefail
REPO="maruthoner/packers-jets-watch"

node watch.mjs
RC=$?

open_issue_once() {  # $1=title  $2=body
  if [ -z "${1// }" ] || [ -z "${2// }" ]; then
    echo "  refusing to open an issue with an empty title or body"; return 1
  fi
  if gh issue list --repo "$REPO" --state open --json title --jq '.[].title' | grep -qxF "$1"; then
    echo "  issue already open: $1"
  else
    gh issue create --repo "$REPO" --title "$1" --body "$2" --assignee maruthoner
  fi
}

fail_alert() {  # $1 = one-line reason
  open_issue_once "Seat watch check failed" \
"@maruthoner — a check could not complete: $1

No conclusion should be drawn about seat availability from this run.

Run: https://github.com/$REPO/actions/runs/${GITHUB_RUN_ID:-unknown}"
}

if [ $RC -ne 0 ]; then
  fail_alert "watch.mjs exited $RC (blocked, or fewer than 8,000 listings)"
  exit 0
fi

# Decide BEFORE touching git — a rebase can leave result.json mid-flight.
SUMMARY=$(node -e '
  const r = require("./result.json");
  if (!r || r.ok !== true || !Array.isArray(r.matches)) { console.error("result.json malformed"); process.exit(3); }
  console.log(JSON.stringify({ n: r.matches.length, when: r.when, listings: r.listings, matches: r.matches }));
' 2>&1)
NODE_RC=$?

if [ $NODE_RC -ne 0 ] || [ -z "$SUMMARY" ]; then
  echo "  could not read result.json: $SUMMARY"
  fail_alert "could not read result.json after a successful check"
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
# The page and result are regenerated whole each cycle, so there is nothing to
# merge: replay our files on top of whatever the remote has now. Rebase on a
# shallow clone fails once another run pushes, which used to freeze the page
# silently for a whole 5-hour window.
PUBLISHED=no
for attempt in 1 2 3; do
  git fetch -q origin main || { sleep 5; continue; }
  git reset -q --soft origin/main
  git add -A docs result.json 2>/dev/null || true
  if git diff --quiet --cached; then PUBLISHED=same; break; fi
  git commit -q -m "status: $(date -u '+%Y-%m-%d %H:%M UTC')"
  if git push -q origin HEAD:main 2>/dev/null; then PUBLISHED=yes; break; fi
  echo "  push attempt $attempt rejected; refetching"
  sleep 5
done

if [ "$PUBLISHED" = "no" ]; then
  FAILS=$(( ${FAILS:-0} + 1 ))
  echo "  PUBLISH FAILED ($FAILS in a row)"
  # Do not let the page rot in silence — say so after two consecutive failures.
  if [ "$FAILS" -ge 2 ]; then
    fail_alert "the status page has not published for $FAILS cycles — checks are running but the page you see is stale"
  fi
  export FAILS
else
  export FAILS=0
fi

[ "$MATCHED" = "no" ] && { echo "  no match"; exit 0; }

BODY=$(printf '%s' "$SUMMARY" | node -e '
  let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
    const r = JSON.parse(s);
    let o = "@maruthoner — **" + r.n + " match(es)** as of " + r.when + ", " + r.listings.toLocaleString() + " listings read.\n\n";
    for (const m of r.matches) o += "- **Target " + m.target + "** — Section " + m.sec + ", Row " + m.row + " — **$" + m.price.toFixed(2) + "** all-in each\n  " + m.link + "\n";
    o += "\nConfirm the marketplace page says **Sep 20 2026** before paying. Links carry TicketWhiz affiliate tracking.";
    console.log(o);
  });')
TITLE=$(printf '%s' "$SUMMARY" | node -e '
  let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{
    const m = JSON.parse(s).matches[0];
    console.log("Seat match — Sec " + m.sec + " Row " + m.row + " $" + m.price.toFixed(2));
  });')

open_issue_once "$TITLE" "$BODY"
