"""U449–U451 rendered geometry in an isolated headless agent-browser profile."""
import json
from pathlib import Path
import subprocess
import sys
import uuid

session = "builder-1104-" + uuid.uuid4().hex
origin, output, native_output = sys.argv[1:4]
variant = sys.argv[4] if len(sys.argv) > 4 else "head"
if variant not in ("head", "base"):
    raise ValueError("variant must be head or base")
records = []


def browser(*args):
    result = subprocess.run(["agent-browser", "--session", session, "--json", *args],
                            text=True, capture_output=True, timeout=40)
    if result.returncode or not result.stdout:
        raise RuntimeError(result.stderr or result.stdout)
    reply = json.loads(result.stdout)
    if not reply["success"]:
        raise RuntimeError(reply)
    return reply["data"]


def evaluate(script):
    if script.startswith("const "):
        script = "(() => {" + script + "})()"
    return browser("eval", script)["result"]


read = r"""(() => {
  const box = selector => {const e=document.querySelector(selector);return e ? e.getBoundingClientRect().toJSON() : null;};
  const title=document.querySelector('.window-title');
  const controls=[...document.querySelectorAll('.strip button,.tab-rename,.strip-edge,.tab-tip')].map(e=>({box:e.getBoundingClientRect().toJSON(),visible:getComputedStyle(e).visibility!=='hidden',name:e.className}));
  return {width:innerWidth,bar:box('.header'),reserved:box('.traffic-lights'),title:box('.window-title'),titleText:title?.textContent ?? "",titleName:title?.getAttribute('aria-label') ?? "",titleTip:title?.title ?? "",
    titleStyle:{overflow:title ? getComputedStyle(title).textOverflow : "",whiteSpace:title ? getComputedStyle(title).whiteSpace : ""},
    strip:box('.strip'),rail:box('.rail'),centre:box('.centre'),shelf:box('.shelf'),hide:box('[aria-label="Hide Shelf"]'),show:box('[aria-label="Show Shelf"]'),drawer:box('.drawer'),close:box('.drawer .close'),menu:box('.tab-menu'),
    checks:window.__checks(),controls,plus:box('.strip-add'),scroll:{width:document.querySelector('.tablist').clientWidth,total:document.querySelector('.tablist').scrollWidth}};
})()"""


def capture(name):
    result = evaluate(read)
    result["case"] = name
    records.append(result)
    if output:
        directory = Path(output) / variant
        directory.mkdir(parents=True, exist_ok=True)
        (directory / (name + ".checks.json")).write_text(json.dumps(result, separators=(",", ":")) + "\n")
        browser("screenshot", str(directory / (name + ".png")))
    return result


slide = r"""async (selector) => {
 const panel=document.querySelector('.drawer');
 const frames=[];
 let done=false;
 const ended=new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Drawer did not settle')),3000);
   panel.addEventListener('transitionend',function end(e){
     if(e.target!==panel||e.propertyName!=='transform')return;
     panel.removeEventListener('transitionend',end);clearTimeout(timeout);done=true;resolve();
   });
 });
 const sample=()=>{const d=panel.getBoundingClientRect(),b=document.querySelector('.header').getBoundingClientRect();
   frames.push({top:d.top,bottom:d.bottom,barBottom:b.bottom,title:document.querySelector('.window-title')?.getBoundingClientRect().toJSON() ?? null});
   if(!done)requestAnimationFrame(sample);
 };
 requestAnimationFrame(sample);
 document.querySelector(selector).click();await ended;await new Promise(requestAnimationFrame);
 return frames;
}"""

