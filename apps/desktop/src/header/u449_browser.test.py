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
  const titleRange=document.createRange();
  if(title)titleRange.selectNodeContents(title);
  const titleCss=title ? getComputedStyle(title) : null;
  const controls=[...document.querySelectorAll('.strip button,.tab-rename,.strip-edge,.tab-tip')].map(e=>({box:e.getBoundingClientRect().toJSON(),visible:getComputedStyle(e).visibility!=='hidden',name:e.className}));
  return {width:innerWidth,bar:box('.header'),reserved:box('.traffic-lights'),title:box('.window-title'),titleText:title?.textContent ?? "",titleName:title?.getAttribute('aria-label') ?? "",titleTip:title?.title ?? "",
    titleStyle:{overflow:title ? getComputedStyle(title).textOverflow : "",whiteSpace:title ? getComputedStyle(title).whiteSpace : ""},
    titleTextWidth:title ? titleRange.getBoundingClientRect().width : 0,titlePadding:titleCss ? parseFloat(titleCss.paddingLeft)+parseFloat(titleCss.paddingRight) : 0,
    strip:box('.strip'),rail:box('.rail'),centre:box('.centre'),shelf:box('.shelf'),hide:box('[aria-label="Hide work items"]'),show:box('[aria-label="Show work items"]'),drawer:box('.drawer'),close:box('.drawer .close'),menu:box('.tab-menu'),
    centreSurfaces:[...document.querySelectorAll('.centre .decision-card,.centre .order-line,.centre .thread-header')].map(e=>e.getBoundingClientRect().toJSON()),
    checks:window.__checks(),controls,plus:box('.strip-add'),scroll:{width:document.querySelector('.tablist').clientWidth,total:document.querySelector('.tablist').scrollWidth}};
})()"""


def capture(name):
    result = evaluate(read)
    result["case"] = name
    records.append(result)
    if output:
        directory = Path(output) / variant
        directory.mkdir(parents=True, exist_ok=True)
        (directory / (name + ".geometry.json")).write_text(json.dumps(result, separators=(",", ":")) + "\n")
        (directory / (name + ".checks.json")).write_text(json.dumps(result["checks"], separators=(",", ":")) + "\n")
        browser("screenshot", str(directory / (name + ".png")))
    return result


def settle():
    # Flush the strip's measurements even when a headless page holds its scroll and resize frames; a slot that appears needs another to settle.
    for _ in range(3):
        evaluate("document.querySelector('.tablist').dispatchEvent(new Event('scroll'))")
        browser("wait", "200")


# U440: the overflow edges beside the tab list, at the widest and the narrowest windows.
if len(sys.argv) > 5 and sys.argv[5] == "edges":
    try:
        browser("open", origin + "harness.html?seed=tabs-8")
        for width in (1280, 700):
            browser("set", "viewport", str(width), "800")
            browser("set", "media", "light")
            browser("open", origin + "harness.html?seed=tabs-8")
            browser("wait", ".strip-add")
            browser("wait", "--fn", "document.querySelectorAll('.project-tab').length === 8")
            for pick in ("first", "last"):
                evaluate("const t=[...document.querySelectorAll('.tab-name-button')];t[" + ("0" if pick == "first" else "t.length-1") + "].click()")
                browser("wait", "--fn", "(() => {const t=[...document.querySelectorAll('.tab-name-button')];return t[" +
                        ("0" if pick == "first" else "t.length-1") + "].getAttribute('aria-selected') === 'true'})()")
                settle()
                browser("wait", "--fn", "document.querySelector('.tab-name-button[aria-selected=true]').closest('.project-tab').getBoundingClientRect().left >= document.querySelector('.tablist').getBoundingClientRect().left")
                revealed = evaluate("document.querySelector('.tab-name-button[aria-selected=true]').closest('.project-tab').getBoundingClientRect().toJSON()")
                evaluate("const list=document.querySelector('.tablist');list.scrollLeft=" + ("0" if pick == "first" else "list.scrollWidth"))
                browser("wait", "--fn", "(() => {const list=document.querySelector('.tablist');return " +
                        ("list.scrollLeft === 0" if pick == "first" else "Math.abs(list.scrollWidth-list.clientWidth-list.scrollLeft) <= 1") + "})()")
                settle()
                records.append({"case": f"tabs-8-{width}-{pick}", "revealed": revealed, **evaluate(r"""(() => {
                  const box = e => e.getBoundingClientRect().toJSON();
                  const selected = document.querySelector('.tab-name-button[aria-selected=true]').closest('.project-tab');
                  return {list: box(document.querySelector('.tablist')), fades: [...document.querySelectorAll('.strip-fade')].map(box), slots: document.querySelectorAll('.strip-slot').length, selected: box(selected),
                    tabs: [...document.querySelectorAll('.project-tab')].map(box),
                    edges: [...document.querySelectorAll('.strip-edge')].map(box)};
                })()""")})
                if output and width >= 1280:
                    directory = Path(output) / "edges" / variant
                    directory.mkdir(parents=True, exist_ok=True)
                    name = records[-1]["case"]
                    (directory / (name + ".geometry.json")).write_text(json.dumps(records[-1]) + "\n")
                    (directory / (name + ".checks.json")).write_text(json.dumps(evaluate("window.__checks()")) + "\n")
                    browser("screenshot", str(directory / (name + ".png")))
        print(json.dumps(records))
    finally:
        browser("close")
    sys.exit(0)

# Reuse the isolated browser driver for the dependent U440–U443 geometry.
if len(sys.argv) > 5 and sys.argv[5] == "boxes":
    try:
        browser("open", origin + "harness.html?seed=first-run")
        for width, height in ((1280, 800), (1280, 820), (1440, 800)):
            browser("set", "viewport", str(width), str(height))
            for scheme in ("light", "dark"):
                browser("set", "media", scheme)
                for seed in ("first-run", "agents-10", "two-projects", "three-projects", "tree-40", "tabs-8"):
                    evaluate("localStorage.clear()")
                    browser("open", origin + "harness.html?seed=" + ("agents-10" if seed in ("two-projects", "three-projects") else seed))
                    browser("wait", ".strip-add")
                    if seed in ("two-projects", "three-projects"):
                        for index in range(1, 2 if seed == "two-projects" else 3):
                            evaluate(f"window.__fake.app.chooser.path='/u440/project-{index}';document.querySelector('.strip-add').click()")
                            browser("wait", "--fn", f"document.querySelectorAll('.project-tab').length === {index + 1}")
                    if seed != "first-run":
                        evaluate("document.querySelector('.tab-name-button').focus();document.querySelector('.tab-name-button').click()")
                        browser("wait", "--fn", "document.querySelector('.tab-name-button').getAttribute('aria-selected') === 'true'")
                    browser("wait", "--fn", "![...document.querySelectorAll('.tab-name-button')].some(e=>e.getAttribute('aria-busy')==='true')")
                    prefix = f"{seed}-{width}x{height}-{scheme}"
                    result = capture(prefix)
                    result["rule"] = evaluate("(() => {const css=getComputedStyle(document.querySelector('.header'));return {width:css.borderBottomWidth,colour:css.borderBottomColor,token: (()=>{const e=document.createElement('span');e.style.color='var(--hairline)';document.querySelector('.header').append(e);const c=getComputedStyle(e).color;e.remove();return c;})()};})()")
                    result["tabs"] = evaluate(r"""(() => {
                      const box=e=>e.getBoundingClientRect().toJSON();
                      return [...document.querySelectorAll('.project-tab')].map(e=>{
                        const name=e.querySelector('.tab-name-button'),close=e.querySelector('.tab-close'),mark=e.querySelector('.tab-mark'),css=getComputedStyle(e);
                        const m=mark&&getComputedStyle(mark);
                        return {box:box(e),name:box(name),tail:box(e.querySelector('.tab-tail')),close:box(close),border:css.borderTopWidth,bottomBorder:css.borderBottomWidth,
                          pad:getComputedStyle(name).paddingInlineStart,icons:e.querySelectorAll('.tab-name-button svg').length,
                          mark:mark?{box:box(mark),radius:m.borderRadius,background:m.backgroundColor,colour:m.color,children:mark.children.length,label:mark.getAttribute('aria-label')}:null};
                      });
                    })()""")
                    if result["tabs"]:
                        target = ".project-tab:nth-child(2)" if seed == "three-projects" else ".project-tab:first-child"
                        browser("hover", target)
                        browser("hover", target + " .tab-close")
                        if output:
                            capture(prefix + "-hover")
                            records.pop()
                        result["hover"] = evaluate("JSON.stringify([...document.querySelectorAll('.project-tab')].map(e=>e.getBoundingClientRect().toJSON()))")
                        result["paint"] = evaluate("(() => {const e=document.querySelector('" + target + "'),c=getComputedStyle(e);return {image:c.backgroundImage,background:c.backgroundColor,selected:e.dataset.selected};})()")
                        result["rest"] = json.dumps([t["box"] for t in result["tabs"]], separators=(",", ":"))
                        evaluate("const tabs=[...document.querySelectorAll('.tab-name-button')];(tabs.length===3?tabs[1]:tabs[0]).click()")
                        if output:
                            capture(prefix + "-selected")
                            records.pop()
                        result["selected"] = evaluate("JSON.stringify([...document.querySelectorAll('.project-tab')].map(e=>e.getBoundingClientRect().toJSON()))")
                        evaluate("document.querySelector('.tab-name-button').focus()")
                        browser("press", "F2")
                        browser("wait", ".tab-rename")
                        result["rename"] = evaluate("(() => {const e=document.querySelector('.tab-rename');return {field:e.getBoundingClientRect().toJSON(),tab:e.closest('.project-tab').getBoundingClientRect().toJSON(),padding:getComputedStyle(e).paddingInlineStart};})()")
                        browser("press", "Escape")
                        if seed == "agents-10":
                            evaluate("for(let i=1;i<=10;i++)window.__fake.setStatus('agent-'+i,'working')")
                            browser("wait", "--fn", "!document.querySelector('.project-tab .tab-mark')")
                            result["markChanged"] = evaluate("JSON.stringify([...document.querySelectorAll('.project-tab')].map(e=>e.getBoundingClientRect().toJSON()))")
                        result["edges"] = evaluate("[...document.querySelectorAll('.strip-edge')].map(e=>({box:e.getBoundingClientRect().toJSON(),mark:e.querySelector('.tab-mark').getBoundingClientRect().toJSON()}))")
                    if output:
                        (Path(output) / variant / (prefix + ".geometry.json")).write_text(json.dumps(result) + "\n")
        print(json.dumps(records))
    finally:
        browser("close")
    sys.exit(0)

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
    for width in (1280, 1440, 1600):
        browser("set", "viewport", str(width), "800")
        for scheme in ("light", "dark"):
            browser("set", "media", scheme)
            for seed in ("first-run", "agents-10", "tabs-8", "tree-40", "decisions"):
                evaluate("localStorage.clear()")
                browser("open", origin + "harness.html?seed=" + seed)
                browser("wait", ".strip")
                browser("wait", "--fn", "document.querySelector('.shelf').getBoundingClientRect().left < innerWidth")
                if seed != "first-run":
                    browser("wait", ".todo-project-root")
                prefix = f"{seed}-{width}-{scheme}"
                capture(prefix + "-rest")
                if seed == "decisions":
                    browser("wait", ".decision-card")
                    evaluate("document.querySelector('[aria-label=\"Hide work items\"]').click()")
                    browser("wait", '[aria-label="Show work items"]')
                    capture(prefix + "-closed")
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
                                evaluate("document.querySelector('[aria-label=\"Hide work items\"]').click()")
                                browser("wait", '[aria-label="Show work items"]')
                            frames = evaluate(f"({slide})({json.dumps(selector)})")
                            if kind == "Pad":
                                browser("wait", ".pad-body .ProseMirror")
                            opened = capture(prefix + f"-{kind}-{'open' if shelf_open else 'closed'}-shelf")
                            opened["opening"] = frames
                            opened["closing"] = evaluate(f"({slide})('.drawer .close')")
                            if output:
                                directory = Path(output) / variant
                                (directory / (opened["case"] + ".geometry.json")).write_text(json.dumps(opened, separators=(",", ":")) + "\n")
                            if not shelf_open:
                                evaluate("document.querySelector('[aria-label=\"Show work items\"]').click()")
                                browser("wait", '[aria-label="Hide work items"]')
                    # Selection identifies the Workstream in the bar, independent of Shelf width.
                    evaluate("document.querySelector('[role=treeitem]').click()")
                    capture(prefix + "-selected")
                    evaluate("document.querySelector('.window').style.setProperty('--shelf-span','400px')")
                    capture(prefix + "-resized")
                    evaluate("document.querySelector('[aria-label=\"Hide work items\"]').click()")
                    capture(prefix + "-closed")
                    browser("wait", '.rail [data-id="tokens"]')
                    evaluate("document.querySelector('.rail [data-id=\"tokens\"]').click()")
                    browser("wait", ".order-line")
                    capture(prefix + "-closed-agent")
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
