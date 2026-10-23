"""U3799/U3805: Settings on the dense seed and first run, isolated headless agent-browser."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

origin, target = sys.argv[1:3]
session = 'u3799-' + uuid.uuid4().hex
profile = tempfile.TemporaryDirectory(prefix='u3799-profile-')
root = Path(target).parent


def browser(*args):
    if args[0] == 'open' and len(args) > 1:
        browser('open')
        return browser('eval', 'requestAnimationFrame(()=>location.assign(%s)); true' % json.dumps(args[1]))
    result = subprocess.run(['agent-browser', '--session', session, '--profile', profile.name,
                             '--args', '--no-sandbox', '--json', *args], text=True, capture_output=True, timeout=45)
    if not result.stdout:
        raise RuntimeError(result.stderr)
    reply = json.loads(result.stdout)
    if not reply['success']:
        raise RuntimeError(reply)
    return reply['data']


def evaluate(script):
    return browser('eval', script)['result']


def capture(id, step):
    directory = root / id
    directory.mkdir(parents=True, exist_ok=True)
    checks = evaluate('window.__checks()')
    browser('screenshot', str(directory / (step + '.png')))
    (directory / (step + '.checks.json')).write_text(json.dumps(checks, ensure_ascii=False) + '\n')


try:
    browser('open', origin + '/harness.html?seed=tree-40')
    browser('set', 'viewport', '1512', '950')
    browser('set', 'media', 'dark')
    browser('wait', '--fn', 'Boolean(window.__fake && document.querySelector(".rail-row"))')
    capture('U3799', 'before')
    evaluate('window.dispatchEvent(new Event("open-app-settings"))')
    browser('wait', '--fn', 'Boolean(document.querySelector(".settings-view"))')
    capture('U3799', 'settings')
    # The rejected field remains visible on the densest seed.
    evaluate('''(() => { const f=document.querySelector('input[aria-label="Font size"]'); f.value='300'; f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})); })()''')
    browser('wait', '--fn', 'document.querySelector(".settings-view").textContent.includes("Choose a font size")')
    capture('U3799', 'refusal')
    # Explicit Light is observed once while the host remains in dark mode.
    evaluate('document.querySelector("[aria-label=Mode][role=combobox]").click()')
    browser('wait', '--fn', 'Boolean(document.querySelector("[role=option][data-value=light]"))')
    evaluate('document.querySelector("[role=option][data-value=light]").click()')
    browser('wait', '--fn', 'document.documentElement.style.colorScheme==="light"')
    capture('U3805', 'light-on-dark-host')
    evaluate('document.querySelector("[aria-label=Mode][role=combobox]").click()')
    browser('wait', '--fn', 'Boolean(document.querySelector("[role=option][data-value=system]"))')
    evaluate('document.querySelector("[role=option][data-value=system]").click()')
    browser('wait', '--fn', 'document.documentElement.dataset.mode==="system"')
    capture('U3805', 'system-dark')
    browser('open', origin + '/harness.html?seed=first-run')
    browser('set', 'viewport', '1512', '950')
    browser('set', 'media', 'dark')
    browser('wait', '--fn', 'Boolean(window.__fake && document.querySelector(".settings-center"))')
    evaluate('window.dispatchEvent(new Event("open-app-settings"))')
    browser('wait', '--fn', 'Boolean(document.querySelector(".settings-view"))')
    capture('U3799', 'first-run')
    print('ok')
finally:
    browser('close')
    profile.cleanup()
