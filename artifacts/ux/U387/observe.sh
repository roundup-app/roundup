#!/bin/bash
# usage: observe.sh   (run from the repo root; starts Vite and a headless agent-browser session)
# U387 at 1280x800 and 700x800 on the `door-stopped` seed: Tab from `collapse` reaches `start Door`, its hit height is at least 24 px,
# and the row's box is the same with and without focus. Exits non-zero on any miss.
set -u
dir=$(mktemp -d); port=5387; fail=0
pnpm --filter desktop exec vite --host 127.0.0.1 --port $port --strictPort >"$dir/vite.log" 2>&1 &
vite=$!
trap 'kill $vite 2>/dev/null' EXIT
sleep 6
for W in 1280 700; do
  S=u387-$W
  ev(){ agent-browser --session $S eval "$1" 2>&1 | tail -1; }
  agent-browser --session $S set viewport $W 800 >/dev/null 2>&1
  agent-browser --session $S open "http://127.0.0.1:$port/harness.html?seed=door-stopped" >/dev/null 2>&1; sleep 3
  row="[...document.querySelectorAll('.rail-row')].find(r=>r.querySelector('[aria-label=collapse]'))"
  ev "(()=>{document.activeElement&&document.activeElement.blur();const r=document.querySelector('.rail-row');return 1})()" >/dev/null
  before=$(ev "(()=>{const q=($row).getBoundingClientRect();return [q.width,q.height].join('x')})()")
  agent-browser --session $S eval "($row).querySelector('[aria-label=collapse]').focus()" >/dev/null 2>&1
  agent-browser --session $S press Tab >/dev/null 2>&1; sleep 1
  out=$(ev "(()=>{const r=$row,a=document.activeElement,q=r.getBoundingClientRect(),h=a.getBoundingClientRect().height;return JSON.stringify({tabbed:a.textContent.trim(),inRow:r.contains(a),hit:h,box:[q.width,q.height].join('x')})})()")
  agent-browser --session $S screenshot "$PWD/artifacts/ux/U387/focus-$W.png" >/dev/null 2>&1
  echo "$W before $before after $out"
  case "$out" in *'start Door'*) ;; *) fail=1 ;; esac
  hit=$(echo "$out" | sed -E 's/.*hit\\":([0-9.]+).*/\1/')
  [ "$(echo "$hit >= 24" | bc -l)" = 1 ] || fail=1
  case "$out" in *"box\\\":\\\"$(echo $before | tr -d '\\"')"*) ;; *) echo "$out" | grep -q "$(echo "$before" | tr -d '"\\')" || fail=1 ;; esac
  agent-browser --session $S close >/dev/null 2>&1
done
echo "fail=$fail"; exit $fail
