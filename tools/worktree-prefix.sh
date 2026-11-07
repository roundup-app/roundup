#!/usr/bin/env bash
# RB3798c: a `worktree_*` message prefix is built only in crates/agents/src/worktree/error.rs.
set -euo pipefail
cd "$(dirname "$0")/.."
hits=$(grep -rnE '"worktree_(missing|branch_missing|mismatched|detached|unregistered|unlanded|dirty|failed)\b' crates/agents/src --include=*.rs | grep -v '^crates/agents/src/worktree/error.rs' || true)
if [ -n "$hits" ]; then
    echo "worktree error prefixes belong in worktree/error.rs:"; echo "$hits"; exit 1
fi
