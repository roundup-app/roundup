#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
real_browser=$(command -v agent-browser || true)
scratch=$(mktemp -d)
trap 'if [[ -s $scratch/harness-child.pid ]]; then kill "$(cat "$scratch/harness-child.pid")" 2>/dev/null || true; fi; rm -rf "$scratch"' EXIT
mkdir -p "$scratch/bin"

cat > "$scratch/bin/agent-browser" <<'BROWSER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$QA_SWEEP_CALLS"
case " $* " in
  *" screenshot "*) printf image > "${@: -1}" ;;
  *" set viewport "*) printf '%s %s\n' "${@: -2:1}" "${@: -1}" > "$QA_SWEEP_SIZE" ;;
  *" eval "*)
    if [[ ${QA_SWEEP_BROWSER_FAIL:-0} == 1 ]]; then exit 9; fi
    read -r width height < "$QA_SWEEP_SIZE"
    if [[ ${QA_SWEEP_BLANK:-0} == 1 ]]; then
      printf '{"success":true,"data":{"result":{"blank":true,"viewport":{"width":%s,"height":%s},"overflow":[],"drawer":null}}}\n' "$width" "$height"
    else
      # box <left> <right> <top> <bottom> <visible>
      box() { printf '{"left":%s,"right":%s,"top":%s,"bottom":%s,"width":%s,"height":%s,"visible":%s}' "$1" "$2" "$3" "$4" "$(($2 - $1))" "$(($4 - $3))" "$5"; }
      state=$(cat "$QA_SWEEP_DRAWER" 2>/dev/null || true)
      rail_left=0 rail_right=120 shelf_visible=true
      centre_left=120 centre_width=$((width - 252)) centre_bottom=$height centre_visible=true
      drawer=null closed_visible=false overflow='[]'
      if [[ ${QA_SWEEP_OVERFLOW:-0} == 1 ]]; then overflow='["Drawer outside viewport"]'; fi
      if [[ ${QA_SWEEP_HIDDEN_CENTRE:-0} == 1 ]]; then centre_width=0; fi
      if [[ ${QA_SWEEP_OFFSCREEN_CENTRE:-0} == 1 ]]; then centre_left=$((width + 10)); fi
      if [[ ${QA_SWEEP_INVISIBLE_CENTRE:-0} == 1 ]]; then centre_visible=false; fi
      if [[ $state == open && ${QA_SWEEP_NO_DRAWER:-0} != 1 ]]; then
        # U7638a: the item fills the main area above the Rail actions bar, and the Terminal stays under it, hidden.
        drawer=$(box "$centre_left" "$((centre_left + centre_width))" 0 "$((height - 40))" true)
        centre_visible=false
        if [[ ${QA_SWEEP_SIDE_DRAWER:-0} == 1 ]]; then drawer=$(box "$((width - 388))" "$width" 0 "$((height - 40))" true); fi
        if [[ ${QA_SWEEP_TERMINAL_SHOWN:-0} == 1 ]]; then centre_visible=true; fi
        if [[ ${QA_SWEEP_RESIZED_CENTRE:-0} == 1 ]]; then centre_width=$((centre_width - 100)); fi
        if [[ ${QA_SWEEP_MOVED_CENTRE:-0} == 1 ]]; then centre_left=130; fi
        if [[ ${QA_SWEEP_SHORT_CENTRE:-0} == 1 ]]; then centre_bottom=$((height - 100)); fi
        if [[ ${QA_SWEEP_SHELF_HIDDEN:-0} == 1 ]]; then shelf_visible=false; fi
        if [[ ${QA_SWEEP_RAIL_MOVED:-0} == 1 ]]; then rail_left=10 rail_right=130; fi
      elif [[ $state == closed ]]; then
        if [[ ${QA_SWEEP_UNRESTORED_CENTRE:-0} == 1 ]]; then centre_left=130; fi
        if [[ ${QA_SWEEP_TERMINAL_STAYS_HIDDEN:-0} == 1 ]]; then centre_visible=false; fi
        if [[ ${QA_SWEEP_CLOSED_VISIBLE:-0} == 1 ]]; then closed_visible=true; fi
      fi
      printf '{"success":true,"data":{"result":{"blank":false,"viewport":{"width":%s,"height":%s},"boxes":{"rail":%s,"centre":%s,"shelf":%s},"overflow":%s,"drawer":%s,"closedDrawerVisible":%s}}}\n' "$width" "$height" "$(box "$rail_left" "$rail_right" 0 "$height" true)" "$(box "$centre_left" "$((centre_left + centre_width))" 0 "$centre_bottom" "$centre_visible")" "$(box "$((width - 132))" "$width" 0 "$height" "$shelf_visible")" "$overflow" "$drawer" "$closed_visible"
    fi
    ;;
  *" press Enter"*) printf open > "$QA_SWEEP_DRAWER" ;;
  *" click "*".drawer .close"*) printf closed > "$QA_SWEEP_DRAWER" ;;
esac
BROWSER
chmod +x "$scratch/bin/agent-browser"

