#!/usr/bin/env bash
# The Rail's `nodes` table is read only through crates/agents/src/rail/ (RB3798c); rupd calls its `*_in` functions.
set -euo pipefail
cd "$(dirname "$0")/../.."
if hits=$(grep -rnE 'FROM +nodes|JOIN +nodes' crates/rupd/src/deliverables crates/rupd/src/deliverables.rs 2>/dev/null); then
  echo "SQL over nodes belongs in crates/agents/src/rail/:" >&2
  echo "$hits" >&2
  exit 1
fi
