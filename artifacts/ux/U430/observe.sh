#!/bin/bash
# U430 observer. usage: observe.sh   (needs `just harness tree-40 5199`; headless agent-browser session of its own)
S=obs-u430
ab(){ agent-browser --session $S "$@" >/dev/null 2>&1; }
ev(){ agent-browser --session $S --json eval "$1" | jq -c '.data.result'; }
out=$(dirname "$0")
measure='(()=>{const d=document.querySelector("aside.drawer").getBoundingClientRect(),c=document.querySelector(".centre").getBoundingClientRect(),r=document.querySelector(".rail").getBoundingClientRect(),inputs=[...document.querySelectorAll(".centre input, .centre textarea, .centre button")].map(e=>e.getBoundingClientRect()).filter(b=>b.width>0);return {window:innerWidth,rail:[r.left,r.right],centre:[c.left,c.right],drawer:[d.left,d.right],gap:d.left-c.right,railUncovered:d.left>=r.right-0.5,controls:inputs.length,underDrawer:inputs.filter(b=>b.right>d.left+0.5).length,failing:Object.entries(window.__checks()).filter(([,v])=>v.status==="fail").map(([k])=>k)}})()'
for w in 1280x820 700x800; do
  ab set viewport ${w%x*} ${w#*x}; ab open "http://localhost:5199/harness.html?seed=tree-40"; sleep 3
  ev 'document.querySelector(".rail-row").click();0' >/dev/null; sleep 1
  ev '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="show all")?.click();0' >/dev/null; sleep 1
  ev 'document.querySelector(".todo-row-button").click();0' >/dev/null
  # 4 sampled frames of the slide: Drawer left edge less the centre's right edge
  ev 'new Promise(r=>{const f=[];const t=()=>{const d=document.querySelector("aside.drawer").getBoundingClientRect(),c=document.querySelector(".centre").getBoundingClientRect();f.push(Math.round((d.left-c.right)*100)/100);f.length<14?requestAnimationFrame(t):r(f)};t()})' | tee "$out/frames-$w.json"
  sleep 1
  ev "$measure" | tee "$out/boxes-$w.json"
  ab screenshot "$out/drawer-$w.png"
  ev 'JSON.stringify(window.__checks())' | jq -r . > "$out/drawer-$w.checks.json"
done
ab close
