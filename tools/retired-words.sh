#!/usr/bin/env bash
# B3563f/U5501: reject retired delivery words, except exact held-alert vocabulary.
# Scan production roots, comments and tests included, in any case. `$1` is the root.
set -euo pipefail
root=${1:-.}
cd "$root"
roots=()
for dir in apps/desktop/src crates/*/src crates/contracts; do
    [ -d "$dir" ] && roots+=("$dir")
done
[ ${#roots[@]} -gt 0 ] || exit 0
# U5501 reuses the user label for alert snapshots only. Exact file/token pairs below
# permit that vocabulary without allowing retired delivery names or new call sites.
python3 - "${roots[@]}" <<'PYTHON'
import pathlib
import re
import sys

alert_tokens = {
    "apps/desktop/src/sharedCopy.ts": {"held"},
    "apps/desktop/src/rail/RailFooter.tsx": {"held", "held-content", "held-line", "held-row"},
    "apps/desktop/src/rail/copy.ts": {"held", "held:"},
    "apps/desktop/src/rail/styles.css": {"held-content", "held-line", "held-row"},
    "apps/desktop/src/rail/u5501_capture.test.ts": {
        "-held-refused", "held-row", "u5501_rendered_levels_held_and_refusal",
    },
    "apps/desktop/src/rail/u5501_held.test.tsx": {
        "held", "held-row", "roundup:held:",
        "u5501_a_failed_or_gone_target_open_preserves_held_rows",
        "u5501_held_rows_keep_event_identity_content_and_order_across_reopen",
        "u5501_opening_an_agent_clears_only_its_held_rows",
    },
    "apps/desktop/src/toasts/watch.tsx": {"held"},
    "apps/desktop/src/toasts/u5501_levels.test.tsx": {"held"},
    "apps/desktop/src/state/connectedProject.ts": {"createHeld", "held", "held:"},
    "apps/desktop/src/state/held.ts": {"createHeld", "heldSchema", "roundup:held", "roundup:held:"},
    "apps/desktop/src/terminal/screens.ts": {"held"},
}

bad = set()
for root in sys.argv[1:]:
    for path in pathlib.Path(root).rglob("*"):
        if not path.is_file() or {"node_modules", "target"}.intersection(path.parts):
            continue
        data = path.read_bytes()
        if b"\0" in data:
            continue
        source = data.decode("utf-8", errors="replace")
        allowed = alert_tokens.get(str(path), set())
        if re.search("takeover", source, re.IGNORECASE) or any(
            token not in allowed
            for token in re.findall(r"[\w:-]*held[\w:-]*", source, re.IGNORECASE)
        ):
            bad.add(str(path))
if bad:
    print("retired word (takeover, held) in:", *sorted(bad), sep="\n", file=sys.stderr)
    sys.exit(1)
PYTHON
