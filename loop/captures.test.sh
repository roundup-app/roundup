#!/usr/bin/env bash
# L105's expensive observers: pass a clean checkout of main and the PR to replay.
set -euo pipefail
checkout=$(realpath "${1:?clean main checkout required}")
pr=${2:?PR number required}
cd "$checkout"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
unset ROUNDUP_CAPTURES
just check
test -z "$(git status --porcelain)"
echo 'ok: l105_just_check_leaves_no_tracked_change'

body=$(gh pr view "$pr" --json body --jq .body)
head=$(gh pr view "$pr" --json headRefOid --jq .headRefOid)
git fetch origin "$head"
result=$(mktemp)
trap 'rm -f "$result"' EXIT
code=0
git merge-tree --write-tree --name-only --no-messages HEAD "$head" >"$result" || code=$?
# merge-tree exits 1 for conflicts, while any other failure invalidates the observer.
test "$code" -le 1
python3 - "$result" "$body" <<'PY'
import re
import sys
from pathlib import Path

named = set(re.findall(r'\b[A-Z][0-9]+[a-z]?\b', ' '.join(re.findall(r'^Scenarios:(.*)$', sys.argv[2], re.M))))
conflicts = Path(sys.argv[1]).read_text().splitlines()[1:]
uncited = [path for path in conflicts if path.startswith('artifacts/')
           and (not path.startswith('artifacts/ux/') or path.split('/')[2] not in named)]
if uncited:
    sys.exit('\n'.join(uncited))
print('ok: l105_replay_of_1194_conflicts_on_no_uncited_capture')
PY
