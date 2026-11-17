#!/usr/bin/env bash
# The interpreter of a `just` script recipe (`[script('loop/keep-going.sh')]`): runs each line of the body file $1 in its
# own `bash -euo pipefail -c` (L98) and keeps going after a line fails, then exits 1 naming every failed line (L89).
# Each line logs its seconds as it ends, and the slowest lines print last and go to the job summary (CI7324b).
# One command per line. A line starting `& ` runs in the background beside the lines after it and is joined at the end
# (its output prints whole when it ends); it holds nothing the later lines need. A Ctrl-C, a cancelled job or a line exiting 130 stops it at once.
set -uo pipefail
trap 'kill $(jobs -p) 2>/dev/null; exit 130' INT
trap 'kill $(jobs -p) 2>/dev/null; exit 143' TERM
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
# Runs one line, logs its seconds and appends "seconds line" to $2 and a failure to $3.
run_line() {
    local line=$1 start=$(date +%s) code secs
    echo "$line" >&2
    bash -euo pipefail -c "$line" 3<&-
    code=$?
    secs=$(( $(date +%s) - start ))
    echo "[${secs}s] $line (exit $code)" >&2
    echo "$secs $line" >>"$2"
    [ "$code" -eq 0 ] || echo "  $line (exit $code)" >>"$3"
    return "$code"
}
background=0
while IFS= read -r line <&3 || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    if [ "${line:0:2}" = '& ' ]; then
        background=$((background + 1))
        ( run_line "${line:2}" "$scratch/times.$background" "$scratch/failed.$background" ) >"$scratch/log.$background" 2>&1 &
        continue
    fi
    run_line "$line" "$scratch/times.0" "$scratch/failed.0"
    code=$?
    [ "$code" -ne 130 ] || exit 130
done 3<"$1"
wait
for ((n = 1; n <= background; n++)); do
    printf '::group::background line %s\n' "$n" >&2
    cat "$scratch/log.$n" >&2
    printf '::endgroup::\n' >&2
done
times=$(cat "$scratch"/times.* 2>/dev/null)
failed=$(cat "$scratch"/failed.* 2>/dev/null)
if [ -n "$times" ]; then
    slowest=$(printf '%s\n' "$times" | sort -rn -s -k1,1 | head -n 10)
    printf 'slowest lines, seconds first:\n%s\n' "$slowest" >&2
    [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '### Slowest lines\n\n```\n%s\n```\n' "$slowest" >> "$GITHUB_STEP_SUMMARY"
fi
[ -z "$failed" ] || { printf 'failed lines:\n%s\n' "$failed" >&2; exit 1; }
