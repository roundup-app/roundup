#!/usr/bin/env bash
# Z3742p: exercise the real source guard without starting an App or Daemon.
set -euo pipefail
guard=$(cd "$(dirname "$0")" && pwd)/library-reuse.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
fresh() {
    rm -rf "$tmp/tree"
    mkdir -p "$tmp/tree/apps/desktop/src" "$tmp/tree/crates/one/src" "$tmp/tree/tools"
    echo '[]' > "$tmp/tree/tools/library-reuse-exceptions.json"
}
expect_exit() {
    local want=$1 code=0
    shift
    output=$("$guard" "$@" 2>&1) || code=$?
    [ "$code" = "$want" ] || fail "wanted $want, got $code: $output"
}

z3742p_guard_rejects_each_telltale() {
    fresh
    printf '%s\n' 'const note = "Note: mention !important in documentation";' > "$tmp/tree/apps/desktop/src/a.ts"
    printf '%s\n' 'fn clean() { child.try_wait(); thread::sleep(delay); println!("SystemTime::now()"); }' > "$tmp/tree/crates/one/src/a.rs"
    expect_exit 0 "$tmp/tree"

    # Ignore files cannot hide owned source; generated/dependency trees are outside the scan.
    echo 'apps/desktop/src/a.ts' > "$tmp/tree/.ignore"
    echo 'const copy = element.cloneNode();' > "$tmp/tree/apps/desktop/src/a.ts"
    expect_exit 1 "$tmp/tree"
    fresh
    mkdir -p "$tmp/tree/apps/desktop/src/generated" "$tmp/tree/crates/one/target"
    echo 'const copy = element.cloneNode();' > "$tmp/tree/apps/desktop/src/generated/a.ts"
    echo 'fn bad() { SystemTime::now(); }' > "$tmp/tree/crates/one/target/a.rs"
    expect_exit 0 "$tmp/tree"

    local source telltale
    while IFS='|' read -r telltale source; do
        fresh
        printf '%b\n' "$source" > "$tmp/tree/apps/desktop/src/a.tsx"
        expect_exit 1 "$tmp/tree"
        [[ $output == *apps/desktop/src/a.tsx* && $output == *"$telltale"* ]] || fail "$telltale diagnostic: $output"
    done <<'CASES'
cloneNode|const clone = element.cloneNode(true);
cloneNode|const clone = element["cloneNode"](true);
important-style|const style = "color: red !important";
important-style|const style = `\n.color {\n color: red !important;\n}\n`;
important-style|const style = { color: "red !important" };
CASES

    while IFS='|' read -r telltale source; do
        fresh
        printf '%b\n' "$source" > "$tmp/tree/crates/one/src/a.rs"
        expect_exit 1 "$tmp/tree"
        [[ $output == *crates/one/src/a.rs* && $output == *"$telltale"* ]] || fail "$telltale diagnostic: $output"
    done <<'CASES'
polling-wait|fn bad() { loop { child.try_wait(); thread::sleep(delay); } }
polling-wait|fn bad() { while child.try_wait().is_none() { std::thread::\n sleep(delay); } }
polling-wait|fn bad() { for child in children { child.\n try_wait(); ::std::thread::sleep(delay); } }
polling-wait|fn bad() { while matches!(child.try_wait(), Ok(None)) { std::thread::sleep(delay); } }
system-time|fn bad() { SystemTime::now(); }
system-time|fn bad() { std::time::SystemTime ::\n now(); }
system-time|fn bad() { format!("{}", std::time::SystemTime::now()); }
system-time|fn bad() { assert!(SystemTime::now() > before); }
CASES

    fresh
    echo 'const copy = element.cloneNode();' > "$tmp/tree/apps/desktop/src/a.ts"
    echo 'fn bad() { SystemTime::now(); }' > "$tmp/tree/crates/one/src/a.rs"
    expect_exit 1 "$tmp/tree"
    [[ $output == *apps/desktop/src/a.ts* && $output == *crates/one/src/a.rs* ]] || fail "lost a violation: $output"

    expect_exit 2 "$tmp/missing"
    fresh
    chmod 000 "$tmp/tree/apps/desktop/src"
    expect_exit 2 "$tmp/tree"
    chmod 755 "$tmp/tree/apps/desktop/src"
    fresh
    echo '[{"telltale":"system-time","file":"crates/one/src/a.rs","symbol":"bad","reason":""}]' > "$tmp/tree/tools/library-reuse-exceptions.json"
    expect_exit 2 "$tmp/tree"
    [[ $output == *exception* ]] || fail "invalid exception lacks diagnostic"
}

z3742p_exceptions_are_narrow() {
    fresh
    echo '[{"telltale":"system-time","file":"crates/one/src/a.rs","symbol":"allowed","reason":"Explicit filesystem-clock fixture"}]' > "$tmp/tree/tools/library-reuse-exceptions.json"
    echo 'fn allowed() { SystemTime::now(); }' > "$tmp/tree/crates/one/src/a.rs"
    expect_exit 0 "$tmp/tree"
    echo 'fn beside() { SystemTime::now(); }' >> "$tmp/tree/crates/one/src/a.rs"
    expect_exit 1 "$tmp/tree"
    [[ $output == *beside* ]] || fail "adjacent symbol escaped: $output"
    echo 'fn allowed() { SystemTime::now(); }' > "$tmp/tree/crates/one/src/b.rs"
    expect_exit 1 "$tmp/tree"
    [[ $output == *crates/one/src/b.rs* ]] || fail "adjacent file escaped: $output"

    fresh
    echo '[{"telltale":"system-time","file":"crates/one/src/a.rs","symbol":"clock","reason":"The designated clock helper","helper":true}]' > "$tmp/tree/tools/library-reuse-exceptions.json"
    echo 'fn clock() { SystemTime::now(); }' > "$tmp/tree/crates/one/src/a.rs"
    expect_exit 0 "$tmp/tree"
    echo '[{"telltale":"system-time","file":"crates/one/src/a.rs","symbol":"clock","reason":"First helper","helper":true},{"telltale":"system-time","file":"crates/one/src/a.rs","symbol":"other","reason":"Second helper","helper":true}]' > "$tmp/tree/tools/library-reuse-exceptions.json"
    expect_exit 2 "$tmp/tree"
    [[ $output == *'at most one'* ]] || fail "multiple helpers escaped: $output"
}

z3742p_guard_rejects_each_telltale
z3742p_exceptions_are_narrow
echo 'Z3742p passes'
