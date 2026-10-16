#!/usr/bin/env bash
# N7: the ping round trip owns both its socket and its data, including a failed ping.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d)
dir=$(cd "$dir" && pwd -P)
daemon=
finish() {
  code=$?
  trap - EXIT
  if [[ -n $daemon ]]; then
    kill "$daemon" 2>/dev/null || true
    wait "$daemon" 2>/dev/null || true
  fi
  rm -rf "$dir"
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export RUPD_SOCKET="$dir/rupd.sock" ROUNDUP_DATA_DIR="$dir/data"
mkdir "$dir/project"
"${1:-$root/target/debug/rupd}" "$dir/project" >"$dir/stdout" 2>"$dir/stderr" &
daemon=$!
for _ in {1..60}; do
  if [[ -S $RUPD_SOCKET ]]; then break; fi
  if ! kill -0 "$daemon" 2>/dev/null; then cat "$dir/stderr" >&2; exit 1; fi
  sleep 0.25
done
[[ $("${2:-$root/target/debug/rup}" ping) == rupd\ * ]]
