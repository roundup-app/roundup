#!/usr/bin/env bash
# The Daemon calls Todos, Pads and the Rail through typed functions, never `module.call(ctx, "todo.list", json!(…))`:
# no `.call(` with a method literal of those namespaces in crates/rupd/src outside tests. `$1` is the root.
set -euo pipefail
cd "${1:-.}"
found=$(find crates/rupd/src -name '*.rs' ! -name '*tests.rs' ! -path '*/tests/*' | sort | while read -r file; do
    perl -0777 -ne 's/#\[cfg\(test\)\].*//s; print "$ARGV\n" if /\.call\(\s*[^"]*?,\s*"(todo|pad|rail)\./' "$file"
done)
if [ -n "$found" ]; then
    echo "a Todos, Pads or Rail call by method name in rupd production code:" >&2
    echo "$found" >&2
    exit 1
fi