export PATH="$scratch/bin:$PATH" QA_SWEEP_URL='http://127.0.0.1:5199/harness.html?seed=tree-40' QA_SWEEP_TEST_MODE=1
export QA_SWEEP_CALLS="$scratch/calls"
export QA_SWEEP_SIZE="$scratch/size" QA_SWEEP_DRAWER="$scratch/drawer"
export QA_SWEEP_OUT="$scratch/out"

if [[ -e "$root/loop/qa-sweep.sh" ]]; then
  "$root/loop/qa-sweep.sh"
  record=$(find "$QA_SWEEP_OUT" -name 'sweep-*.json' -print -quit)
  jq -e '.head | length == 40' "$record" >/dev/null
  jq -e '.viewports == ["1280×400", "1280×800"]' "$record" >/dev/null
  printf 'u453_sweep_uses_supported_viewports_passed\n'
  jq -e '.scenarios == ["L52", "U15", "U20", "U111", "U7638a"]' "$record" >/dev/null
  [[ $(grep -c ' screenshot ' "$QA_SWEEP_CALLS") == 6 ]]
  grep -q 'focus.*pad-3' "$QA_SWEEP_CALLS"
  grep -q 'focus.*Todos' "$QA_SWEEP_CALLS"
  printf 'l52_two_viewports_and_each_drawer_passed\n'
  jq -e '.complete == true' "$record" >/dev/null
  printf 'l66_a_sweep_that_reaches_its_end_is_complete_passed\n'

  rm -rf "$QA_SWEEP_OUT"
  rm -f "$QA_SWEEP_DRAWER"
  : > "$QA_SWEEP_CALLS"
  if QA_SWEEP_BLANK=1 "$root/loop/qa-sweep.sh"; then
    echo 'blank page returned green' >&2
    exit 1
  fi
  record=$(find "$QA_SWEEP_OUT" -name 'sweep-*.json' -print -quit)
  jq -e '.findings | any(.text | contains("blank"))' "$record" >/dev/null
  printf 'l52_blank_page_fails_with_a_record_passed\n'

  rm -rf "$QA_SWEEP_OUT"
  rm -f "$QA_SWEEP_DRAWER"
  if QA_SWEEP_BROWSER_FAIL=1 "$root/loop/qa-sweep.sh"; then
    echo 'browser error returned green' >&2
    exit 1
  fi
  record=$(find "$QA_SWEEP_OUT" -name 'sweep-*.json' -print -quit)
  jq -e '.findings | any(.text | contains("geometry failed"))' "$record" >/dev/null
  printf 'l52_browser_error_fails_with_a_record_passed\n'
  jq -e '.complete == false' "$record" >/dev/null
  printf 'l66_a_sweep_cut_off_by_a_browser_error_is_incomplete_passed\n'

  rm -rf "$QA_SWEEP_OUT"
  rm -f "$QA_SWEEP_DRAWER"
  if QA_SWEEP_NO_DRAWER=1 "$root/loop/qa-sweep.sh"; then
    echo 'missing Drawer returned green' >&2
    exit 1
  fi
  record=$(find "$QA_SWEEP_OUT" -name 'sweep-*.json' -print -quit)
  jq -e '.findings | any(.text | contains("Drawer state missing"))' "$record" >/dev/null
  printf 'l52_missing_drawer_fails_with_a_record_passed\n'

  for defect in HIDDEN_CENTRE INVISIBLE_CENTRE OFFSCREEN_CENTRE RESIZED_CENTRE MOVED_CENTRE SHORT_CENTRE TERMINAL_SHOWN SIDE_DRAWER SHELF_HIDDEN RAIL_MOVED UNRESTORED_CENTRE TERMINAL_STAYS_HIDDEN CLOSED_VISIBLE; do
    rm -rf "$QA_SWEEP_OUT"
    rm -f "$QA_SWEEP_DRAWER"
    if env "QA_SWEEP_$defect=1" "$root/loop/qa-sweep.sh"; then
      echo "$defect returned green" >&2
      exit 1
    fi
    record=$(find "$QA_SWEEP_OUT" -name 'sweep-*.json' -print -quit)
    jq -e '.findings | length > 0' "$record" >/dev/null
    case $defect in
      RESIZED_CENTRE|MOVED_CENTRE|SHORT_CENTRE|TERMINAL_SHOWN|SIDE_DRAWER|UNRESTORED_CENTRE|TERMINAL_STAYS_HIDDEN|CLOSED_VISIBLE) cited=U7638a ;;
      SHELF_HIDDEN|RAIL_MOVED) cited=U111 ;;
      *) cited= ;;
    esac
    if [[ -n $cited ]]; then jq -e --arg cited "($cited)" '.findings | any(.text | contains($cited))' "$record" >/dev/null; fi
    printf 'l52_%s_fails_with_a_record_passed\n' "$defect"
  done

  rm -rf "$QA_SWEEP_OUT"
  rm -f "$QA_SWEEP_DRAWER"
  if QA_SWEEP_OVERFLOW=1 "$root/loop/qa-sweep.sh"; then
    echo 'overflow returned green' >&2
    exit 1
  fi
  record=$(find "$QA_SWEEP_OUT" -name 'sweep-*.json' -print -quit)
  jq -e '.findings | length == 6 and all(.scenario == null and .test == null)' "$record" >/dev/null
  printf 'l52_layout_findings_are_durable_and_unscoped_passed\n'
  jq -e '.complete == true' "$record" >/dev/null
  printf 'l66_a_sweep_with_findings_that_reaches_its_end_is_complete_passed\n'

  if env -u QA_SWEEP_TEST_MODE "$root/loop/qa-sweep.sh" > "$scratch/override.log" 2>&1; then
    echo 'alternate URL returned green outside test mode' >&2
    exit 1
  fi
  grep -Eq 'checkout is not origin/main|alternate URL is for test mode only' "$scratch/override.log"
  printf 'l52_test_override_cannot_label_a_production_sweep_passed\n'

  mkdir -p "$scratch/server-bin" "$scratch/server-root"
  printf 'harness\n' > "$scratch/server-root/harness.html"
  cat > "$scratch/server-bin/just" <<'JUST'
