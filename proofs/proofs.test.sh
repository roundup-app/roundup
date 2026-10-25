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

# ---- V1: fake release assets and elan/Lean at the supported tool boundary.
mkasset() {
  mkdir -p "$1/pkg/bend/bin"
  printf '#!/bin/sh\n[ "$BEND_NO_TELEMETRY" = 1 ] || exit 3\necho "bend %s"\n' "$2" > "$1/pkg/bend/bin/bend"
  chmod +x "$1/pkg/bend/bin/bend"
  tar -czf "$1/bend-9.9.9-test-x64.tar.gz" -C "$1/pkg" bend
}
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }
setup() {
  local c=$1
  mkdir -p "$c/dl" "$c/proofs" "$c/bin" "$c/elan/bin"
  mkasset "$c/dl" "$2"
  echo 9.9.9 > "$c/proofs/BEND_VERSION"
  echo "$(sha "$c/dl/bend-9.9.9-test-x64.tar.gz")  bend-9.9.9-test-x64.tar.gz" > "$c/proofs/BEND_SHA256"
  cat > "$c/elan/bin/elan" <<'F'
#!/bin/sh
printf '%s\n' "$*" >> "$ELAN_HOME/calls"
case "$*" in
  'toolchain install leanprover/lean4:v4.34.0')
    [ "${FAKE_LEAN_INSTALL_RC:-0}" = 0 ] || exit 1
    [ "${FAKE_MISSING_LEAN:-0}" = 0 ] || exit 0
    printf '#!/bin/sh\necho "Lean (version %s, test)"\n' "${FAKE_LEAN_VERSION:-4.34.0}" > "$ELAN_HOME/lean"
    chmod +x "$ELAN_HOME/lean" ;;
  'which lean')
    [ "$ELAN_TOOLCHAIN" = leanprover/lean4:v4.34.0 ] || exit 2
    echo "$ELAN_HOME/lean" ;;
  *) exit 2 ;;
