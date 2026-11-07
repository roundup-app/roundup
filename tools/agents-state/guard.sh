#!/usr/bin/env bash
# A fact that exists only while an Agent is known lives in that Agent's entry in `runs`, so
# crates/agents/src/lib.rs holds exactly one `Mutex<HashMap<String,` (am10-agent-entry).
# Usage: guard.sh [root]
set -euo pipefail
root=${1:-$(cd "$(dirname "$0")/../.." && pwd)}
n=$(grep -c 'Mutex<HashMap<String,' "$root/crates/agents/src/lib.rs" || true)
if [ "$n" != 1 ]; then
  echo "crates/agents/src/lib.rs holds $n 'Mutex<HashMap<String,' fields, want 1 (runs); put an Agent-keyed fact in agent::Agent:" >&2
  grep -n 'Mutex<HashMap<String,' "$root/crates/agents/src/lib.rs" >&2 || true
  exit 1
fi
