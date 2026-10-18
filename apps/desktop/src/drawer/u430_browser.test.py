"""U430 rendered observer. Start head/base harnesses, then pass their ports and head/base variant.

python3 apps/desktop/src/drawer/u430_browser.test.py 5199 head
Add --baseline to record main without asserting the overturned layout law.
Only a new headless agent-browser session is created and closed.
"""
import argparse
import json
from pathlib import Path
import subprocess


def capture_output(variant):
    if variant not in ("head", "base"):
        raise ValueError("capture variant must be head or base")
    desktop = Path(__file__).resolve().parents[2]
    helper = (desktop / "src/testing/captures.ts").as_uri()
    result = subprocess.run(
        ["node", "--experimental-strip-types", "--input-type=module", "-e",
         f'import {{ captureDir }} from {json.dumps(helper)}; console.log(JSON.stringify(captureDir("U430")));'],
        cwd=desktop, text=True, capture_output=True, check=True, timeout=10)
    directory = json.loads(result.stdout)
    return Path(directory) / variant if directory is not None else None


def capture(output, name, text=None):
    if output is None:
        return
    output.mkdir(parents=True, exist_ok=True)
    if text is None:
        browser("screenshot", str(output / name))
    else:
        (output / name).write_text(text)


def browser(*args, script=None):
    result = subprocess.run(["agent-browser", "--session", session, "--json", *args],
                            input=script, text=True, capture_output=True, timeout=30)
    if not result.stdout:
        raise RuntimeError(result.stderr)
    answer = json.loads(result.stdout)
    if not answer["success"]:
        raise RuntimeError(answer)
    return answer["data"]


observer = r"""
(async () => {
  const panel = document.querySelector('.drawer');
  const centre = document.querySelector('.centre');
  const box = element => {const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
  const slide = async button => {
    const frames = [];
    let done = false;
    const ended = new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>reject(new Error('Drawer transition did not end')),3000);
      panel.addEventListener('transitionend',function end(e){
        if(e.target!==panel || e.propertyName!=='transform')return;
        panel.removeEventListener('transitionend',end);clearTimeout(timeout);done=true;resolve();
      });
    });
    // Read on every rAF until the application's own transitionend.
    const sample = () => { const d=box(panel),c=box(centre); frames.push({drawer:d,centre:c,gap:Math.round(d.left-c.right),rawGap:d.left-c.right}); if(!done)requestAnimationFrame(sample); };
    requestAnimationFrame(sample);button.click();await ended;
    await new Promise(requestAnimationFrame);
    return frames;
  };
  const button = SEED === 'thread-report' ? document.querySelector('.thread-header button') : [...document.querySelectorAll('.shelf button')].find(b=>b.textContent.includes('todo 1'));
  const frames = await slide(button);
  window.__u430Slide = slide;
  // PadRichEditor mounts asynchronously; measure its rendered body, not its loading shell.
  if(panel.querySelector('.pad-body') && !panel.querySelector('.ProseMirror h1')) {
    await new Promise((resolve,reject) => {
      const ready=new MutationObserver(() => {
        if(!panel.querySelector('.ProseMirror h1'))return;
        ready.disconnect();clearTimeout(timeout);resolve();
      });
      const timeout=setTimeout(() => {ready.disconnect();reject(new Error('Pad body did not render'));},10000);
      ready.observe(panel,{childList:true,subtree:true});
    });
  }
  const opened = {drawer:box(panel),centre:box(centre)};
  let input = null;
  if(SEED === 'thread-report') {
    const textarea=document.querySelector('.thread-composer textarea');
    const value='x'.repeat(300);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,value);
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(requestAnimationFrame);
    const controls=[...document.querySelectorAll('.thread-composer textarea,.thread-composer button,.thread-header button')].map(element=>({name:element.getAttribute('aria-label')||element.textContent,box:box(element),reachable:element.contains(document.elementFromPoint((box(element).left+box(element).right)/2,(box(element).top+box(element).bottom)/2))}));
    input={length:textarea.value.length,controls,clientWidth:textarea.clientWidth,scrollWidth:textarea.scrollWidth,scrollHeight:textarea.scrollHeight,lineHeight:parseFloat(getComputedStyle(textarea).lineHeight)};
    textarea.focus();
    if(panel.dataset.open!=='true')throw new Error('centre input closed the Drawer');
  }
  const terminal=SEED==='tree-40' ? box(document.querySelector('.pane-screen')) : null;
  const strip=document.querySelector('.resource-strip');
  const walker=document.createTreeWalker(strip,NodeFilter.SHOW_TEXT);
  const fragments=[];
  while(walker.nextNode()) {
    if(!walker.currentNode.textContent.trim())continue;
    const range=document.createRange();range.selectNodeContents(walker.currentNode);
    for(const r of range.getClientRects())fragments.push({text:walker.currentNode.textContent,left:r.left,right:r.right});
  }
  const resources={box:box(strip),fragments};
  const checks=window.__checks();
  window.__u430={opened,input,checks};
  return {opened,input,terminal,resources,checks,frames};
})()
"""


