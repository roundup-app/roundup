#!/usr/bin/env bash
# L2, L23: stamp authored commits in a disposable Builder checkout before the model runs.
set -euo pipefail
[[ ${1:-} =~ ^[A-Za-z0-9_.-]+$ ]] || { echo 'expected an Author-Agent id' >&2; exit 2; }
: "${RUNNER_TEMP:?requires a disposable runner directory}"
hooks=$(mktemp -d "$RUNNER_TEMP/roundup-author.XXXXXX")
printf '#!/usr/bin/env bash\nset -euo pipefail\ngit interpret-trailers --in-place --if-exists doNothing --trailer %q "$1"\n' "Author-Agent: $1" >"$hooks/prepare-commit-msg"
chmod +x "$hooks/prepare-commit-msg"
# L97: a push renumbers a scenario id main or another branch took since the run picked it.
cp "$(dirname "$0")/scenario_ids.py" "$(dirname "$0")/orders.py" "$hooks/"
printf '#!/usr/bin/env bash\nexec python3 %q mint "$1"\n' "$hooks/scenario_ids.py" >"$hooks/pre-push"
chmod +x "$hooks/pre-push"
git config --local core.hooksPath "$hooks"
