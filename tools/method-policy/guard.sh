#!/usr/bin/env bash
# A decision keyed on a method name has one definition, `crates/rupd/src/route/policy.rs`:
# the router, its guards, Auto, the selectors and the wire reader compare a method name. `$1` is the root.
set -euo pipefail
cd "${1:-.}"
files=(crates/rupd/src/connection.rs crates/rupd/src/auto.rs crates/rupd/src/selectors.rs
    crates/rupd/src/route/mod.rs crates/rupd/src/route/gates.rs)
found=$(grep -lPz '(\bmethod\s*[!=]=\s*"|matches!\(\s*(&\s*)?method\b|match\s+(&\s*)?method\s*\{)' "${files[@]}" || true)
if [ -n "$found" ]; then
    echo "method name compared outside crates/rupd/src/route/policy.rs:" >&2
    echo "$found" >&2
    exit 1
fi
