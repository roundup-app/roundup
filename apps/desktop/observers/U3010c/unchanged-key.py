"""Run U4231 in a dedicated headless agent-browser session against just harness tree-40."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'artifacts/ux/U3010c/unchanged-key'
OUT.mkdir(parents=True, exist_ok=True)
SESSION = 'u4231-capture'
os.environ.setdefault('AGENT_BROWSER_EXECUTABLE_PATH', '/usr/bin/chromium')


def browser(*args, source=None):
    result = subprocess.run(['agent-browser', '--session', SESSION, '--json', *[str(round(arg)) if isinstance(arg, float) else str(arg) for arg in args]], input=source, text=True, capture_output=True, check=True)
    reply = json.loads(result.stdout)
    if not reply['success']:
        raise RuntimeError(reply)
    return reply.get('data', {}).get('result')


def evaluate(source):
    return browser('eval', '--stdin', source=source)


def setup(list_name, quarter=False, reduced=False):
    browser('set', 'media', 'dark', *(['reduced-motion'] if reduced else []))
    browser('open', os.environ.get('ROUNDUP_HARNESS_URL', 'http://localhost:5199') + '/harness.html?seed=tree-40')
    browser('set', 'viewport', 1512, 950)
    browser('wait', '--fn', 'Boolean(window.__fake && document.querySelector(".rail-pads-control"))')
    evaluate('window.__u4231Options=' + json.dumps({'list': list_name, 'quarter': quarter}))
    evaluate((Path(__file__).parent / 'keyboard-reorder.eval').read_text())


def save(name, trace):
    (OUT / (name + '-frames.json')).write_text(json.dumps(trace, separators=(',', ':')) + '\n')
    failures = {key: value for key, value in trace['checks'].items() if value['status'] != 'pass'}
    print(name, 'frames=', len(trace['samples']), 'checks=', failures, flush=True)


def pointer():
    evaluate('window.__unchangedKey.boundaries.push({event:"pointer", ...window.__unchangedKey.read("before-pointer")})')
    start = evaluate('window.__unchangedKey.point(2)')
    browser('mouse', 'move', start['x'], start['y'])
    browser('mouse', 'down')
    browser('mouse', 'move', start['x'], start['y'] - 6)
    end = evaluate('window.__unchangedKey.point(0)')
    for step in range(1, 9):
        browser('mouse', 'move', start['x'] + (end['x'] - start['x']) * step / 8, start['y'] - 6 + (end['y'] - start['y'] + 6) * step / 8)
    evaluate('window.__unchangedKey.boundaries.push({event:"drop", ...window.__unchangedKey.read("before-drop")})')
    browser('mouse', 'up')
    browser('wait', '--fn', 'window.__fake.app.calls.filter(call=>call.method==="todo.reorder").length === window.__expectedCalls')


if __name__ == "__main__":
    try:
        for list_name in ['shelf', 'agent']:
            for reduced, quarter in [(False, False), (False, True), (True, False)]:
                for mode in ['fresh', 'none', 'equal']:
                    for action in ['incoming', 'pointer']:
                        setup(list_name, quarter, reduced)
                        if mode != 'fresh':
                            evaluate('window.__unchangedKey.key(' + json.dumps(mode) + ')')
                        else:
                            evaluate('window.__unchangedKey.rows()[1].focus()')
                        if action == 'incoming':
                            evaluate('window.__unchangedKey.incoming()')
                        else:
                            evaluate('window.__expectedCalls=' + str(1 if mode == 'fresh' else 2))
                            pointer()
                        trace = evaluate('window.__unchangedKey.finish()')
                        if reduced:
                            browser('set', 'media', 'dark')
                            trace['afterPreferenceOff'] = evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(window.__unchangedKey.read("preference-off")))))')
                        name = f'{list_name}-{mode}-{action}-' + ('reduced' if reduced else 'quarter' if quarter else 'normal')
                        save(name, trace)
                        if mode == 'none' and action == 'incoming':
                            browser('screenshot', OUT / (name + '.png'))
            setup(list_name)
            evaluate('window.__unchangedKey.key("delayed")')
            save(list_name + '-delayed-key', evaluate('window.__unchangedKey.finish()'))
            setup(list_name)
            evaluate('window.__fake.failNext(-32003, "no room"); window.__unchangedKey.rows()[0].focus()')
            browser('press', 'Alt+ArrowDown')
            browser('wait', '--fn', 'Boolean(document.querySelector("[role=alert]"))')
            save(list_name + '-refused', evaluate('window.__unchangedKey.finish()'))
            browser('screenshot', OUT / (list_name + '-refused.png'))
    finally:
        browser('close')
