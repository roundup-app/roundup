#!/usr/bin/env bash
# The interpreter of a `just` script recipe (`[script('loop/keep-going.sh')]`): runs each line of the body file $1 in its
# own `bash -euo pipefail -c` (L98) and keeps going after a line fails, then exits 1 naming every failed line (L89).
# One command per line. A Ctrl-C, a cancelled job or a line exiting 130 stops it at once.
set -uo pipefail
trap 'exit 130' INT
trap 'exit 143' TERM
failed=''
while IFS= read -r line <&3 || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    echo "$line" >&2
    bash -euo pipefail -c "$line" 3<&- && continue
    code=$?
    [ "$code" -ne 130 ] || exit 130
    failed+="  $line (exit $code)"$'\n'
done 3<"$1"
[ -z "$failed" ] || { printf 'failed lines:\n%s' "$failed" >&2; exit 1; }
