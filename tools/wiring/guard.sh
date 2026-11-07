#!/usr/bin/env bash
# Naming, Context and Coordination reach Agents as one `Wiring` trait object, so
# crates/agents/src/lib.rs holds no `Option<Arc<dyn Fn` field (am12-wiring-trait).
# Usage: guard.sh [root]
set -euo pipefail
root=${1:-$(cd "$(dirname "$0")/../.." && pwd)}
if grep -n 'Option<Arc<dyn Fn' "$root/crates/agents/src/lib.rs" >&2; then
  echo "crates/agents/src/lib.rs holds an 'Option<Arc<dyn Fn' field; put the capability on agents::Wiring" >&2
  exit 1
fi
