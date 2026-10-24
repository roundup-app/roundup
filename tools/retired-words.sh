#!/usr/bin/env bash
# B3563f: fails, naming each file, when a retired word is in production source: apps/desktop/src,
# crates/*/src or crates/contracts, comments and tests included, in any case. `$1` is the root.
set -euo pipefail
root=${1:-.}
cd "$root"
roots=()
for dir in apps/desktop/src crates/*/src crates/contracts; do
    [ -d "$dir" ] && roots+=("$dir")
done
[ ${#roots[@]} -gt 0 ] || exit 0
if files=$(grep -rIliE 'takeover|held' --exclude-dir=node_modules --exclude-dir=target "${roots[@]}"); then
    echo "retired word (takeover, held) in:" >&2
    echo "$files" >&2
    exit 1
fi
