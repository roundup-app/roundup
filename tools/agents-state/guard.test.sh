#!/usr/bin/env bash
# am10-agent-entry: the guard passes on one `Mutex<HashMap<String,` in lib.rs and fails on none or two.
set -euo pipefail
guard=$(cd "$(dirname "$0")" && pwd)/guard.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/crates/agents/src"
lib=$tmp/crates/agents/src/lib.rs
fail() { echo "FAIL: $*" >&2; exit 1; }
echo '    runs: Mutex<HashMap<String, Agent>>,' > "$lib"
"$guard" "$tmp" || fail "one field exits $?"
echo '    waits: Mutex<HashMap<String, Wait>>,' >> "$lib"
if "$guard" "$tmp" 2>/dev/null; then fail "two fields pass"; fi
echo '    other: u8,' > "$lib"
if "$guard" "$tmp" 2>/dev/null; then fail "no field passes"; fi
