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
# U5501: alert vocabulary is allowed only at its existing call sites. The old
# delivery spellings still fail even beside an allowed alert token in that file.
for file in state/held.ts state/connectedProject.ts rail/RailFooter.tsx terminal/screens.ts; do
    fresh
    mkdir -p "$tmp/tree/apps/desktop/src/$(dirname "$file")"
    case $file in
        state/*) alert=createHeld ;;
        *) alert=held ;;
    esac
    echo "$alert" > "$tmp/tree/apps/desktop/src/$file"
    "$guard" "$tmp/tree" || fail "alert $alert in $file rejected"
    for retired in Held HeldAction held_message message_held takeover TAKEOVER; do
        echo "$alert $retired" > "$tmp/tree/apps/desktop/src/$file"
        set +e
        out=$("$guard" "$tmp/tree" 2>&1)
        code=$?
        set -e
        [ "$code" = 1 ] || fail "retired $retired beside alert in $file exits $code"
        case $out in *"apps/desktop/src/$file"*) ;; *) fail "file not named: $out" ;; esac
    done
done
# Copying an alert symbol into another module does not expand the exception.
fresh
echo createHeld > "$tmp/tree/apps/desktop/src/a.ts"
if "$guard" "$tmp/tree" > /dev/null 2>&1; then fail "new alert call site accepted"; fi
echo ok
