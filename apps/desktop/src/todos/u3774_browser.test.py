"""U3774, U3775, U3796: the Drawer's thread with an Agent comment of three status lines on tree-40, dark, 1512x950; dedicated headless agent-browser, fresh profile."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

origin, target = sys.argv[1:3]
session = 'u3774-' + uuid.uuid4().hex
profile = tempfile.TemporaryDirectory(prefix='u3774-profile-')


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


setup = r"""(async () => {
  const f=window.__fake;
  f.actAs({kind:'agent',id:'tokens',parent:null});
  const body=[1,2,3].map(n=>'::status Step '+n+': ran\n  detail '+n+' line a\n  detail '+n+' line b').join('\n');
  await f.app.rpc('todo.comment',{id:5,body});
  f.actAs({kind:'user',id:'you',parent:null});
})()"""

try:
    browser('open', origin + '/harness.html?seed=tree-40')
    browser('set', 'viewport', '1512', '950')
    browser('set', 'media', 'dark')
    browser('wait', '--fn', 'Boolean(window.__fake && document.querySelector("[data-todo-root]"))')
    browser('press', 'Meta+k')
    browser('wait', '.hint-line.leader')
    browser('press', 'b')
    browser('wait', '.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]')
    browser('click', '.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]')
    browser('wait', '.shelf [data-todo="5"] .todo-open')
    evaluate(setup)
    browser('click', '.shelf [data-todo="5"] .todo-open')
    browser('wait', '--fn', 'document.querySelectorAll(".todo-status-summary").length===3')
    evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.querySelector(".drawer").getAnimations().map(a=>a.finished));document.querySelector(".todo-comments").scrollIntoView({block:"start"})})()')
    directory = Path(target)
    directory.mkdir(parents=True, exist_ok=True)
    browser('screenshot', str(directory / 'thread-closed-1512-dark.png'))
    (directory / 'thread-closed-1512-dark.checks.json').write_text(json.dumps(evaluate('window.__checks()'), ensure_ascii=False) + '\n')
    evaluate('document.querySelector(".todo-status-summary").click()')
    browser('wait', '--fn', 'document.querySelector(".todo-status-summary").getAttribute("aria-expanded")==="true"')
    browser('screenshot', str(directory / 'thread-1512-dark.png'))
    (directory / 'thread-1512-dark.checks.json').write_text(json.dumps(evaluate('window.__checks()'), ensure_ascii=False) + '\n')
    print('ok')
finally:
    browser('close')
    profile.cleanup()
