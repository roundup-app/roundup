#!/usr/bin/env python3
"""U3800d Observer: 10 Rail moves on tree-40 at 1512x950 dark in headless Chromium, a CDP trace each.

usage: observe.py <label> <port> <out.json>   (needs `just harness tree-40 <port>` on the checkout to measure)
Per drop, `moved to` the first Workstream by the Move to... picker: the longest main-thread task from the choice
to 400 ms after it, and the delay from a press 20 ms after it to its next paint.
"""
import json, subprocess, sys, tempfile, time, os

label, port, out = sys.argv[1], sys.argv[2], sys.argv[3]
S = f"u3800d-{label}"

def ab(*a):
    r = subprocess.run(["agent-browser", "--session", S, *a], capture_output=True, text=True)
    return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""

def ev(js):
    return ab("eval", js)

ab("set", "viewport", "1512", "950")
ab("set", "media", "dark")
ab("open", f"http://localhost:{port}/harness.html?seed=tree-40")
time.sleep(4)

PROBE = """(() => { const o = document.querySelector('[role=option]'); window.__u = {t0: performance.now()};
  o.click(); const due = performance.now() + 20;
  setTimeout(() => { const ran = performance.now(); requestAnimationFrame(() => { window.__u.press = performance.now() - due; window.__u.ran = ran - due; }); }, 20); return 1; })()"""

def longest(events, click):
    t_click_us = click["ts"]
    tasks = [e for e in events if e.get("name") == "ThreadControllerImpl::RunTask" and e.get("ph") == "X" and e.get("dur") is not None
             and e.get("pid") == click["pid"] and e.get("tid") == click["tid"]]
    # the click's own task and the ones after, to 400 ms after it
    return max((e["dur"] / 1000 for e in tasks if t_click_us - 1 <= e["ts"] + e["dur"] and e["ts"] <= t_click_us + 400_000 and e["ts"] + e["dur"] >= t_click_us), default=0)

drops = []
for i in range(1, 11):
    ids = json.loads(json.loads(ev('JSON.stringify([...document.querySelectorAll("[role=treeitem][aria-level=\\"2\\"]")].map(e=>e.dataset.id).filter(id=>id&&id.startsWith("agent-")))')))
    if not ids:
        break
    ev(f'document.querySelector(\'[role=treeitem][data-id="{ids[0]}"]\').focus();1')
    ab("press", "m")
    time.sleep(0.4)
    path = os.path.join(tempfile.mkdtemp(), "trace.json")
    ab("trace", "start")
    time.sleep(0.3)
    ev(PROBE)
    time.sleep(0.8)
    ab("trace", "stop", path)
    res = json.loads(json.loads(ev("JSON.stringify(window.__u)")))
    events = json.load(open(path))
    events = events["traceEvents"] if isinstance(events, dict) else events
    clicks = [e for e in events if e.get("name") == "EventDispatch" and e.get("args", {}).get("data", {}).get("type") == "click"]
    drops.append({"drop": i, "moved": ids[0], "longest_task_ms": round(longest(events, clicks[-1])), "press_to_next_paint_ms": round(res.get("press", -1), 1)})
    ab("press", "Escape")

ms = sorted(d["longest_task_ms"] for d in drops)
json.dump({"label": label, "chromium": "headless", "viewport": "1512x950 dark", "seed": "tree-40", "drops": drops,
           "median_longest_task_ms": ms[len(ms) // 2] if ms else None, "max_longest_task_ms": ms[-1] if ms else None}, open(out, "w"), indent=2)
print(json.dumps(drops))
