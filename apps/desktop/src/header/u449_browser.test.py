"""U449–U451 rendered geometry in an isolated headless agent-browser profile."""
import json
from pathlib import Path
import subprocess
import sys
import uuid
from tempfile import TemporaryDirectory

session = "builder-1104-" + uuid.uuid4().hex
origin, output, native_output = sys.argv[1:4]
variant = sys.argv[4] if len(sys.argv) > 4 else "head"
if variant not in ("head", "base"):
    raise ValueError("variant must be head or base")
records = []
profile = TemporaryDirectory(prefix="u449-")


def browser(*args):
    result = subprocess.run(["agent-browser", "--session", session, "--profile", profile.name, "--json", *args],
                            text=True, capture_output=True, timeout=40)
    if result.returncode or not result.stdout:
        raise RuntimeError(f"{args}: {result.stderr or result.stdout}")
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
  return {width:innerWidth,bar:box('.header'),reserved:box('.traffic-lights'),title:box('.window-title'),windowTitle:window.__fake.app.windowOperations.filter(op=>op.kind==='title').at(-1)?.title ?? "",titleName:title?.getAttribute('aria-label') ?? "",titleTip:document.getElementById(title?.getAttribute('aria-describedby'))?.textContent ?? "",
    titleStyle:{overflow:title ? getComputedStyle(title).textOverflow : "",whiteSpace:title ? getComputedStyle(title).whiteSpace : ""},
    titleTextWidth:title ? titleRange.getBoundingClientRect().width : 0,titlePadding:titleCss ? parseFloat(titleCss.paddingLeft)+parseFloat(titleCss.paddingRight) : 0,
    strip:box('.strip'),rail:box('.rail'),centre:box('.centre'),shelf:box('.shelf'),drawer:box('.drawer'),close:box('.drawer .close'),menu:window.__fake.app.shownMenus.at(-1) ?? null,
    centreSurfaces:[...document.querySelectorAll('.centre .pane-screen,.centre .terminal-bar')].map(e=>e.getBoundingClientRect().toJSON()),
    checks:matchMedia('(prefers-color-scheme: dark)').matches ? window.__checks() : {},controls,plus:box('.strip-add'),scroll:{width:document.querySelector('.tablist')?.clientWidth ?? 0,total:document.querySelector('.tablist')?.scrollWidth ?? 0}};
})()"""


def capture(name):
    result = evaluate(read)
    result["case"] = name
    records.append(result)
    if output and evaluate("matchMedia('(prefers-color-scheme: dark)').matches"):
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


def u2716a_scrolled_tree_keeps_overview_reachable():
    evaluate("document.querySelector('.rail-scroll').scrollTop=document.querySelector('.rail-scroll').scrollHeight")
    browser("wait", "--fn", "document.querySelector('.rail-scroll').scrollTop > 0")
    browser("click", ".rail [data-todo-root]")
    browser("wait", ".centre [aria-label='Project overview']")
    evaluate("document.querySelector('[role=treeitem]').click()")
    browser("wait", "--fn", "document.querySelector('[data-todo-root]').getAttribute('aria-pressed') === 'false'")
    evaluate("document.querySelector('.rail-scroll').scrollTop=document.querySelector('.rail-scroll').scrollHeight;const before=document.createElement('button');document.querySelector('[data-todo-root]').before(before);before.focus()")
    browser("press", "Tab")
    if not evaluate("document.activeElement.matches('[data-todo-root]')"):
        raise AssertionError("Tab did not reach Overview after scrolling")
    browser("press", "Enter")
    browser("wait", ".centre [aria-label='Project overview']")
    evaluate("document.querySelector('[data-todo-root]').previousElementSibling.remove()")


# U2716a uses this existing isolated driver; visual captures belong to the critic.
if len(sys.argv) > 5 and sys.argv[5] == "overview":
    try:
        browser("set", "viewport", "1512", "950")
        for scheme in ("light", "dark"):
            browser("set", "media", scheme)
            for seed in ("tree-40", "agents-10"):
                browser("open", origin + "harness.html?seed=" + seed)
                browser("wait", ".rail [data-todo-root]")
                evaluate("localStorage.clear();document.querySelector('[role=treeitem]').click()")
                browser("wait", "--fn", "document.querySelector('[data-todo-root]').getAttribute('aria-pressed') === 'false'")
                browser("hover", ".centre")
                prefix = f"u2716a-{seed}-{scheme}"
                capture(prefix + "-rest")
                browser("hover", "[data-todo-root]")
                capture(prefix + "-hover")
                browser("click", "[data-todo-root]")
                browser("wait", ".centre [aria-label='Project overview']")
                capture(prefix + "-selected-hover")
                browser("hover", ".centre")
                capture(prefix + "-selected")
                if seed == "tree-40":
                    u2716a_scrolled_tree_keeps_overview_reachable()
                    browser("hover", ".centre")
                    capture(prefix + "-selected-scrolled")
                evaluate("document.querySelector('#shelf-tab-todos[aria-expanded=false]')?.click()")
                evaluate("(async()=>{const fake=window.__fake,app=fake.app;const nodes=await app.rpc('rail.tree',{});const home=nodes.find(n=>n.kind==='workstream')??await app.rpc('rail.createWorkstream',{name:'Todo source',parent:null});const creator=nodes.find(n=>n.kind==='agent'&&n.terminal_id);fake.actAs({kind:'agent',id:creator.id,parent:creator.parent});const todo=await app.rpc('todo.create',{title:'Overview drag observer',body:null,blockers:null});await app.rpc('todo.move',{id:todo.id,home:home.id});fake.actAs({kind:'user',id:'you',parent:null});window.__overviewTodo=todo.id})()")
                browser("wait", "--fn", "Boolean(document.querySelector('.shelf [data-todo=\"'+window.__overviewTodo+'\"] .todo-row-button'))")
                source = evaluate("(()=>{const e=document.querySelector('.shelf [data-todo=\"'+window.__overviewTodo+'\"] .todo-row-button');e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}})()")
                browser("mouse", "move", str(round(source["x"])), str(round(source["y"])))
                target = evaluate("(()=>{const e=document.querySelector('[data-todo-root]');e.scrollIntoView({block:'nearest'});const b=e.getBoundingClientRect();return {x:b.right-2,y:b.top+b.height/2}})()")
                browser("mouse", "down")
                browser("mouse", "move", str(round(target["x"])), str(round(target["y"])))
                browser("wait", "[data-todo-drop]")
                capture(prefix + "-drag-over")
                browser("press", "Escape")
                browser("mouse", "up")
                if seed == "tree-40":
                    evaluate("window.__fake.failNext(-32000,'Cannot create this Workstream');document.querySelector('.rail-actions button').click()")
                    browser("wait", ".rail [role=alert]")
                    capture(prefix + "-failure")
        print(json.dumps(records))
    finally:
        browser("close")
    sys.exit(0)


# U440: the overflow edges beside the tab list, at the widest and the narrowest windows.
if len(sys.argv) > 5 and sys.argv[5] == "edges":
    try:
        browser("open", origin + "harness.html?seed=tabs-8")
        for width in (1280, 1000, 700):
            browser("set", "viewport", str(width), "800")
            browser("set", "media", "light")
            browser("open", origin + "harness.html?seed=tabs-8")
            browser("wait", ".strip-add")
            browser("wait", "--fn", "document.querySelectorAll('.project-tab').length === 8")
            for pick in ("first", "middle", "last"):
                index = {"first": "0", "middle": "3", "last": "t.length-1"}[pick]
                evaluate("const t=[...document.querySelectorAll('.tab-name-button')];t[" + index + "].click()")
                browser("wait", "--fn", "(() => {const t=[...document.querySelectorAll('.tab-name-button')];return t[" +
                        index + "].getAttribute('aria-selected') === 'true'})()")
                settle()
                browser("wait", "--fn", "document.querySelector('.tab-name-button[aria-selected=true]').closest('.project-tab').getBoundingClientRect().left >= document.querySelector('.tablist').getBoundingClientRect().left")
                revealed = evaluate("document.querySelector('.tab-name-button[aria-selected=true]').closest('.project-tab').getBoundingClientRect().toJSON()")
                if pick != "middle":
                    evaluate("const list=document.querySelector('.tablist');list.scrollLeft=" + ("0" if pick == "first" else "list.scrollWidth"))
                    browser("wait", "--fn", "(() => {const list=document.querySelector('.tablist');return " +
                            ("list.scrollLeft === 0" if pick == "first" else "Math.abs(list.scrollWidth-list.clientWidth-list.scrollLeft) <= 1") + "})()")
                    settle()
                records.append({"case": f"tabs-8-{width}-{pick}", "revealed": revealed, **evaluate(r"""(() => {
                  const box = e => e.getBoundingClientRect().toJSON();
                  const cuts = () => { const list=document.querySelector('.tablist'),style=list.style; return {start: parseFloat(style.getPropertyValue('--cut-start')), end: parseFloat(style.getPropertyValue('--cut-end')), mask: getComputedStyle(list).maskImage}; };
                  const selected = document.querySelector('.tab-name-button[aria-selected=true]').closest('.project-tab');
                  return {list: box(document.querySelector('.tablist')), cuts: cuts(), slots: document.querySelectorAll('.strip-slot').length, selected: box(selected),
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
        # A list one pixel wider than a tab: the open tab can end up cut, and no fade may take it.
        evaluate("const t=[...document.querySelectorAll('.tab-name-button')];t[0].click()")
        settle()
        evaluate("document.querySelector('.tablist').style.maxWidth=(document.querySelector('.project-tab').getBoundingClientRect().width+1)+'px'")
        settle()
        evaluate("const t=[...document.querySelectorAll('.tab-name-button')];t[3].click()")
        browser("wait", "--fn", "document.querySelectorAll('.tab-name-button')[3].getAttribute('aria-selected') === 'true'")
        settle()
        tight = evaluate("(() => { const box = e => e.getBoundingClientRect().toJSON(); const style = document.querySelector('.tablist').style; const cuts = () => ({start: parseFloat(style.getPropertyValue('--cut-start')), end: parseFloat(style.getPropertyValue('--cut-end'))}); return {list: box(document.querySelector('.tablist')), cuts: cuts(), selected: box(document.querySelector('.tab-name-button[aria-selected=true]').closest('.project-tab'))}; })()")
        print(json.dumps({"readings": records, "tight": tight}))
    finally:
        browser("close")
    sys.exit(0)

slide = r"""(() => {
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
 window.__u449Slide=ended.then(async()=>{await new Promise(requestAnimationFrame);return frames});
})()"""


def observe_slide(selector):
    evaluate(slide)
    if selector == ".drawer .close":
        browser("click", selector)
    else:
        # OpenButton explicitly uses pointer activation even when its Shelf is closed.
        evaluate(f"document.querySelector({json.dumps(selector)}).click()")
    return evaluate("window.__u449Slide")

try:
    browser("open", origin + "harness.html?seed=first-run")
    for width in (1280, 1440, 1600):
        browser("set", "viewport", str(width), "800")
        for scheme in ("light", "dark"):
            browser("set", "media", scheme)
            for seed in ("first-run", "agents-10", "tabs-8", "tree-40"):
                evaluate("localStorage.clear()")
                browser("open", origin + "harness.html?view=workstreams&items=1&tabs=1&renderer=dom&seed=" + seed)
                browser("wait", ".window-bar" if seed == "first-run" else ".strip")
                if seed != "first-run":
                    browser("wait", "--fn", "document.querySelector('.shelf').getBoundingClientRect().left < innerWidth")
                    browser("wait", ".rail [data-todo-root]")
                prefix = f"{seed}-{width}-{scheme}"
                capture(prefix + "-rest")
                if seed == "tree-40":
                    # Every Drawer keeps its top throughout opening and closing, with either Shelf state.
                    for shelf_open in (True, False):
                        # U467 retires the Work-order Drawer and Thread header; Todo and Pad survive.
                        for kind in ("Todo", "Pad"):
                            tab_selector = "#shelf-tab-pads" if kind == "Pad" else "#shelf-tab-todos"
                            evaluate("document.querySelector('.rail [data-todo-root]').click()")
                            if kind == "Pad":
                                evaluate("[...document.querySelectorAll('.shelf-tabs [role=tab]')].find(e=>e.textContent.startsWith('Pads') && e.getAttribute('aria-expanded') !== 'true')?.click()")
                                evaluate("document.querySelector('.shelf [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()")
                                browser("wait", ".shelf .pad-name")
                                selector = ".shelf [data-pad] .todo-open"
                            elif kind == "Todo":
                                evaluate("[...document.querySelectorAll('.shelf-tabs [role=tab]')].find(e=>e.textContent.startsWith('Todos') && e.getAttribute('aria-expanded') !== 'true')?.click()")
                                evaluate("document.querySelector('.shelf [data-shelf-group=unassigned][data-state=closed] [data-part=branch-control]')?.click()")
                                browser("wait", ".shelf .todo-row-button")
                                selector = ".shelf [data-todo] .todo-open"
                            frames = observe_slide(selector)
                            if not shelf_open:
                                # Closing the Shelf now unmounts its tabs and rows; keep the opened Drawer for this state.
                                evaluate(f"document.querySelector({json.dumps(tab_selector)}).click()")
                                browser("wait", ".window[data-shelf=closed]")
                            if kind == "Pad":
                                browser("wait", ".pad-body .ProseMirror")
                            opened = capture(prefix + f"-{kind}-{'open' if shelf_open else 'closed'}-shelf")
                            opened["opening"] = frames
                            opened["closing"] = observe_slide(".drawer .close")
                            if output and scheme == "dark":
                                directory = Path(output) / variant
                                (directory / (opened["case"] + ".geometry.json")).write_text(json.dumps(opened, separators=(",", ":")) + "\n")
                            if not shelf_open:
                                browser("press", "Meta+k")
                                browser("press", "b")
                                browser("wait", ".window[data-shelf=open]")
                    # Selection identifies the Workstream in the bar, independent of Shelf width.
                    evaluate("document.querySelector('[role=treeitem]').click()")
                    capture(prefix + "-selected")
                    evaluate("document.querySelector('.window').style.setProperty('--shelf-span','400px')")
                    capture(prefix + "-resized")
                    evaluate("document.querySelector('.shelf-tab[aria-expanded=true]').click()")
                    capture(prefix + "-closed")
                    browser("wait", '.rail [data-id="tokens"]')
                    evaluate("document.querySelector('.rail [data-id=\"tokens\"]').click()")
                    browser("wait", ".centre .pane-screen")
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
                    browser("hover", ".window-title")
                    browser("wait", "[role=tooltip][data-state=open]")
                    capture(prefix + "-overflow")
                    browser("hover", ".centre")
                    browser("press", "Tab")
                    evaluate("""(async()=>{
                      const list=document.querySelector('.tablist'),tab=list.querySelector('.tab-mark').closest('[role=tab]');
                      const left=Math.min(tab.closest('.project-tab').offsetLeft+20,list.scrollWidth-list.clientWidth);
                      if(list.scrollLeft!==left)await new Promise(resolve=>{list.addEventListener('scroll',resolve,{once:true});list.scrollLeft=left});
                      tab.focus({preventScroll:true});
                    })()""")
                    browser("wait", ".tab-tip[data-state=open]")
                    capture(prefix + "-tooltip")
                    evaluate("document.activeElement.blur();document.querySelector('.tablist').scrollLeft=0")
                    evaluate("const v=document.querySelector('.tablist').getBoundingClientRect(),end=document.querySelector('.strip-edge-right')?.getBoundingClientRect().left??v.right;const tab=[...document.querySelectorAll('.project-tab')].filter(e=>{const r=e.getBoundingClientRect();return Math.min(r.right,end)-Math.max(r.left,v.left)>16}).at(-1);const r=tab.getBoundingClientRect();tab.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:Math.min(r.right,end)-8,clientY:24}))")
                    browser("wait", "--fn", "window.__fake.app.menuResolve !== null")
                    capture(prefix + "-menu")
                    evaluate("window.__fake.app.closeMenu()")
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
