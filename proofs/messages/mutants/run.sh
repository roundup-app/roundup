#!/usr/bin/env bash
# V5: each law needs a clean baseline and a proof rejection from its intentional mutation.
# B39 (the in-flight step) shares inv with M1/M5/M6; its mutant keeps a confirmed batch in flight.
# M1/M5/M6 share inv. The trailing A35 refinements use helpers from every section, so no mutant keeps
# them; each law keeps LIB.bend and its own section.
# M2's proof is its own file, M2.bend: M2 imports it alone and the other laws leave the import out.
# M1/M5/M6 reject in the shared uniqueness/partition invariant. M3 checks Takeover
# isolation, M4 the typed prefix, and M10 the recursive flush
# invariant used by its fair-cycle liveness proof (retaining typed ids leaves a queue).
# Exact helper attribution prevents another section's error from counting as evidence.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dir=$(dirname "$here")
BEND=${BEND:-$dir/../.tools/bend/bin/bend}
export BEND_NO_TELEMETRY=1
laws=("$@")
[ ${#laws[@]} -ne 0 ] || laws=(m1 m2 m3 m4 m5 m6 m7 m9 m10 b39)
work=$(mktemp -d) || exit 1
trap 'rm -rf "$work"' EXIT
status=0

section() {
  awk -v want="$(echo "$1" | tr '[:lower:]' '[:upper:]')" '
    /^import .\/M2\.bend/ && want != "M2" { next }
    /^# ---- / { tag = toupper($3) }
    tag == "" || tag == want || (tag == "INV" && want ~ /^(M(1|5|6)|B39)$/) { print }' "$dir/PROOF.bend"
}

for id in "${laws[@]}"; do
  case "$id" in
    m1) location='user_deliver_inv|Laws\.m1_final_and_at_most_once' ;;
    m2) location='step2|Laws\.m2_held_leaves_only_by_its_owner' ;;
    m3) location='takeover_begin3|Laws\.m3_takeover_isolates' ;;
    m4) location='fl_go4|Laws\.m4_typed_only_grows_at_the_end' ;;
    m5) location='user_drop_inv|Laws\.m5_terminal_states_are_absorbing' ;;
    m6) location='exit_inv|Laws\.m6_no_silent_loss' ;;
    m7) location='send_ev7|Laws\.m7_receiver_gone' ;;
    m9) location='restart_replay|Laws\.m9_restart_is_a_replay' ;;
    m10) location='fgo_alive10|Laws\.m10_pending_to_idle_is_eventually_typed' ;;
    b39) location='fconfirm_inv|Laws\.b39_delivered_at_most_once' ;;
    *) echo "FAIL $id: unknown law"; status=1; continue ;;
  esac
  w=$work/$id
  mkdir "$w" || exit 1
  if ! cp "$dir/LAWS.bend" "$dir/spec.bend" "$dir/model.bend" "$dir/LIB.bend" "$dir/M2.bend" "$w/" || ! section "$id" > "$w/PROOF.bend"; then
    echo "FAIL $id: cannot prepare baseline"; status=1; continue
  fi
  # Bend generates TODOs for declared laws without proofs. Isolated layouts declare
  # exactly the law under test, verbatim; M8 retains all declarations and proofs.
  if [ "$id" != m8 ]; then
    awk -v id="$id" '
      /^law / { selected = ($2 ~ "^" id "_"); seen = 1 }
      !seen || selected { print }' "$dir/LAWS.bend" > "$w/LAWS.bend"
  fi
  out=$(cd "$w" && "$BEND" PROOF.bend 2>&1); rc=$?
  if [ "$rc" -ne 0 ] || ! grep -qx 'ALL PROOFS CHECK' <<<"$out" || grep -qE '^Location:|^SOME PROOFS FAIL' <<<"$out"; then
    echo "FAIL $id: unmutated baseline (bend exit $rc)"; printf '%s\n' "$out"; status=1; continue
  fi
  if [ ! -f "$here/$id.patch" ]; then
    echo "FAIL $id: missing $id.patch"; status=1; continue
  fi
  cp "$w/model.bend" "$w/baseline.bend" || exit 1
  if ! out=$(patch --batch --forward --fuzz=0 --quiet "$w/model.bend" "$here/$id.patch" 2>&1); then
    echo "FAIL $id: cannot apply $id.patch"; printf '%s\n' "$out"; status=1; continue
  fi
  if cmp -s "$w/model.bend" "$w/baseline.bend"; then
    echo "FAIL $id: patch leaves model unchanged"; status=1; continue
  fi
  out=$(cd "$w" && "$BEND" PROOF.bend 2>&1); rc=$?
  loc=$(sed -n 's/^Location: //p' <<<"$out")
  if [ "$rc" -ne 0 ] && grep -qx 'SOME PROOFS FAIL' <<<"$out" &&
     ! grep -q 'a defined name' <<<"$out" &&
     grep -qxE "($location)" <<<"$loc" && [ "$(grep -c '^Location:' <<<"$out")" = 1 ]; then
    echo "PASS $id: the mutant fails in $loc"
  else
    echo "FAIL $id: mutant rejection is missing or unrelated (bend exit $rc, location $loc)"
    printf '%s\n' "$out"; status=1
  fi
done
exit "$status"
