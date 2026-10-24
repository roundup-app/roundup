#!/usr/bin/env bash
# A3564f: the guard exits 0 on a clean tree, 1 naming the file and token for each forbidden
# literal in each root family, and 2 when a root is missing or unreadable.
# Usage: tools/question-guard/guard.test.sh
set -uo pipefail

guard=$(cd "$(dirname "$0")" && pwd)/guard.sh
scratch=$(mktemp -d)
trap 'chmod -R u+rwx "$scratch" 2>/dev/null; rm -rf "$scratch"' EXIT

layout() { # layout <dir>: one clean file in each root family
  mkdir -p "$1/apps/desktop/src" "$1/crates/agents/src" "$1/crates/contracts/src"
  for file in apps/desktop/src/app.ts crates/agents/src/lib.rs crates/contracts/src/lib.rs; do
    echo "clean" > "$1/$file"
  done
}

fails=0
check() { # check <name> <want-rc> <want-text> <dir>
  local out rc
  out=$("$guard" "$4" 2>&1); rc=$?
  if [ "$rc" = "$2" ] && grep -q -- "$3" <<<"$out"; then echo "ok   $1"; else echo "FAIL $1 (rc $rc: $out)"; fails=$((fails + 1)); fi
}

a3564f_custom_question_guard_rejects_each_token() {
  local tokens=("ask""_user" "Decision""Card" "decision"".answer")
  layout "$scratch/clean"
  check "clean source in all three root families" 0 "" "$scratch/clean"
  local family file token n=0
  for family in apps/desktop/src/app.ts crates/agents/src/lib.rs crates/contracts/src/lib.rs; do
    for token in "${tokens[@]}"; do
      n=$((n + 1))
      layout "$scratch/$n"
      echo "uses $token here" >> "$scratch/$n/$family"
      check "$token in $family" 1 "$family: $token" "$scratch/$n"
    done
  done
  layout "$scratch/untokened"
  echo "ask user" >> "$scratch/untokened/crates/agents/src/lib.rs"
  check "a near miss is clean" 0 "" "$scratch/untokened"
  layout "$scratch/missing"
  rm -r "$scratch/missing/apps/desktop/src"
  check "a missing root exits 2" 2 "cannot read" "$scratch/missing"
  layout "$scratch/unreadable"
  chmod 000 "$scratch/unreadable/crates/agents/src"
  if [ -r "$scratch/unreadable/crates/agents/src" ]; then
    echo "skip unreadable root (the user can read everything)"
  else
    check "an unreadable root exits 2" 2 "cannot read" "$scratch/unreadable"
  fi
}

a3564f_custom_question_guard_rejects_each_token
exit $((fails > 0))
