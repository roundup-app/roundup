#!/usr/bin/env bash
# The Rail's `nodes` table is read only through crates/agents/src/rail.rs and rail/ (RB3798c); the daemon calls its `*_in` functions.
set -euo pipefail
cd "$(dirname "$0")/../.."
if hits=$(grep -rnE 'FROM +nodes|JOIN +nodes' crates/ru[p]d/src/deliverables 2>/dev/null) ||
   hits=$(grep -rnE 'FROM +nodes|JOIN +nodes' crates/agents/src --exclude-dir=rail --exclude=rail.rs --exclude=schema.rs 2>/dev/null); then
  echo "SQL over nodes belongs in crates/agents/src/rail/:" >&2
  echo "$hits" >&2
  exit 1
fi
