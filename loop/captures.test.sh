#!/usr/bin/env bash
# L112 reference audit: scenarios and docs link no tracked evidence path.
set -euo pipefail
# L105: with captures disabled, the full check leaves a clean checkout clean.
if [ "${1:-}" = --checkout ]; then
  checkout=$(realpath "${2:?clean main checkout required}")
  cd "$checkout"
  test -z "$(git status --porcelain)"
  test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
  unset ROUNDUP_CAPTURES
  code=0
  just check || code=$?
  test -z "$(git status --porcelain)"
  echo 'ok: l105_just_check_leaves_no_tracked_change'
  exit "$code"
fi
[ $# = 0 ] || { echo 'usage: loop/captures.test.sh [--checkout <clean-main-checkout>]' >&2; exit 2; }
cd "$(dirname "$0")/.."
python3 - <<'PY'
import re
from pathlib import Path

SOURCE = Path.cwd()
# A markdown link never targets an evidence directory; its payloads are generated, not committed.
for folder in ('scenarios', 'docs', '.agents/data'):
    for path in (SOURCE / folder).rglob('*.md'):
        text = path.read_text()
        for target in re.findall(r'\]\(([^)]+)\)', text):
            if not target.startswith(('http://', 'https://')):
                assert not re.search(r'(?:^|/)(?:artifacts/|crates/rpc/r16/|crates/rupd/evidence/)', target), f'{path}: tracked evidence link {target}'
print('ok: l112_scenario_evidence_references_resolve')
PY
