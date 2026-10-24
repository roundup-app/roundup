#!/usr/bin/env bash
# B3563f: the guard exits 0 on a clean tree and 1, naming the file, for each retired word in each
# case under each scanned root.
set -euo pipefail
guard=$(cd "$(dirname "$0")" && pwd)/retired-words.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

fresh() {
    rm -rf "$tmp/tree"
    mkdir -p "$tmp/tree/apps/desktop/src" "$tmp/tree/crates/one/src" "$tmp/tree/crates/contracts/src"
    echo clean > "$tmp/tree/apps/desktop/src/a.ts"
    echo clean > "$tmp/tree/crates/one/src/a.rs"
    echo clean > "$tmp/tree/crates/contracts/src/a.rs"
}

fresh
"$guard" "$tmp/tree" || fail "clean tree exits $?"

for dir in apps/desktop/src crates/one/src crates/contracts/src; do
    for word in takeover TAKEOVER TakeOver held HELD Held; do
        fresh
        echo "// a $word b" > "$tmp/tree/$dir/bad.txt"
        set +e
        out=$("$guard" "$tmp/tree" 2>&1)
        code=$?
        set -e
        [ "$code" = 1 ] || fail "$word in $dir exits $code"
        case $out in *"$dir/bad.txt"*) ;; *) fail "$word in $dir: file not named: $out" ;; esac
    done
done
echo ok
