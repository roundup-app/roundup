#!/bin/bash
# usage: observe.sh   (run from the repo root after `cargo build -p rupd -p rup`; starts its own rupd on the fake claude, Vite and a headless agent-browser session)
# U346: at 1280x800 and 700x800, with a Terminal open, the confirm `delete` of an Agent-owned Pad, a user-owned Pad and a Todo must be what
# elementFromPoint returns at its centre, and a pointer click there must remove the item. Exits non-zero on any miss.
set -u
root=$(pwd); dir=$(mktemp -d); port=5346; fail=0
export RUPD_SOCKET=$dir/rupd.sock CLAUDE_CONFIG_DIR=$dir/cc ROUNDUP_RUP_BIN=$root/target/debug/rup ROUNDUP_CLAUDE_BIN=$root/crates/rup/tests/e2e/fake_claude.py
(echo "roundup-proof 1 $(printf '0%.0s' $(seq 64))"; sleep 3600) | "$root/target/debug/rupd" "$dir" --attached 2>"$dir/rupd.log" &
sleep 4
ROUNDUP_REAL_PROJECT=$dir pnpm --filter desktop exec vite --host 127.0.0.1 --port $port --strictPort >"$dir/vite.log" 2>&1 &
sleep 6
rpc(){ curl -s -X POST -H 'Content-Type: application/json' -d "{\"method\":\"$1\",\"params\":$2}" http://127.0.0.1:$port/__daemon/rpc; }
agent=$(rpc agent.spawn '{"cwd":"'$dir'","prompt":"hello","parent":null}' | sed -E 's/.*"id":"([^"]+)".*/\1/')
echo "agent: $agent"
for W in 1280 700; do
  for kind in pad-user pad-agent todo; do
    S=u346-$W-$kind
    ev(){ agent-browser --session $S eval "$1" 2>&1 | tail -1; }
    case $kind in
      pad-user)  rpc pad.create '{"name":"plan'$W'","text":"v1"}' >/dev/null; item=plan$W; want=user ;;
      pad-agent) rpc pad.create '{"name":"notes'$W'","text":"v1"}' >/dev/null
                 rpc pad.setOwner '{"name":"notes'$W'","owner":{"kind":"agent","id":"'$agent'","parent":null}}' >/dev/null; item=notes$W; want=agent ;;
      todo)      rpc todo.create '{"title":"chore'$W'","body":null,"blockers":null}' >/dev/null; item=chore$W; want= ;;
    esac
    if [ -n "$want" ]; then
      owner=$(rpc pad.read '{"name":"'$item'"}' | grep -o '"owner":{"kind":"[a-z]*"' | grep -o '[a-z]*"$' | tr -d '"')
      echo "$W $kind: owner $owner"; [ "$owner" = "$want" ] || fail=1
    fi
    agent-browser --session $S set viewport $W 800 >/dev/null 2>&1
    agent-browser --session $S open "http://127.0.0.1:$port/harness.html?daemon=1" >/dev/null 2>&1; sleep 3
    ev "(()=>{const b=document.querySelector('.rail [role=treeitem], .rail [role=row], .rail li');b&&b.click();return !!b})()" >/dev/null; sleep 4
    if [ "$kind" = pad-agent ]; then # an Agent-owned Pad shows under its Agent's Rail row (U58), not on the Shelf
      ev "(()=>{const c=document.querySelector('[data-pads-control]');c&&c.click();return !!c})()" >/dev/null; sleep 1
      ev "(()=>{const b=[...document.querySelectorAll('.rail-pad')].find(x=>x.textContent.includes('$item'));b&&b.click();return !!b})()" >/dev/null; sleep 1
    else
      ev "(()=>{const b=[...document.querySelectorAll('.shelf button')].find(x=>x.textContent.includes('$item'));b&&b.click();return !!b})()" >/dev/null; sleep 1
    fi
    ev "(()=>{const b=[...document.querySelectorAll('[aria-label=drawer] button')].find(x=>x.textContent.trim()==='delete');b&&b.click();return !!b})()" >/dev/null; sleep 1
    out=$(ev "(()=>{const bs=[...document.querySelectorAll('[aria-label=drawer] button')].filter(x=>x.textContent.trim()==='delete'),b=bs[0];if(!b)return 'no button';const q=b.getBoundingClientRect(),hit=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return JSON.stringify({width:innerWidth,buttons:bs.length,hit:hit===b,hitTag:hit&&hit.tagName+'.'+hit.className,x:Math.round(q.left+q.width/2),y:Math.round(q.top+q.height/2)})})()")
    agent-browser --session $S screenshot "$root/artifacts/ux/U346/question-$kind-$W.png" >/dev/null 2>&1
    echo "$W $kind: $out"
    xy=$(echo "$out" | sed -E 's/.*\\"x\\":([0-9]+),\\"y\\":([0-9]+).*/\1 \2/')
    agent-browser --session $S mouse move $xy >/dev/null 2>&1; agent-browser --session $S mouse down >/dev/null 2>&1; agent-browser --session $S mouse up >/dev/null 2>&1; sleep 4
    gone=$(ev "(()=>!document.querySelector('[aria-label=drawer]')?.innerText&&!document.body.innerText.includes('$item'))()")
    echo "$W $kind: pointer click removed it: $gone"
    case "$gone" in *true*) ;; *) fail=1 ;; esac
    case "$out" in *'hit\":true'*) ;; *) fail=1 ;; esac
    agent-browser --session $S screenshot "$root/artifacts/ux/U346/confirm-$kind-$W.png" >/dev/null 2>&1
    agent-browser --session $S close >/dev/null 2>&1
  done
done
[ -n "${KEEP:-}" ] && { echo "$dir"; exit 0; }
kill %1 %2 2>/dev/null; rm -rf "$dir"
exit $fail