def u430_input_is_never_under_the_drawer(result):
    data = result["input"]
    assert data["length"] == 300
    assert data["scrollWidth"] <= data["clientWidth"], "composer scrolls sideways"
    assert data["scrollHeight"] > data["lineHeight"] * 2, "300 characters did not wrap"
    centre = result["opened"]["centre"]
    drawer = result["opened"]["drawer"]
    for control in data["controls"]:
        rect = control["box"]
        assert rect["width"] > 0 and rect["height"] > 0 and control["reachable"], control
        assert rect["left"] >= centre["left"] and rect["right"] <= centre["right"], control
        assert rect["right"] <= drawer["left"] and rect["bottom"] <= 820, control


def u430_resource_text_stays_inside_the_narrowed_centre(result):
    resources = result["resources"]
    assert resources["fragments"], "resource meter has no rendered text"
    for fragment in resources["fragments"]:
        assert fragment["left"] >= resources["box"]["left"], fragment
        assert fragment["right"] <= resources["box"]["right"], fragment


def u430_centre_ends_where_the_drawer_begins(port, output, baseline):
    rows = []
    for width in (1280, 1440):
        for rail, shelf in ((288, 320), (480, 560)):
            for kind in ("Todo", "Pad"):
                for seed in ("thread-report", "tree-40"):
                    browser("set", "viewport", str(width), "800")
                    browser("open", f"http://localhost:{port}/harness.html?seed=tree-40")
                    browser("wait", ".centre")
                    browser("eval", "localStorage.clear(); localStorage.setItem('roundup:widths:/Users/you/harness', " +
                            json.dumps(json.dumps({"rail": rail, "shelf": shelf})) + ");")
                    browser("reload")
                    browser("wait", ".centre")
                    if seed == "tree-40":
                        browser("eval", "[...document.querySelectorAll('[role=treeitem]')].find(e=>e.textContent.includes('token-rotation')).click()")
                        browser("wait", ".pane-control button")
                        browser("eval", "document.querySelector('.pane-control button').click()")
                        browser("wait", ".pane-control[data-state=controlled]")
                    else:
                        browser("eval", "[...document.querySelectorAll('[role=treeitem]')].find(e=>e.textContent.includes('payments workstream')).click()")
                        browser("wait", ".thread-composer textarea")
                    if seed == "thread-report":
                        browser("wait", ".shelf button[aria-pressed]")
                        browser("eval", "[...document.querySelectorAll('.shelf button')].find(e=>e.textContent==='all').click()")
                    if kind == "Pad":
                        browser("eval", "[...document.querySelectorAll('.shelf-tabs [role=tab]')].find(e=>e.textContent.includes('Pads')).click()")
                        browser("wait", ".shelf .pad-name")
                    browser("wait", ".shelf .pad-name" if kind == "Pad" else ".shelf .todo-row-button")
                    script = observer.replace("SEED", json.dumps(seed))
                    script = script.replace("document.querySelector('.thread-header button')", "[...document.querySelectorAll('.shelf button')].find(b=>b.textContent.includes('todo 1'))")
                    if kind == "Pad":
                        script = script.replace("[...document.querySelectorAll('.shelf button')].find(b=>b.textContent.includes('todo 1'))", "document.querySelector('.shelf .pad-name')")
                    else:
                        script = script.replace("[...document.querySelectorAll('.shelf button')].find(b=>b.textContent.includes('todo 1'))", "document.querySelector('.shelf .todo-row-button')")
                    result = browser("eval", "--stdin", script=script)["result"]
                    row = {"viewport": [width, 800], "stored": [rail, shelf], "kind": kind, "seed": "tree-40", "centreKind": "composer" if seed == "thread-report" else "Terminal", **result}
                    rows.append(row)
                    capture(output, f"{width}-{rail}-{shelf}-{kind}-{seed}.png")
                    capture(output, f"{width}-{rail}-{shelf}-{kind}-{seed}.checks.json", "{\n" + ",\n".join(json.dumps(key) + ": " + json.dumps(value) for key, value in result["checks"].items()) + "\n}\n")
                    capture(output, "supported-width-boxes.json", "[\n" + ",\n".join(json.dumps(row) for row in rows) + "\n]\n")
                    if not baseline:
                        u430_resource_text_stays_inside_the_narrowed_centre(result)
                        centre, drawer = result["opened"]["centre"], result["opened"]["drawer"]
                        assert centre["left"] == rail and centre["right"] == drawer["left"], row
                        if seed == "tree-40":
                            assert result["terminal"]["right"] <= drawer["left"], row
                        else:
                            u430_input_is_never_under_the_drawer(result)
                        assert all(abs(f["rawGap"]) <= 1/64 + 0.0001 for f in result["frames"]), row
                    closing = browser("eval", "(async()=>await window.__u430Slide(document.querySelector('.drawer .close')))()")["result"]
                    row["closing"] = closing
                    capture(output, "supported-width-boxes.json", "[\n" + ",\n".join(json.dumps(row) for row in rows) + "\n]\n")
                    if not baseline:
                        assert all(abs(f["rawGap"]) <= 1/64 + 0.0001 for f in closing), closing


