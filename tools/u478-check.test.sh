#!/usr/bin/env bash
# Run explicitly: this observer invokes the complete check gate and must not recurse from it.
set -euo pipefail
cd "$(dirname "$0")/.."
case_name=${1:?usage: u478-check.test.sh raw|tokens|clean|freshness [base]}
base=${2:-}
probe=apps/desktop/src/u478-integration-probe.css
package=apps/desktop/package.json
log=$(mktemp)
backup=$(mktemp)
test ! -e "$probe"
cp "$package" "$backup"
cleanup() {
    rm -f "$probe" "$log"
    cp "$backup" "$package"
    rm -f "$backup"
}
trap cleanup EXIT
case "$case_name" in
    raw) echo '.u478-probe { padding: 7px; }' > "$probe" ;;
    tokens) echo '.u478-probe { padding: 0 var(--space-1); }' > "$probe" ;;
    clean) ;;
    freshness)
        node --input-type=module - "$package" <<'JS'
import fs from 'node:fs';
const path = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
if (pkg.scripts['tokens:check']) throw new Error('Run the owning freshness observer instead');
pkg.scripts['tokens:check'] = 'node -e "console.error(\'U478 freshness observer reached\'); process.exit(37)"';
fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
JS
        ;;
    *) exit 2 ;;
esac
status=0
just check "$base" > "$log" 2>&1 || status=$?
cat "$log"
printf '\nU478 case=%s base=%s actual-exit=%s\n' "$case_name" "$base" "$status"
case "$case_name" in
    raw)
        test "$status" -ne 0
        rg 'u478-integration-probe.css' "$log"
        rg 'scale-unlimited/declaration-strict-value' "$log"
        ;;
    freshness)
        test "$status" -ne 0
        rg 'U478 freshness observer reached' "$log"
        rg 'just packages tokens:check' "$log"
        ;;
    *) test "$status" -eq 0 ;;
esac
