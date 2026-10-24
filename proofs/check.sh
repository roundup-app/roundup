#!/usr/bin/env bash
# V2: check proofs/messages with the pinned Bend. Prints ALL PROOFS CHECK and exits 0 only when bend printed it
# and no unsafe step, TODO or unproved law is left. Usage: proofs/check.sh [layout-dir]
# Test hooks: BEND (the bend binary).
set -uo pipefail

here=$(cd "$(dirname "$0")" && pwd)
dir=${1:-$here/messages}
BEND=${BEND:-$here/.tools/bend/bin/bend}
export BEND_NO_TELEMETRY=1
fail() { echo "proofs: $*" >&2; exit 1; }

for f in LAWS.bend LIB.bend model.bend PROOF.bend; do [ -f "$dir/$f" ] || fail "missing $dir/$f"; done
[ -x "$BEND" ] || fail "bend is not installed at $BEND; run just proofs-setup"

grep -nE '@unsafe|\?TODO' "$dir/PROOF.bend" "$dir/LIB.bend" && fail "a proof file holds @unsafe or ?TODO"
for law in $(sed -nE 's/^law ([A-Za-z0-9_]+):.*/\1/p' "$dir/LAWS.bend"); do
  grep -qE "^def Laws\.$law\(" "$dir/PROOF.bend" || fail "law $law has no def Laws.$law in PROOF.bend"
done

out=$("$BEND" "$dir/PROOF.bend" 2>&1) || { printf '%s\n' "$out" >&2; fail "bend exited non-zero"; }
printf '%s\n' "$out" | grep -qx 'ALL PROOFS CHECK' || { printf '%s\n' "$out" >&2; fail "bend did not print ALL PROOFS CHECK"; }
[ -x "$dir/mutants/run.sh" ] || fail "missing $dir/mutants/run.sh"
BEND="$BEND" "$dir/mutants/run.sh" || fail "mutation observer failed"
echo "ALL PROOFS CHECK"