try:
    browser("open", origin + "harness.html?seed=first-run")
    for width in (1280, 1600):
        browser("set", "viewport", str(width), "800")
        for scheme in ("light", "dark"):
            browser("set", "media", scheme)
            for seed in ("first-run", "agents-10", "tabs-8", "tree-40"):
                evaluate("localStorage.clear()")
                browser("open", origin + "harness.html?seed=" + seed)
                browser("wait", ".strip")
                browser("wait", "--fn", "document.querySelector('.shelf').getBoundingClientRect().left < innerWidth")
                if seed != "first-run":
                    browser("wait", ".todo-project-root")
                prefix = f"{seed}-{width}-{scheme}"
                capture(prefix + "-rest")
                if seed == "tree-40":
                    # Every Drawer keeps its top throughout opening and closing, with either Shelf state.
                    for shelf_open in (True, False):
                        for kind in ("Todo", "Pad", "Work-order"):
                            evaluate("document.querySelector('.todo-project-root').click()")
                            if kind == "Pad":
                                evaluate("[...document.querySelectorAll('.shelf [role=tab]')].find(e=>e.textContent.startsWith('Pads')).click()")
                                browser("wait", ".shelf .pad-name")
                                selector = ".shelf .pad-name"
                            elif kind == "Todo":
                                evaluate("[...document.querySelectorAll('.shelf [role=tab]')].find(e=>e.textContent.startsWith('Todos')).click()")
                                browser("wait", ".shelf .todo-row-button")
                                selector = ".shelf .todo-row-button"
                            else:
                                evaluate("document.querySelector('[role=treeitem]').click()")
                                browser("wait", ".thread-header button")
                                selector = ".thread-header button"
                            if not shelf_open:
                                evaluate("document.querySelector('[aria-label=\"Hide Shelf\"]').click()")
                                browser("wait", '[aria-label="Show Shelf"]')
                            frames = evaluate(f"({slide})({json.dumps(selector)})")
                            if kind == "Pad":
                                browser("wait", ".pad-body .ProseMirror")
                            opened = capture(prefix + f"-{kind}-{'open' if shelf_open else 'closed'}-shelf")
                            opened["opening"] = frames
                            opened["closing"] = evaluate(f"({slide})('.drawer .close')")
                            if output:
                                directory = Path(output) / variant
                                (directory / (opened["case"] + ".checks.json")).write_text(json.dumps(opened, separators=(",", ":")) + "\n")
                            if not shelf_open:
                                evaluate("document.querySelector('[aria-label=\"Show Shelf\"]').click()")
                                browser("wait", '[aria-label="Hide Shelf"]')
                    # Selection identifies the Workstream in the bar, independent of Shelf width.
                    evaluate("document.querySelector('[role=treeitem]').click()")
                    capture(prefix + "-selected")
                    evaluate("document.querySelector('.window').style.setProperty('--shelf-span','400px')")
                    capture(prefix + "-resized")
                    evaluate("document.querySelector('[aria-label=\"Hide Shelf\"]').click()")
                    capture(prefix + "-closed")
                if seed == "tabs-8":
                    evaluate(r"""(async()=>{
                      const app=window.__fake.app;
                      const projects=await app.projects();
                      for(const p of projects)app.of(p.path).emit({actor:{kind:'user',id:'you',parent:null},name:'project.requested',data:{kind:'rename',path:p.path,name:('Project '+p.name+' ').padEnd(40,'x').slice(0,40)}});
                      const p=projects[0];
                      document.querySelector('[data-path="'+p.path+'"] [role=tab]').click();
                      const daemon=app.of(p.path);
                      const tree=await daemon.rpc('rail.tree',{});
                      const row={...tree[0],id:'long-workstream',name:'W'.repeat(300),kind:'workstream',parent:null,attempt:null,status_revision:null,status:null,terminal_id:null};
                      daemon.handlers['rail.tree']=()=>[row,...tree];
                      daemon.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
                      window.__longWorkstream=row.id;
                    })()""")
                    if variant == "head":
                        browser("wait", "--fn", "document.querySelector('.tablist').scrollWidth > document.querySelector('.tablist').clientWidth")
                    browser("wait", "--fn", "document.querySelector('[data-id=\"'+window.__longWorkstream+'\"]') !== null")
                    evaluate("document.querySelector('[data-id=\"'+window.__longWorkstream+'\"]').click()")
                    capture(prefix + "-overflow")
                    evaluate("const list=document.querySelector('.tablist'),tab=list.querySelector('.tab-mark').closest('[role=tab]');list.scrollLeft=tab.closest('.project-tab').offsetLeft+20;tab.focus({preventScroll:true})")
                    browser("wait", ".tab-tip")
                    capture(prefix + "-tooltip")
                    evaluate("document.activeElement.blur();document.querySelector('.tablist').scrollLeft=0")
                    evaluate("const v=document.querySelector('.tablist').getBoundingClientRect(),end=document.querySelector('.strip-edge-right')?.getBoundingClientRect().left??v.right;const tab=[...document.querySelectorAll('.project-tab')].filter(e=>{const r=e.getBoundingClientRect();return Math.min(r.right,end)-Math.max(r.left,v.left)>16}).at(-1);const r=tab.getBoundingClientRect();tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:Math.min(r.right,end)-8,clientY:24}))")
                    browser("wait", ".tab-menu")
                    capture(prefix + "-menu")
                    evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
                    evaluate("document.querySelector('.tab-name').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
                    browser("wait", ".tab-rename")
                    capture(prefix + "-rename")
                    evaluate("window.__fake.app.renameProject=async()=>{throw Error('Project rename failed')};const input=document.querySelector('.tab-rename');input.value='rename';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))")
                    browser("wait", "[role=alert]")
                    capture(prefix + "-failure")
                    evaluate("window.__fake.app.exitDaemon({code:1})")
                    browser("wait", ".rail .word")
                    capture(prefix + "-exit")
    if native_output:
        directory = Path(native_output) / "head"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "reserved-geometry.json").write_text(json.dumps([{key: record[key] for key in ("case", "width", "bar", "reserved", "title")} for record in records], separators=(",", ":")) + "\n")
    print(json.dumps(records))
finally:
    browser("close")