esac
F
  chmod +x "$c/elan/bin/elan"
}
run_setup() { PATH=$1/elan/bin:$PATH ELAN_HOME=$1/elan PROOFS_DIR=$1/proofs BEND_BASE_URL=file://$1/dl BEND_ASSET_PLATFORM=test-x64 "$root/proofs/setup.sh" 2>&1; }

setup "$scratch/a" 9.9.9
out=$(run_setup "$scratch/a"); rc=$?
if [ "$rc" = 0 ] && [ "$(BEND_NO_TELEMETRY=1 "$scratch/a/proofs/.tools/bend/bin/bend" version)" = 'bend 9.9.9' ] &&
   [ "$("$scratch/a/elan/lean" --version)" = 'Lean (version 4.34.0, test)' ]; then
  ok "v1 matching Bend and Lean install"
else bad "v1 matching ($rc: $out)"; fi
rm -rf "$scratch/a/dl"; : > "$scratch/a/elan/calls"
out=$(run_setup "$scratch/a"); rc=$?
if [ "$rc" = 0 ] && grep -qx 'toolchain install leanprover/lean4:v4.34.0' "$scratch/a/elan/calls"; then
  ok "v1 repeated setup verifies both versions"
else bad "v1 repeated setup ($rc: $out)"; fi
out=$(FAKE_LEAN_VERSION=0.0.0 run_setup "$scratch/a")
expect "v1 installed Bend still requires Lean" 1 "Lean: installed version.*0.0.0.*expected 4.34.0" "$?" "$out"
# A repeated setup also refuses a Bend binary whose reported version changed.
printf '#!/bin/sh\necho "bend 9.9.90"\n' > "$scratch/a/proofs/.tools/bend/bin/bend"
out=$(run_setup "$scratch/a")
expect "v1 repeated setup refuses changed Bend version" 1 "bend: installed version.*9.9.90.*expected 9.9.9" "$?" "$out"

setup "$scratch/b" 1.0.0
out=$(run_setup "$scratch/b"); expect "v1 a mismatching version exits 1 naming the tool" 1 "bend: installed version" "$?" "$out"
setup "$scratch/c" 9.9.9
echo "$(printf '%064d' 0)  bend-9.9.9-test-x64.tar.gz" > "$scratch/c/proofs/BEND_SHA256"
out=$(run_setup "$scratch/c"); expect "v1 a wrong checksum exits 1" 1 "bend: checksum" "$?" "$out"
setup "$scratch/d" 9.9.9
mkdir "$scratch/nocurl"
for t in bash env tr sed awk uname mktemp rm dirname cat cut sha256sum shasum tar mkdir mv grep; do p=$(command -v "$t") && ln -sf "$p" "$scratch/nocurl/$t"; done
out=$(PATH=$scratch/nocurl ELAN_HOME=$scratch/empty PROOFS_DIR=$scratch/d/proofs "$root/proofs/setup.sh" 2>&1)
expect "v1 a missing curl exits 1" 1 "Bend: curl" "$?" "$out"
setup "$scratch/e" 9.9.9
rm "$scratch/e/dl/pkg/bend/bin/bend"
tar -czf "$scratch/e/dl/bend-9.9.9-test-x64.tar.gz" -C "$scratch/e/dl/pkg" bend
sha "$scratch/e/dl/bend-9.9.9-test-x64.tar.gz" | awk '{print $1 "  bend-9.9.9-test-x64.tar.gz"}' > "$scratch/e/proofs/BEND_SHA256"
out=$(run_setup "$scratch/e"); expect "v1 Bend asset missing executable fails" 1 "bend:.*executable" "$?" "$out"
setup "$scratch/f" 9.9.9
out=$(FAKE_LEAN_INSTALL_RC=1 run_setup "$scratch/f")
expect "v1 pinned Lean toolchain failure names Lean and toolchain" 1 "Lean: toolchain.*installation failed" "$?" "$out"
setup "$scratch/g" 9.9.9
out=$(FAKE_MISSING_LEAN=1 run_setup "$scratch/g")
expect "v1 missing Lean executable fails" 1 "Lean: executable missing" "$?" "$out"

# Exercise elan bootstrap without network or a user's installed toolchain.
setup "$scratch/h" 9.9.9
cp "$scratch/h/elan/bin/elan" "$scratch/h/fake-elan"
rm "$scratch/h/elan/bin/elan"
cat > "$scratch/h/bin/curl" <<'F'
#!/bin/sh
if [ "$2" = https://elan.lean-lang.org/elan-init.sh ]; then
  cat > "$4" <<'INSTALL'
[ "$*" = '-y --no-modify-path --default-toolchain none' ] || exit 2
[ "${FAKE_ELAN_INSTALL_RC:-0}" = 0 ] || exit 1
mkdir -p "$ELAN_HOME/bin"
cp "$FAKE_ELAN" "$ELAN_HOME/bin/elan"
INSTALL
else exec "$REAL_CURL" "$@"; fi
F
chmod +x "$scratch/h/bin/curl"
# Hide any host elan; preserve the platform tools and intercept only curl.
real_curl=$(command -v curl)
bootstrap() { PATH=$scratch/h/bin:$scratch/nocurl REAL_CURL=$real_curl FAKE_ELAN=$scratch/h/fake-elan ELAN_HOME=$scratch/h/elan PROOFS_DIR=$scratch/h/proofs BEND_BASE_URL=file://$scratch/h/dl BEND_ASSET_PLATFORM=test-x64 "$root/proofs/setup.sh" 2>&1; }
for t in sh cp chmod gzip; do ln -sf "$(command -v "$t")" "$scratch/nocurl/$t"; done
out=$(FAKE_ELAN_INSTALL_RC=1 bootstrap)
expect "v1 elan installation failure names elan" 1 "elan: installation failed" "$?" "$out"
out=$(PATH=$scratch/nocurl ELAN_HOME=$scratch/h/elan PROOFS_DIR=$scratch/h/proofs "$root/proofs/setup.sh" 2>&1)
expect "v1 missing curl for Lean names Lean and curl" 1 "Lean: curl" "$?" "$out"
out=$(bootstrap); rc=$?
if [ "$rc" = 0 ] && [ "$("$scratch/h/elan/lean" --version)" = 'Lean (version 4.34.0, test)' ]; then
  ok "v1 missing elan installs noninteractively"
else bad "v1 elan bootstrap ($rc: $out)"; fi

# ---- V2: a layout copy, a fake bend that prints what FAKE_OUT says
cp -r "$root/proofs/messages" "$scratch/layout"
cat > "$scratch/bend" <<'F'
#!/bin/sh
dir=$(dirname "$1")
[ -z "${FAKE_LOG:-}" ] || printf '%s\n' "$*" >> "$FAKE_LOG"
if [ "${2:-}" = --verdict ]; then
  printf '%s\n' "${FAKE_VERDICT_OUT-ALL PROOFS CHECK}"
  exit "${FAKE_VERDICT_RC:-0}"
fi
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

fresh; out=$(FAKE_VERDICT_RC=1 FAKE_VERDICT_OUT='Lean kernel failed' check "$scratch/l"); rc=$?
if [ "$rc" = 1 ] && grep -q -- '--verdict' <<<"$out" && grep -q 'Lean kernel failed' <<<"$out"; then
  ok "v2 verdict failure exits nonzero"
else bad "v2 verdict failure ($rc: $out)"; fi
fresh; out=$(FAKE_VERDICT_OUT='no result' check "$scratch/l")
expect "v2 verdict without pass fails" 1 "--verdict missing" "$?" "$out"
fresh; out=$(FAKE_LOG=$scratch/invocations check "$scratch/l"); rc=$?
if [ "$rc" = 0 ] && [ "$(head -2 "$scratch/invocations")" = "$(printf '%s\n' "$scratch/l/PROOF.bend" "$scratch/l/PROOF.bend --verdict")" ] &&
   [ "$(tail -1 <<<"$out")" = 'ALL PROOFS CHECK' ] && [ "$(grep -c '^PASS [mb][0-9]*:' <<<"$out")" = 8 ]; then
  ok "v2 plain check precedes verdict; both checks and mutants pass"
else bad "v2 invocation order/success ($rc: $out)"; fi
fresh; out=$(FAKE_OUT="SOME PROOFS FAIL" check "$scratch/l"); expect "v2 any other output fails" 1 "did not print" "$?" "$out"
fresh; out=$(FAKE_RC=1 check "$scratch/l"); expect "v2 a non-zero bend fails" 1 "non-zero" "$?" "$out"
fresh; rm "$scratch/l/model.bend"; out=$(check "$scratch/l"); expect "v2 a missing file fails naming it" 1 "model.bend" "$?" "$out"
fresh; echo '  @unsafe' >> "$scratch/l/PROOF.bend"; out=$(check "$scratch/l"); expect "v2 @unsafe fails" 1 "@unsafe" "$?" "$out"
fresh; echo '  ?TODO' >> "$scratch/l/PROOF.bend"; out=$(check "$scratch/l"); expect "v2 ?TODO fails" 1 "TODO" "$?" "$out"
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
fresh
sed 's/flush(W{snoc(q, n), t/flush(W{snoc(q, n+n), t/' "$scratch/l/mutants/m1.patch" > "$scratch/stale.patch"
mv "$scratch/stale.patch" "$scratch/l/mutants/m1.patch"
out=$(check "$scratch/l"); expect "v5 a stale m1 patch fails the standard observer" 1 "FAIL m1: cannot apply" "$?" "$out"
fresh; rm "$scratch/l/mutants/m4.patch"
out=$(check "$scratch/l"); expect "v5 a missing m4 mutant fails the standard observer" 1 "FAIL m4: missing m4.patch" "$?" "$out"
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
out=$(BEND=$real_bend "$scratch/l/mutants/run.sh" m5 2>&1); expect "v5 a different guard mutation is unrelated to m5" 1 "FAIL m5: mutant rejection" "$?" "$out"

[ $fails = 0 ] || { echo "$fails failed"; exit 1; }
