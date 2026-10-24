#!/usr/bin/env bash
# V1/V2/V4b/V5: pinned setup, proof observer and mutation evidence through temporary layouts. Usage: proofs/proofs.test.sh
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
cat > "$scratch/bend" <<'F'
#!/bin/sh
dir=$(dirname "$1")
if ! cmp -s "$dir/model.bend" "$FAKE_MODEL"; then
  id=$(sed -nE 's/^law ((m|b)[0-9]+)_.*/\1/p' "$dir/LAWS.bend" | head -1)
  case "$id" in
    m1) loc=send_auto_inv ;;
    m4) loc=fl_go4 ;; m5) loc=user_drop_inv ;; m6) loc=exit_inv ;;
    m7) loc=send_ev7 ;; m9) loc=restart_replay ;; m10) loc=fgo_alive10 ;; b39) loc=fconfirm_inv ;;
  esac
  printf '%s\n' "${FAKE_MUTANT_OUT:-SOME PROOFS FAIL}" "Location: ${FAKE_LOCATION:-$loc}"
  exit "${FAKE_MUTANT_RC:-1}"
fi
printf '%s\n' "$FAKE_OUT"
exit "${FAKE_RC:-0}"
F
chmod +x "$scratch/bend"
check() { BEND=$scratch/bend FAKE_MODEL=$root/proofs/messages/model.bend FAKE_OUT="${FAKE_OUT-ALL PROOFS CHECK}" "$root/proofs/check.sh" "$1" 2>&1; }
fresh() { rm -rf "$scratch/l"; cp -r "$scratch/layout" "$scratch/l"; }

fresh; out=$(check "$scratch/l"); expect "v2 a clean layout prints ALL PROOFS CHECK" 0 "ALL PROOFS CHECK" "$?" "$out"
fresh; out=$(FAKE_OUT="SOME PROOFS FAIL" check "$scratch/l"); expect "v2 any other output fails" 1 "did not print" "$?" "$out"
fresh; out=$(FAKE_RC=1 check "$scratch/l"); expect "v2 a non-zero bend fails" 1 "non-zero" "$?" "$out"
fresh; rm "$scratch/l/model.bend"; out=$(check "$scratch/l"); expect "v2 a missing file fails naming it" 1 "model.bend" "$?" "$out"
fresh; echo '  @unsafe' >> "$scratch/l/PROOF.bend"; out=$(check "$scratch/l"); expect "v2 @unsafe fails" 1 "@unsafe" "$?" "$out"
fresh; echo '  ?TODO' >> "$scratch/l/PROOF.bend"; out=$(check "$scratch/l"); expect "v2 ?TODO fails" 1 "TODO" "$?" "$out"
fresh; printf '\nlaw m99_extra:\n  for evs: +List<M.Ev>\n  {True{} == True{} : Bool}\n' >> "$scratch/l/LAWS.bend"; out=$(check "$scratch/l"); expect "v2 a law with no def Laws fails naming it" 1 "m99_extra" "$?" "$out"
fresh; sed 's/^def Laws\.m6_no_silent_loss(/def Laws.renamed(/' "$scratch/l/PROOF.bend" > "$scratch/l/P.new" && mv "$scratch/l/P.new" "$scratch/l/PROOF.bend"; out=$(check "$scratch/l"); expect "v2 a law deleted from PROOF.bend fails naming it" 1 "m6_no_silent_loss" "$?" "$out"
out=$(BEND=$scratch/none "$root/proofs/check.sh" "$scratch/layout" 2>&1); expect "v2 a missing bend fails" 1 "just proofs-setup" "$?" "$out"

# ---- V5/V4b: real Bend and temporary layouts; failures must reach the standard observer.
real_bend=$root/proofs/.tools/bend/bin/bend
observe() { BEND=$real_bend "$root/proofs/check.sh" "$scratch/l" 2>&1; }
fresh_real() { rm -rf "$scratch/l"; cp -r "$root/proofs/messages" "$scratch/l"; }
fresh_real
out=$(observe); rc=$?
if [ "$rc" = 0 ] && [ "$(grep -c '^PASS [mb][0-9]*:' <<<"$out")" = 8 ]; then
  ok "v5 the real observer proves and rejects all eight mutants"
else
  bad "v5 the real observer ($rc: $out)"
fi
fresh_real
sed 's/flush(W{snoc(q, n), t/flush(W{snoc(q, n+n), t/' "$scratch/l/mutants/m1.patch" > "$scratch/stale.patch"
mv "$scratch/stale.patch" "$scratch/l/mutants/m1.patch"
out=$(observe); expect "v5 a stale m1 patch fails the standard observer" 1 "FAIL m1: cannot apply" "$?" "$out"
fresh_real; rm "$scratch/l/mutants/m4.patch"
out=$(observe); expect "v5 a missing m4 mutant fails the standard observer" 1 "FAIL m4: missing m4.patch" "$?" "$out"
fresh_real
sed 's/^def m1_main(/def omitted_m1_main(/' "$scratch/l/PROOF.bend" > "$scratch/l/P.new"
mv "$scratch/l/P.new" "$scratch/l/PROOF.bend"
out=$(BEND=$real_bend "$scratch/l/mutants/run.sh" m1 2>&1)
expect "v4b omitted m1 helper dependencies fail the baseline" 1 "FAIL m1: unmutated baseline" "$?" "$out"

# Bend boundary failures cannot masquerade as successful mutation evidence.
fresh; rm "$scratch/l/mutants/run.sh"; out=$(check "$scratch/l")
expect "v5 a missing mutation runner fails" 1 "mutants/run.sh" "$?" "$out"
fresh; out=$(FAKE_LOCATION=unrelated check "$scratch/l")
expect "v5 an unrelated proof rejection fails" 1 "FAIL m1: mutant rejection" "$?" "$out"
fresh; out=$(FAKE_MUTANT_OUT=$'SOME PROOFS FAIL\n- expected : a defined name' check "$scratch/l")
expect "v5 a missing name cannot count as mutation success" 1 "FAIL m1: mutant rejection" "$?" "$out"
fresh; out=$(FAKE_MUTANT_RC=0 check "$scratch/l")
expect "v5 a successful Bend exit cannot count as rejection" 1 "FAIL m10: mutant rejection" "$?" "$out"
fresh; out=$(FAKE_OUT=$'ALL PROOFS CHECK\nSOME PROOFS FAIL' check "$scratch/l")
expect "v5 a failing baseline cannot count as mutation success" 1 "FAIL m1: unmutated baseline" "$?" "$out"
fresh; cp "$scratch/l/mutants/m1.patch" "$scratch/l/mutants/m5.patch"
out=$(observe); expect "v5 a different guard mutation is unrelated to m5" 1 "FAIL m5: mutant rejection" "$?" "$out"

[ $fails = 0 ] || { echo "$fails failed"; exit 1; }
