"""U430 rendered observer. Start head/base harnesses, then pass their ports and capture directory.

python3 apps/desktop/src/drawer/u430_browser.test.py 5199 artifacts/ux/U430/head
Add --baseline to record main without asserting the overturned layout law.
Only a new headless agent-browser session is created and closed.
"""
import json
from pathlib import Path
import subprocess
import sys

port, directory = sys.argv[1:3]
baseline = "--baseline" in sys.argv[3:]
output = Path(directory).resolve()
output.mkdir(parents=True, exist_ok=True)
session = "builder-38275662685-u430-" + port


def browser(*args, script=None):
    result = subprocess.run(["agent-browser", "--session", session, "--json", *args],
                            input=script, text=True, capture_output=True, check=True)
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
  const opened = {drawer:box(panel),centre:box(centre)};
  let input = null;
  if(SEED === 'thread-report') {
    const textarea=document.querySelector('.thread-composer textarea');
    const value='x'.repeat(300);
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,value);
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(requestAnimationFrame);
    const controls=[...document.querySelectorAll('.thread-composer textarea,.thread-composer button,.thread-header button')].map(element=>({name:element.getAttribute('aria-label')||element.textContent,box:box(element)}));
    input={length:textarea.value.length,controls,clientWidth:textarea.clientWidth,scrollWidth:textarea.scrollWidth,scrollHeight:textarea.scrollHeight,lineHeight:parseFloat(getComputedStyle(textarea).lineHeight)};
    textarea.focus();
    if(panel.dataset.open!=='true')throw new Error('centre input closed the Drawer');
  }
  const terminal=SEED==='tree-40' ? box(document.querySelector('.pane-screen')) : null;
  const checks=window.__checks();
  window.__u430={opened,input,checks};
  return {opened,input,terminal,checks,frames};
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
        assert rect["width"] > 0 and rect["height"] > 0, control
        assert rect["left"] >= centre["left"] and rect["right"] <= centre["right"], control
        assert rect["right"] <= drawer["left"] and rect["bottom"] <= 820, control


try:
    browser("set", "viewport", "1280", "820")
    for seed in ["thread-report", "tree-40"]:
        browser("open", f"http://localhost:{port}/harness.html?seed={seed}")
        browser("wait", ".centre")
        if seed == "tree-40":
            browser("eval", "[...document.querySelectorAll('[role=treeitem]')].find(e=>e.textContent.includes('token-rotation')).click()")
            browser("wait", ".pane-watch button")
            browser("eval", "document.querySelector('.pane-watch button').click()")
            browser("wait", ".pane-takeover")
        result = browser("eval", "--stdin", script=observer.replace("SEED", json.dumps(seed)))["result"]
        (output / f"{seed}-frames.json").write_text("[\n" + ",\n".join(json.dumps(frame) for frame in result["frames"]) + "\n]" + "\n")
        (output / f"{seed}.checks.json").write_text(json.dumps(result["checks"], indent=2) + "\n")
        (output / f"{seed}-boxes.json").write_text(json.dumps({k:v for k,v in result.items() if k != "frames"}, indent=2) + "\n")
        browser("screenshot", str(output / f"{seed}.png"))
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
            (output / "tree-40-failure.checks.json").write_text(json.dumps(failure["checks"], indent=2)+"\n")
            browser("screenshot", str(output / "tree-40-failure.png"))
        # Capture closing too, bounded by the Drawer's own transform transition.
        closing = browser("eval", "(async()=>await window.__u430Slide(document.querySelector('.drawer .close')))()")["result"]
        (output / f"{seed}-close-frames.json").write_text("[\n" + ",\n".join(json.dumps(frame) for frame in closing) + "\n]"+"\n")
        if not baseline:
            assert len(closing) >= 4 and all(f["gap"] == 0 and abs(f["rawGap"]) <= 1/64 + 0.0001 for f in closing), closing
    print("U430 browser assertions passed" if not baseline else "U430 main observation recorded")
finally:
    browser("close")
