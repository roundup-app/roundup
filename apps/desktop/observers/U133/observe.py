"""Paired U131/U133 observations in isolated headless agent-browser profiles."""
import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--browser", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--base", default="http://127.0.0.1:5200")
parser.add_argument("--head", default="http://127.0.0.1:5199")
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)

SETTLE = """(async () => {
  await new Promise(requestAnimationFrame);
  await Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  await new Promise(requestAnimationFrame);
  return true;
})()"""
STYLE = """el => {
 const s = getComputedStyle(el);
 return {color:s.color, opacity:s.opacity, transform:s.transform, background:s.backgroundColor, image:s.backgroundImage,
 outline:s.outline, shadow:s.boxShadow, weight:s.fontWeight, radius:s.borderRadius, box:el.getBoundingClientRect().toJSON()};
}"""


def observe(side, origin):
    directory = output / side
    directory.mkdir(parents=True, exist_ok=True)
    profile = tempfile.mkdtemp(prefix="u133-observer-")
    session = f"builder-40214203543-{side}"

    def browser(*command):
        reply = subprocess.run([args.browser, "--session", session, "--json", *command], capture_output=True, text=True, timeout=45, check=True)
        data = json.loads(reply.stdout)
        if not data.get("success"):
            raise RuntimeError(data)
        return data.get("data", {}).get("result")

    def evaluate(code):
        return browser("eval", code)

    def wait(code):
        browser("wait", "--fn", code)

    def load(path):
        browser("open", origin + path)
        wait("!!document.querySelector('[data-away]')" if "u133.html" in path else "!!window.__fake && !!window.__checks && !!document.querySelector('button')")
        evaluate(SETTLE)

    def capture(name):
        evaluate(SETTLE)
        browser("screenshot", str(directory / f"{name}.png"))
        checks = evaluate("window.__checks()")
        (directory / f"{name}.checks.json").write_text(json.dumps(checks, indent=2) + "\n")
        states = evaluate(f"""(() => {{ const style={STYLE}; return [...document.querySelectorAll('.rail-row,.shelf-row,.terminal-tab-pair')].filter(e=>e.getBoundingClientRect().width).map(e=>({{id:e.dataset.id??e.dataset.bubble,selected:e.dataset.selected,dragged:e.dataset.dndDragging,focused:e.matches(':focus-visible,:has(:focus-visible)'),style:style(e)}})); }})()""")
        (directory / f"{name}.states.json").write_text(json.dumps(states, indent=2) + "\n")
        print(side, name, {key: value["status"] for key, value in checks.items() if value["status"] != "pass"}, flush=True)

    def todos():
        load("/harness.html?seed=tree-40")
        evaluate("document.querySelector('[data-todo-root]').click(); for(const t of document.querySelectorAll('[role=tab]'))if(t.textContent.startsWith('Todos')&&t.getAttribute('aria-expanded')!=='true')t.click();")
        wait("!!document.querySelector('.shelf [data-shelf-group]')")
        evaluate("for(const e of document.querySelectorAll('.shelf [data-shelf-group] [data-part=branch-control]'))if(e.closest('[role=treeitem]')?.getAttribute('aria-expanded')==='false')e.click();")
        wait("!!document.querySelector('.shelf .todo-row[data-todo] .shelf-title')")
        evaluate(SETTLE)

    def press(name, selector, key=None, opening=None):
        load("/src/ui/u133.html")
        if opening:
            browser("click", opening)
        wait(f"!!document.querySelector({json.dumps(selector)})")
        browser("focus", selector)
        evaluate(SETTLE)
        point = evaluate(f"""(() => {{ const el=document.querySelector({json.dumps(selector)}); const b=el.getBoundingClientRect(); const owner=el.matches('input')?el.closest('.app-checkbox,.app-radio,.app-segment')??el:el;
          const style={STYLE}; window.__pressFrames={{before:style(owner)}};
          window.addEventListener({json.dumps('keydown' if key else 'pointerdown')},()=>requestAnimationFrame(()=>{{window.__pressFrames.first=style(owner);window.__pressFrames.connected=owner.isConnected;}}),{{once:true,capture:true}});
          return {{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}}; }})()""")
        if key:
            browser("keydown", key)
        else:
            browser("mouse", "move", str(point["x"]), str(point["y"]))
            browser("mouse", "down")
        wait("!!window.__pressFrames.first")
        frames = evaluate("window.__pressFrames")
        browser("screenshot", str(directory / f"press-{name}.png"))
        if key:
            browser("keyup", key)
        else:
            browser("mouse", "up")
        evaluate(SETTLE)
        frames["released"] = evaluate(f"({STYLE})(document.querySelector({json.dumps(selector)}).closest('.app-checkbox,.app-radio,.app-segment')??document.querySelector({json.dumps(selector)}))")
        frames["changed"] = [field for field in ("color", "opacity", "transform") if frames["before"][field] != frames["first"][field]]
        (directory / f"press-{name}.frames.json").write_text(json.dumps(frames, indent=2) + "\n")
        print(side, "press", name, frames["changed"], flush=True)

    try:
        browser("--profile", profile, "open", origin + "/src/ui/u133.html")
        browser("set", "viewport", "1512", "950")
        browser("set", "media", "dark")
        evaluate("localStorage.clear()")
        for seed in ("first-run", "agents-10", "tree-40", "daemon-exits", "conflict"):
            load(f"/harness.html?seed={seed}")
            capture(seed)
        todos()
        capture("dense-todos")
        browser("press", "Tab")
        browser("focus", ".shelf .todo-row[data-todo] .todo-row-button")
        capture("todo-focused")
        browser("click", ".shelf .todo-row[data-todo] .todo-row-button")
        capture("todo-selected")
        evaluate("window.__fake.failNext(-32003,'Offline. Reconnect.'); document.querySelector('.shelf input.todo-tick').click()")
        wait("document.body.textContent.includes('Offline. Reconnect.')")
        capture("dense-failure")
        todos()
        browser("focus", ".shelf .todo-row[data-todo] .todo-row-button")
        browser("press", "o")
        wait("!!document.querySelector('[role=menu]')")
        capture("todo-menu")
        browser("press", "Escape")
        evaluate("for(const t of document.querySelectorAll('[role=tab]'))if(t.textContent.startsWith('Pads')&&t.getAttribute('aria-expanded')!=='true')t.click();")
        wait("!!document.querySelector('.shelf .pad-name')")
        capture("pads")
        browser("press", "Tab")
        browser("focus", ".shelf .pad-name")
        capture("pad-focused")
        browser("click", ".shelf .pad-name")
        capture("pad-selected")
        load("/harness.html?seed=agents-10")
        browser("press", "Tab")
        browser("focus", ".rail-row[data-id=agent-3]")
        capture("rail-focused")
        browser("click", ".rail-row[data-id=agent-3] .name")
        capture("rail-selected")
        point = evaluate("(()=>{const b=document.querySelector('.rail-row[data-id=agent-3] .name').getBoundingClientRect();return {x:Math.round(b.x+10),y:Math.round(b.y+b.height/2)};})()")
        browser("record", "start", str(directory / "rail-drag.webm"))
        browser("mouse", "move", str(point["x"]), str(point["y"]))
        browser("mouse", "down")
        for distance in (5, 15, 35):
            browser("mouse", "move", str(point["x"] + distance), str(point["y"] + distance))
        capture("rail-dragged")
        browser("mouse", "up")
        browser("record", "stop")
        load("/harness.html?seed=bubbles")
        wait("!!document.querySelector('button.terminal-tab')")
        capture("terminal-tabs")
        browser("click", "button.terminal-tab")
        capture("terminal-open")
        for name, selector in (
            ("button", "[data-control=Button] button"), ("toggle", "[data-control=Toggle] button"),
            ("checkbox", "[data-control=Checkbox] input"), ("switch", "[data-control=Switch] input"),
            ("radio", ".app-radio input[value=second]"), ("segment", ".app-segment input[value=second]"),
            ("tab", "[data-control=Tab] button[data-value=second]"),
            ("primary", "[aria-label='Filled controls'] [data-button=primary]"),
            ("neutral", "[aria-label='Filled controls'] [data-button=quiet]"),
            ("menu-trigger", "[data-scope=menu][data-part=trigger]"),
            ("select-trigger", ".app-select-trigger"),
            ("disclosure", ".disclosure-trigger"), ("link", "a"), ("summary", "summary"),
        ):
            press(name + "-pointer", selector)
            press(name + "-key", selector, " " if name in ("checkbox", "switch", "radio", "segment") else "Enter")
        press("menu-item-pointer", "[role=menuitem]", opening="[data-scope=menu][data-part=trigger]")
        press("select-option-pointer", ".app-select-item:last-child", opening=".app-select-trigger")
        load("/src/ui/u133.html")
        browser("click", "[data-scope=menu][data-part=trigger]")
        capture("floating-menu")
    finally:
        browser("close")
        shutil.rmtree(profile, ignore_errors=True)


for side, origin in (("base", args.base), ("head", args.head)):
    observe(side, origin)
