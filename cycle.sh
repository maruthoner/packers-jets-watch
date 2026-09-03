#!/usr/bin/env bash
# One full check cycle: read the market, publish the page, alert on a match.
set -uo pipefail
REPO="maruthoner/packers-jets-watch"

node watch.mjs
RC=$?

# --- publish the status page ---
git add -A docs result.json 2>/dev/null || true
if ! git diff --quiet --cached; then
  git commit -q -m "status: $(date -u '+%Y-%m-%d %H:%M UTC')"
  git pull --rebase -q origin main || true
  git push -q origin main || echo "  (push failed, will retry next cycle)"
fi

open_issue_once() {  # $1=title  $2=body
  if gh issue list --repo "$REPO" --state open --json title --jq '.[].title' | grep -qxF "$1"; then
    echo "  issue already open: $1"
  else
    gh issue create --repo "$REPO" --title "$1" --body "$2" --assignee maruthoner
  fi
}

if [ $RC -ne 0 ]; then
  open_issue_once "Seat watch check failed" \
"@maruthoner — a scheduled check could not read the market (blocked, or fewer than 8,000 listings).

Run: https://github.com/$REPO/actions/runs/${GITHUB_RUN_ID:-unknown}"
  exit 0
fi

COUNT=$(node -e "console.log(require('./result.json').matches.length)")
if [ "$COUNT" = "0" ]; then
  echo "  no match"
  exit 0
fi

BODY=$(node -e "
  const r = require('./result.json');
  let o = '@maruthoner — **' + r.matches.length + ' match(es)** as of ' + r.when + ', ' + r.listings.toLocaleString() + ' listings read.\n\n';
  for (const m of r.matches) o += '- **Target ' + m.target + '** — Section ' + m.sec + ', Row ' + m.row + ' — **\$' + m.price.toFixed(2) + '** all-in each\n  ' + m.link + '\n';
  o += '\nConfirm the marketplace page says **Sep 20 2026** before paying. Links carry TicketWhiz affiliate tracking.';
  console.log(o);
")
TITLE="Seat match — $(node -e "const m=require('./result.json').matches[0];console.log('Sec '+m.sec+' Row '+m.row+' \$'+m.price.toFixed(2))")"
open_issue_once "$TITLE" "$BODY"
