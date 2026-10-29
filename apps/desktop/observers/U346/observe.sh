#!/bin/bash
# usage: observe.sh   (run from the repo root after `cargo build -p rupd -p rup`; starts its own rupd on the fake claude, Vite and a headless agent-browser session)
# U346: at 1280x800 and 700x800, with a Terminal open, the confirm `delete` of an Pad created by an Agent, a Pad created by the user and a Todo must be what
# elementFromPoint returns at its centre, and a pointer click there must remove the item. Exits non-zero on any miss.
set -euo pipefail
root=$(pwd)
mkdir -p "$root/artifacts/ux/U346"
dir=$(mktemp -d)
dir=$(cd "$dir" && pwd -P)
port=5346; fail=0
daemon=; vite=; sessions=()
cleanup(){
  status=$?
  trap - EXIT
  set +e
  for session in "${sessions[@]}"; do
    browser --session "$session" close >/dev/null 2>&1
  done
  # Job control gives Vite its own group, including its children.
  if [ -n "$vite" ]; then
    kill -- -"$vite" 2>/dev/null
    wait "$vite" 2>/dev/null
  fi
  # EOF lets the attached Daemon stop its Terminals before exiting.
  exec 3>&-
  if [ -n "$daemon" ]; then
    wait "$daemon" 2>/dev/null
  fi
  rm -rf -- "$dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
set -m
export RUPD_SOCKET=$dir/rupd.sock CLAUDE_CONFIG_DIR=$dir/cc ROUNDUP_RUP_BIN=$root/target/debug/rup ROUNDUP_CLAUDE_BIN=$root/crates/rup/tests/e2e/fake_claude.py
export ROUNDUP_DATA_DIR=$dir/data
mkdir "$ROUNDUP_DATA_DIR"
# Keep attached stdin open without a sleeping pipeline process to orphan.
mkfifo "$dir/stdin"
exec 3<>"$dir/stdin"
"$root/target/debug/rupd" "$dir" --attached <"$dir/stdin" 3>&- 2>"$dir/rupd.log" &
daemon=$!
printf 'roundup-proof 1 %064d\n' 0 >&3
browser(){ agent-browser --config "$dir/browser.json" "$@" 3>&-; }
printf '{"headed":false}\n' >"$dir/browser.json"
unset AGENT_BROWSER_HEADED AGENT_BROWSER_AUTO_CONNECT AGENT_BROWSER_CDP \
  AGENT_BROWSER_PROFILE AGENT_BROWSER_SESSION AGENT_BROWSER_SESSION_NAME \
  AGENT_BROWSER_STATE AGENT_BROWSER_PROVIDER AGENT_BROWSER_ENGINE \
  AGENT_BROWSER_EXTENSIONS AGENT_BROWSER_INIT_SCRIPTS AGENT_BROWSER_ARGS
sleep 4
kill -0 "$daemon"
ROUNDUP_REAL_PROJECT=$dir pnpm --filter desktop exec vite --host 127.0.0.1 --port $port --strictPort >"$dir/vite.log" 2>&1 3>&- &
vite=$!
sleep 6
# If our strict-port server exited, never send RPCs to another server on that port.
kill -0 "$vite"
rpc(){ curl -s -X POST -H 'Content-Type: application/json' -d "{\"method\":\"$1\",\"params\":$2}" http://127.0.0.1:$port/__daemon/rpc 3>&-; }
agent=$(rpc agent.spawn '{"cwd":"'$dir'","prompt":"hello","parent":null}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "agent: $agent"
for W in 1280 700; do
  for kind in pad-user pad-agent todo; do
    S=$(basename "$dir")-u346-$W-$kind
    sessions+=("$S")
    profile=$dir/browser-$W-$kind
    ev(){ browser --session $S eval "$1" 2>&1 | tail -1; }
    case $kind in
      pad-user)  rpc pad.create '{"name":"plan'$W'","text":"v1"}' >/dev/null; item=plan$W ;;
      pad-agent) "$root/target/debug/rup" --agent "$agent" pad create "notes$W" v1 >/dev/null; item=notes$W ;;
      todo)      rpc todo.create '{"title":"chore'$W'","body":null,"blockers":null}' >/dev/null; item=chore$W ;;
    esac
    browser --session "$S" --profile "$profile" open "http://127.0.0.1:$port/harness.html?daemon=1" >/dev/null 2>&1
    browser --session "$S" set viewport $W 800 >/dev/null 2>&1
    sleep 3
    ev "(()=>{const b=document.querySelector('.rail [role=treeitem], .rail [role=row], .rail li');b&&b.click();return !!b})()" >/dev/null; sleep 4
    ev "(()=>{const tab=document.querySelector('#shelf-tab-$([ "$kind" = todo ] && echo todos || echo pads)');if(tab.getAttribute('aria-expanded')!=='true')tab.click();return true})()" >/dev/null; sleep 1
    ev "(()=>{const group=document.querySelector('.shelf [data-shelf-group=unassigned]');if(group?.getAttribute('aria-expanded')==='false')group.querySelector('.shelf-group-control').click();return true})()" >/dev/null; sleep 1
    ev "(()=>{const b=[...document.querySelectorAll('.shelf button')].find(x=>x.textContent.includes('$item'));b&&b.click();return !!b})()" >/dev/null; sleep 1
    ev "(()=>{const b=[...document.querySelectorAll('[aria-label=drawer] button')].find(x=>x.textContent.trim()==='delete');b&&b.click();return !!b})()" >/dev/null; sleep 1
    out=$(ev "(()=>{const bs=[...document.querySelectorAll('[aria-label=drawer] button')].filter(x=>x.textContent.trim()==='delete'),b=bs[0];if(!b)return 'no button';const q=b.getBoundingClientRect(),hit=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return JSON.stringify({width:innerWidth,buttons:bs.length,hit:hit===b,hitTag:hit&&hit.tagName+'.'+hit.className,x:Math.round(q.left+q.width/2),y:Math.round(q.top+q.height/2)})})()")
    browser --session $S screenshot "$root/artifacts/ux/U346/question-$kind-$W.png" >/dev/null 2>&1
    echo "$W $kind: $out"
    xy=$(echo "$out" | sed -E 's/.*\\"x\\":([0-9]+),\\"y\\":([0-9]+).*/\1 \2/')
    browser --session $S mouse move $xy >/dev/null 2>&1; browser --session $S mouse down >/dev/null 2>&1; browser --session $S mouse up >/dev/null 2>&1; sleep 4
    gone=$(ev "(()=>!document.querySelector('[aria-label=drawer]')?.innerText&&!document.body.innerText.includes('$item'))()")
    echo "$W $kind: pointer click removed it: $gone"
    case "$gone" in *true*) ;; *) fail=1 ;; esac
    case "$out" in *'hit\":true'*) ;; *) fail=1 ;; esac
    browser --session $S screenshot "$root/artifacts/ux/U346/confirm-$kind-$W.png" >/dev/null 2>&1
    browser --session $S close >/dev/null 2>&1
  done
done
exit $fail
