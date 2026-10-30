#!/bin/bash
# U431 observer. usage: observe.sh   (needs `just harness tree-40 5199`; headless agent-browser session of its own)
S=obs-u431
ab(){ agent-browser --session $S "$@" >/dev/null 2>&1; }
ev(){ agent-browser --session $S --json eval "$1" | jq -c '.data.result'; }
out="$(pwd)/artifacts/ux/U431"
mkdir -p "$out"
measure='(()=>{const bar=document.querySelector(".milkdown-top-bar"),dr=document.querySelector("aside"),head=document.querySelector(".pad-head");if(!bar)return {error:"no toolbar"};const items=[...bar.querySelectorAll("button")].map(b=>({t:Math.round(b.getBoundingClientRect().top),l:b.getBoundingClientRect().left,r:b.getBoundingClientRect().right,title:b.getAttribute("title"),label:b.getAttribute("aria-label")}));const d=dr.getBoundingClientRect(),hb=[...head.children].map(c=>c.getBoundingClientRect());const close=dr.querySelector("[aria-label=close]").getBoundingClientRect();return {drawerWidth:d.width,items:items.length,oneRow:new Set(items.map(i=>i.t)).size===1,untitled:items.filter(i=>!(i.title||i.label)).length,clipped:items.filter(i=>i.r>d.right+0.5||i.l<d.left-0.5).length,barScrollsX:bar.scrollWidth>bar.clientWidth,headBeforeClose:hb.every(b=>b.right<=close.left+0.5)&&hb.every((b,i)=>i===0||b.left>=hb[i-1].right-0.5),headNames:[...head.querySelectorAll("button")].map(b=>b.getAttribute("aria-label")),failing:Object.entries(window.__checks()).filter(([,v])=>v.status==="fail").map(([k])=>k)}})()'
for w in 1280x820 700x800; do
  ab set viewport ${w%x*} ${w#*x}; ab open "http://localhost:5199/harness.html?seed=tree-40"; sleep 3
  ev 'document.querySelector("#shelf-tab-pads").click();0' >/dev/null; sleep 1
  ev 'document.querySelectorAll("[data-shelf-row] .pad-name")[3].click();0' >/dev/null; sleep 2
  ev "document.querySelector(\".pad-rich-editor .ProseMirror\").click();0" >/dev/null; sleep 1; ev "$measure" | tee "$out/toolbar-$w.json"
  ab screenshot "$out/drawer-$w.png"
  ev 'JSON.stringify(window.__checks())' | jq -r . > "$out/drawer-$w.checks.json"
  # u431_long_name_overlaps_no_icon: a 300-character name cuts; no icon is overlapped or shrunk
  ev 'document.querySelector(".pad-head-name").textContent="x".repeat(300);0' >/dev/null
  ev '(()=>{const h=document.querySelector(".pad-head"),n=h.querySelector(".pad-head-name").getBoundingClientRect(),i=[...h.querySelectorAll("button")].map(b=>b.getBoundingClientRect());return {nameRight:n.right,iconsLeft:Math.min(...i.map(r=>r.left)),iconWidths:i.map(r=>r.width),overlap:i.some(r=>n.right>r.left+0.5),headWide:h.scrollWidth>h.clientWidth}})()' | tee "$out/longname-$w.json"
done
ab close