#!/usr/bin/env bash
set -euo pipefail
[[ $1 == harness && $2 == tree-40 ]]
cd "$QA_SWEEP_SERVER_ROOT"
python3 -m http.server "$3" --bind 127.0.0.1 &
printf '%s\n' "$!" > "$QA_SWEEP_SERVER_CHILD"
wait
JUST
  chmod +x "$scratch/server-bin/just"
  export QA_SWEEP_SERVER_ROOT="$scratch/server-root" QA_SWEEP_SERVER_CHILD="$scratch/harness-child.pid"
  port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
  for run in 1 2; do
    PATH="$scratch/server-bin:$PATH" env -u QA_SWEEP_URL QA_SWEEP_PORT="$port" "$root/loop/qa-sweep.sh" > "$scratch/repeat-$run.log"
    if curl -fsS --max-time 2 "http://127.0.0.1:$port/harness.html?seed=tree-40" >/dev/null 2>&1; then
      echo "harness listener survived sweep $run" >&2
      exit 1
    fi
  done
  printf 'l52_consecutive_sweeps_release_harness_passed\n'

  if [[ ${QA_SWEEP_LIVE:-0} == 1 ]]; then
    [[ -n $real_browser ]] || { echo 'agent-browser is required for live visibility test' >&2; exit 1; }
    mkdir -p "$scratch/live-bin"
    cat > "$scratch/live-bin/agent-browser" <<'LIVE_BROWSER'
#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" screenshot "* ]]; then
  case "$QA_SWEEP_VISUAL_HIDE" in
    clip) script='document.querySelector("[aria-label=Centre]").style.clipPath = "inset(50%)"' ;;
    mask) script='document.querySelector("[aria-label=Centre]").style.maskImage = "linear-gradient(transparent, transparent)"' ;;
    ancestor-mask) script='document.querySelector("[aria-label=Centre]").parentElement.style.maskImage = "linear-gradient(transparent, transparent)"' ;;
    filter) script='document.querySelector("[aria-label=Centre]").style.filter = "opacity(0)"' ;;
    ancestor-filter) script='document.querySelector("[aria-label=Centre]").parentElement.style.filter = "opacity(0)"' ;;
    opacity) script='document.querySelector("[aria-label=Centre]").style.opacity = "0"' ;;
    ancestor-opacity) script='document.querySelector("[aria-label=Centre]").parentElement.style.opacity = "0"' ;;
    visibility) script='document.querySelector("[aria-label=Centre]").style.visibility = "hidden"' ;;
    ancestor-visibility) script='document.querySelector("[aria-label=Centre]").parentElement.style.visibility = "hidden"' ;;
  esac
  "$QA_SWEEP_REAL_BROWSER" "${@:1:2}" eval "$script" >/dev/null
fi
exec "$QA_SWEEP_REAL_BROWSER" "$@"
LIVE_BROWSER
    chmod +x "$scratch/live-bin/agent-browser"
    read -r -a hides <<< "${QA_SWEEP_LIVE_CASES:-clip mask ancestor-mask filter ancestor-filter opacity ancestor-opacity visibility ancestor-visibility}"
    for hide in "${hides[@]}"; do
      rm -rf "$QA_SWEEP_OUT"
      if PATH="$scratch/live-bin:${PATH#*:}" QA_SWEEP_REAL_BROWSER="$real_browser" QA_SWEEP_VISUAL_HIDE="$hide" QA_SWEEP_PORT="$port" env -u QA_SWEEP_URL "$root/loop/qa-sweep.sh" > "$scratch/$hide.log"; then
        echo "$hide centre returned green" >&2
        exit 1
      fi
      record=$(find "$QA_SWEEP_OUT" -name 'sweep-*.json' -print -quit)
      jq -e '.findings | any(.text | contains("hidden"))' "$record" >/dev/null
      printf 'l52_%s_centre_fails_with_a_record_passed\n' "$hide"
    done
  fi
else
  echo 'l52_sweep_missing' >&2
  exit 1
fi
