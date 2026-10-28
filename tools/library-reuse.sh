#!/usr/bin/env bash
# Z3742p: an offline AST recurrence check; 0 clean, 1 violations, 2 invalid input.
set -euo pipefail
exec python3 "$(dirname "$0")/library-reuse.py" "${1:-.}"
