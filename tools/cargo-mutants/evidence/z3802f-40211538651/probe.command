#!/usr/bin/env bash
# Run from an isolated checkout of ef1c1cea1876b662947bd4a6725f347f2db1263b.
# Pass the absolute retained-evidence directory as $1. GNU timeout bounds setup and testing together.
set -euo pipefail
probe_evidence=$1
probe_bin=$(mktemp -d)
trap 'rm -rf "$probe_bin"' EXIT
printf '%s\n' "$(date --utc --iso-8601=ns) setup-start" >> "$probe_evidence/stages.txt"
curl --connect-timeout 10 --max-time 60 -fLsS https://github.com/sourcefrog/cargo-mutants/releases/download/v27.1.0/cargo-mutants-x86_64-unknown-linux-gnu.tar.gz -o "$probe_bin/cargo-mutants.tar.gz"
sha256sum "$probe_bin/cargo-mutants.tar.gz" > "$probe_evidence/download.sha256"
tar -xzf "$probe_bin/cargo-mutants.tar.gz" -C "$probe_bin"
"$probe_bin/cargo-mutants" mutants --version
printf '%s\n' "$(date --utc --iso-8601=ns) tool-start" >> "$probe_evidence/stages.txt"
set +e
"$probe_bin/cargo-mutants" mutants --in-diff "$probe_evidence/pr-4028.diff" --in-place --test-tool nextest --test-workspace false --output "$probe_evidence"
probe_status=$?
printf '%s\n' "$probe_status" > "$probe_evidence/tool.exit"
printf '%s\n' "$(date --utc --iso-8601=ns) tool-end" >> "$probe_evidence/stages.txt"
exit "$probe_status"
