#!/bin/bash
# usage: observe.sh   (needs `just harness decisions 5199`; fake Daemon)
# U194: at 1280x800 and 700x800 a 300-character Bash command opens on agent-1; `allow` and `deny` must lie inside the Card's
# rectangle and be what elementFromPoint returns at their centres, with the order line shown and with it removed from layout.
# Exits non-zero on any miss.
fail=0
for W in 1280 700; do
  S=u194-$W
  ev(){ agent-browser --session $S eval "$1" 2>&1 | tail -1; }
  agent-browser --session $S set viewport $W 800 >/dev/null 2>&1
  agent-browser --session $S open "http://localhost:5199/harness.html?seed=decisions" >/dev/null 2>&1; sleep 2
  ev 'window.__fake.app.emit({actor:{kind:"user"},name:"decision.opened",data:{id:"d-long",agent:"agent-1",tool:"Bash",args:JSON.stringify({command:"echo "+"x".repeat(300)}),opened_at:Date.now(),answerable:true}});0' >/dev/null; sleep 1
  for line in shown hidden; do
    [ $line = hidden ] && ev 'document.querySelectorAll(".order-line").forEach(e=>e.style.display="none");0' >/dev/null
    out=$(ev '(()=>{const r=e=>{const b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom].map(Math.round)},c=document.querySelector(".decision-card"),o=document.querySelector(".order-line"),bs=[...c.querySelectorAll(".decision-buttons button")],cr=c.getBoundingClientRect(),res=bs.map(b=>{const q=b.getBoundingClientRect(),hit=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return {button:b.textContent,rect:r(b),inside:q.left>=cr.left&&q.right<=cr.right&&q.top>=cr.top&&q.bottom<=cr.bottom,hit:hit===b}});return JSON.stringify({width:innerWidth,orderLine:o&&getComputedStyle(o).display!=="none"?r(o):null,card:r(c),res,ok:res.length===2&&res.every(x=>x.inside&&x.hit)})})()')
    echo "$W order line $line: $out"
    case "$out" in *'ok\":true'*) ;; *) fail=1 ;; esac
  done
  agent-browser --session $S close >/dev/null 2>&1
done
exit $fail
