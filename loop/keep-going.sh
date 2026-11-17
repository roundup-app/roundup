#!/usr/bin/env bash
# The interpreter of a `just` script recipe (`[script('loop/keep-going.sh')]`): runs each line of the body file $1 in its
# own `bash -euo pipefail -c` (L98) and keeps going after a line fails, then exits 1 naming every failed line (L89).
# Each line logs its seconds as it ends, and the slowest lines print last and go to the job summary (CI7324b).
# One command per line. A Ctrl-C, a cancelled job or a line exiting 130 stops it at once.
set -uo pipefail
trap 'exit 130' INT
trap 'exit 143' TERM
failed=''
times=''
while IFS= read -r line <&3 || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    echo "$line" >&2
    start=$(date +%s)
    bash -euo pipefail -c "$line" 3<&-
    code=$?
    secs=$(( $(date +%s) - start ))
    echo "[${secs}s] $line (exit $code)" >&2
    times+="$secs $line"$'\n'
    [ "$code" -ne 0 ] || continue
    [ "$code" -ne 130 ] || exit 130
    failed+="  $line (exit $code)"$'\n'
done 3<"$1"
if [ -n "$times" ]; then
    slowest=$(printf '%s' "$times" | sort -rn -s -k1,1 | head -n 10)
    printf 'slowest lines, seconds first:\n%s\n' "$slowest" >&2
    [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '### Slowest lines\n\n```\n%s\n```\n' "$slowest" >> "$GITHUB_STEP_SUMMARY"
fi
[ -z "$failed" ] || { printf 'failed lines:\n%s' "$failed" >&2; exit 1; }
