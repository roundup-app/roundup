#!/usr/bin/env bash
# A3564f: no source under the App, a crate's `src` or `crates/contracts` names the custom question
# path. Exits 0 when clean, 1 naming each file and token found, 2 when a scan root is missing or
# unreadable. Usage: tools/question-guard/guard.sh [repo-root]
# The tokens are written in two halves so this file never holds one whole.
set -uo pipefail

root=${1:-$(cd "$(dirname "$0")/../.." && pwd)}
tokens=("ask""_user" "Decision""Card" "decision"".answer")

roots=("$root/apps/desktop/src" "$root/crates/contracts")
[ -d "$root/crates" ] && [ -r "$root/crates" ] || { echo "guard: cannot read $root/crates" >&2; exit 2; }
for crate in "$root"/crates/*/; do
  [ -d "${crate}src" ] && roots+=("${crate}src")
done
for dir in "${roots[@]}"; do
  [ -d "$dir" ] && [ -r "$dir" ] && [ -x "$dir" ] || { echo "guard: cannot read $dir" >&2; exit 2; }
done

found=0
for token in "${tokens[@]}"; do
  hits=$(grep -rIlF --exclude-dir=node_modules --exclude-dir=target -- "$token" "${roots[@]}" 2>/dev/null)
  case $? in
    0) while IFS= read -r file; do echo "$file: $token"; done <<<"$hits"; found=1 ;;
    1) ;;
    *) echo "guard: grep failed on $token" >&2; exit 2 ;;
  esac
done
exit $found
