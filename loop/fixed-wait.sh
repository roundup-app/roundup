#!/usr/bin/env bash
# One pinned parser environment for local and CI lint; no global Python packages.
set -euo pipefail
cd "$(dirname "$0")/.."
requirements=$(sha256sum loop/fixed-wait-requirements.txt | cut -d' ' -f1)
environment="${ROUNDUP_FIXED_WAIT_ENV:-target/fixed-wait-$requirements}"
if [[ ! -f "$environment/complete" ]]; then
    # A cache restore can leave part of an environment without its marker; rebuild it whole.
    python3 -m venv --clear "$environment"
    "$environment/bin/python" -m pip install -r loop/fixed-wait-requirements.txt >&2
    touch "$environment/complete"
fi
if [[ "${1:-}" == test ]]; then
    exec "$environment/bin/python" loop/fixed_wait.test.py
fi
exec "$environment/bin/python" loop/fixed_wait.py "$@"
