#!/usr/bin/env bash
set -euo pipefail
# Usage: reproduce.sh <fresh-output-directory> [repaired-ref]
owner_evidence=$(cd "$(dirname "$0")" && pwd)
owner_output=$(realpath -m "${1:?fresh output directory required}")
owner_repaired=${2:-dd980f90}
# R5460 retired the lookup; reproduce its diagnostic script from the historical checkout.
owner_before=4b75b448378a626ec630fb192e2a10e124675c6b
test ! -e "$owner_output"
mkdir -p "$owner_output"
git show 7e2607e54:crates/agents/r16/owner-read/instrument.py > "$owner_output/instrument.py"
for owner_name in before after; do
    owner_ref=$owner_before
    if [ "$owner_name" = after ]; then owner_ref=$owner_repaired; fi
    owner_work="$owner_output/work-$owner_name"
    git worktree add --detach "$owner_work" "$owner_ref"
    (
        cd "$owner_work"
        python3 "$owner_evidence/record.py" "$owner_output" "$owner_name-build" cargo build --release -p rupd
        cp target/release/rupd "$owner_output/rupd-$owner_name"
        python3 "$owner_evidence/record.py" "$owner_output" "$owner_name-probe" python3 "$owner_evidence/isolate.py" "$owner_output/rupd-$owner_name" "$owner_output/$owner_name.json"
        python3 "$owner_output/instrument.py" "$owner_work"
        cargo fmt --all
        git diff > "$owner_output/instrument-$owner_name.patch"
        python3 "$owner_evidence/record.py" "$owner_output" "$owner_name-profile-build" cargo build --release -p rupd
        cp target/release/rupd "$owner_output/rupd-$owner_name-profile"
        git apply -R "$owner_output/instrument-$owner_name.patch"
        git diff --exit-code
        python3 "$owner_evidence/record.py" "$owner_output" "$owner_name-profile-probe" python3 "$owner_evidence/isolate.py" "$owner_output/rupd-$owner_name-profile" "$owner_output/$owner_name-profile.json"
    )
done
python3 "$owner_evidence/record.py" "$owner_output" metadata python3 "$owner_evidence/metadata.py" "$owner_output" "$owner_before" "$owner_repaired"
python3 "$owner_evidence/summarize.py" "$owner_output"