def main():
    global session
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port")
    parser.add_argument("variant", choices=("head", "base"), nargs="?", default="head")
    parser.add_argument("--baseline", action="store_true")
    args = parser.parse_args()
    port, baseline = args.port, args.baseline
    output = capture_output(args.variant)
    session = "builder-38295089533-u430-" + port
    try:
        browser("set", "viewport", "1280", "820")
        for seed in ["thread-report", "tree-40"]:
            browser("open", f"http://localhost:{port}/harness.html?seed={seed}")
            browser("wait", ".centre")
            if seed == "tree-40":
                browser("eval", "[...document.querySelectorAll('[role=treeitem]')].find(e=>e.textContent.includes('token-rotation')).click()")
                browser("wait", ".pane-control button")
                browser("eval", "document.querySelector('.pane-control button').click()")
                browser("wait", ".pane-control[data-state=controlled]")
            result = browser("eval", "--stdin", script=observer.replace("SEED", json.dumps(seed)))["result"]
            capture(output, f"{seed}-frames.json", "[\n" + ",\n".join(json.dumps(frame) for frame in result["frames"]) + "\n]" + "\n")
            capture(output, f"{seed}.checks.json", json.dumps(result["checks"], indent=2) + "\n")
            capture(output, f"{seed}-boxes.json", json.dumps({k:v for k,v in result.items() if k != "frames"}, indent=2) + "\n")
            capture(output, f"{seed}.png")
            if not baseline:
                assert result["opened"]["centre"]["right"] == result["opened"]["drawer"]["left"]
                assert len(result["frames"]) >= 4
                # Layout uses 1/64 CSS-pixel units; transformed edges retain floats.
                # Preserve raw values and assert equality at the layout engine's precision.
                assert all(frame["gap"] == 0 and abs(frame["rawGap"]) <= 1/64 + 0.0001 for frame in result["frames"]), result["frames"]
                if seed == "tree-40":
                    assert result["terminal"]["right"] <= result["opened"]["drawer"]["left"]
                if seed == "thread-report":
                    u430_input_is_never_under_the_drawer(result)
            if seed == "tree-40":
                browser("eval", "window.__fake.failNext(-32003, 'Todo update failed'); [...document.querySelectorAll('.drawer button')].find(b=>b.textContent==='complete').click()")
                browser("wait", ".drawer [role=alert]")
                failure = browser("eval", "({checks:window.__checks(), text:document.querySelector('.drawer').textContent})")["result"]
                assert "Todo update failed" in failure["text"]
                capture(output, "tree-40-failure.checks.json", json.dumps(failure["checks"], indent=2)+"\n")
                capture(output, "tree-40-failure.png")
            # Capture closing too, bounded by the Drawer's own transform transition.
            closing = browser("eval", "(async()=>await window.__u430Slide(document.querySelector('.drawer .close')))()")["result"]
            capture(output, f"{seed}-close-frames.json", "[\n" + ",\n".join(json.dumps(frame) for frame in closing) + "\n]"+"\n")
            if not baseline:
                assert len(closing) >= 4 and all(f["gap"] == 0 and abs(f["rawGap"]) <= 1/64 + 0.0001 for f in closing), closing
        u430_centre_ends_where_the_drawer_begins(port, output, baseline)
        print("U430 browser assertions passed" if not baseline else "U430 main observation recorded")
    finally:
        browser("close")


if __name__ == "__main__":
    main()
