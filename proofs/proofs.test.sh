#!/usr/bin/env bash
# Tests for proofs/setup.sh (V1) and proofs/check.sh (V2) with a fake download and a fake bend. Usage: proofs/proofs.test.sh
set -uo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
expect() { # expect <name> <want-rc> <want-text> <got-rc> <got-out>
  if [ "$4" = "$2" ] && grep -q -- "$3" <<<"$5"; then ok "$1"; else bad "$1 (rc $4: $5)"; fi
}

# ---- V1: fake release asset whose bend prints the version it was built with
mkasset() { # mkasset <dir> <version-the-binary-prints>
  mkdir -p "$1/pkg/bend/bin"
  printf '#!/bin/sh\n[ "$BEND_NO_TELEMETRY" = 1 ] || exit 3\necho %s\n' "$2" > "$1/pkg/bend/bin/bend"
  chmod +x "$1/pkg/bend/bin/bend"
  tar -czf "$1/bend-9.9.9-test-x64.tar.gz" -C "$1/pkg" bend
}
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
setup() { # setup <case-dir> <printed-version> -> runs setup.sh
  local c=$1
  mkdir -p "$c/dl" "$c/proofs"
  mkasset "$c/dl" "$2"
  echo 9.9.9 > "$c/proofs/BEND_VERSION"
  echo "$(sha "$c/dl/bend-9.9.9-test-x64.tar.gz")  bend-9.9.9-test-x64.tar.gz" > "$c/proofs/BEND_SHA256"
}
run_setup() { PROOFS_DIR=$1/proofs BEND_BASE_URL=file://$1/dl BEND_ASSET_PLATFORM=test-x64 "$root/proofs/setup.sh" 2>&1; }

setup "$scratch/a" 9.9.9
out=$(run_setup "$scratch/a"); rc=$?
if [ $rc = 0 ] && [ -x "$scratch/a/proofs/.tools/bend/bin/bend" ]; then ok "v1 a matching version installs into .tools"; else bad "v1 matching ($rc: $out)"; fi

setup "$scratch/b" 1.0.0
out=$(run_setup "$scratch/b"); expect "v1 a mismatching version exits 1 naming the tool" 1 "bend: installed version" "$?" "$out"
[ ! -e "$scratch/b/proofs/.tools/bend" ] && ok "v1 a mismatch installs nothing" || bad "v1 mismatch left an install"

setup "$scratch/c" 9.9.9
echo "$(printf 0%.0s $(seq 64))  bend-9.9.9-test-x64.tar.gz" > "$scratch/c/proofs/BEND_SHA256"
out=$(run_setup "$scratch/c"); expect "v1 a wrong checksum exits 1" 1 "checksum" "$?" "$out"

setup "$scratch/d" 9.9.9
mkdir "$scratch/nocurl"
for t in bash env tr sed awk uname mktemp rm dirname cat cut sha256sum shasum tar mkdir mv grep; do p=$(command -v "$t") && ln -sf "$p" "$scratch/nocurl/$t"; done
out=$(PATH=$scratch/nocurl PROOFS_DIR=$scratch/d/proofs BEND_BASE_URL=file://$scratch/d/dl BEND_ASSET_PLATFORM=test-x64 "$root/proofs/setup.sh" 2>&1); expect "v1 a missing curl exits 1" 1 "curl" "$?" "$out"

out=$(run_setup "$scratch/a"); [ $? = 0 ] && ok "v1 an installed pin is not downloaded again" || bad "v1 rerun"
grep -qx 2.0.34 "$root/proofs/BEND_VERSION" && ok "v1 the pin is 2.0.34" || bad "v1 pin"

# ---- V2: a layout copy, a fake bend that prints what FAKE_OUT says
cp -r "$root/proofs/messages" "$scratch/layout"
rm -rf "$scratch/layout/mutants"
cat > "$scratch/bend" <<'F'
#!/bin/sh
printf '%s\n' "$FAKE_OUT"
exit "${FAKE_RC:-0}"
F
chmod +x "$scratch/bend"
check() { BEND=$scratch/bend FAKE_OUT="${FAKE_OUT-ALL PROOFS CHECK}" "$root/proofs/check.sh" "$1" 2>&1; }
fresh() { rm -rf "$scratch/l"; cp -r "$scratch/layout" "$scratch/l"; }

fresh; out=$(check "$scratch/l"); expect "v2 a clean layout prints ALL PROOFS CHECK" 0 "ALL PROOFS CHECK" "$?" "$out"
fresh; out=$(FAKE_OUT="SOME PROOFS FAIL" check "$scratch/l"); expect "v2 any other output fails" 1 "did not print" "$?" "$out"
fresh; out=$(FAKE_RC=1 check "$scratch/l"); expect "v2 a non-zero bend fails" 1 "non-zero" "$?" "$out"
fresh; rm "$scratch/l/model.bend"; out=$(check "$scratch/l"); expect "v2 a missing file fails naming it" 1 "model.bend" "$?" "$out"
fresh; echo '  @unsafe' >> "$scratch/l/PROOF.bend"; out=$(check "$scratch/l"); expect "v2 @unsafe fails" 1 "@unsafe" "$?" "$out"
fresh; echo '  ?TODO' >> "$scratch/l/PROOF.bend"; out=$(check "$scratch/l"); expect "v2 ?TODO fails" 1 "TODO" "$?" "$out"
fresh; printf '\nlaw m99_extra:\n  for evs: +List<M.Ev>\n  {True{} == True{} : Bool}\n' >> "$scratch/l/LAWS.bend"; out=$(check "$scratch/l"); expect "v2 a law with no def Laws fails naming it" 1 "m99_extra" "$?" "$out"
fresh; sed -i 's/^def Laws\.m6_no_silent_loss(/def Laws.renamed(/' "$scratch/l/PROOF.bend"; out=$(check "$scratch/l"); expect "v2 a law deleted from PROOF.bend fails naming it" 1 "m6_no_silent_loss" "$?" "$out"
out=$(BEND=$scratch/none "$root/proofs/check.sh" "$scratch/layout" 2>&1); expect "v2 a missing bend fails" 1 "just proofs-setup" "$?" "$out"

[ $fails = 0 ] || { echo "$fails failed"; exit 1; }
