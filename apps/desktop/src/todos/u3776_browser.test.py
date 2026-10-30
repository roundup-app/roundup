"""U3776, U3796: a comment arriving while the Drawer is open appears at once, with no animation, with and without reduced motion; tree-40, dark, 1512x950; dedicated headless agent-browser, fresh profile."""
import json
import subprocess
import sys
import tempfile
import uuid

origin = sys.argv[1]
session = 'u3776-' + uuid.uuid4().hex
profile = tempfile.TemporaryDirectory(prefix='u3776-profile-')


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


# Sends one comment, then reads the new block's animations at once.
arrive = r"""(async () => {
  const d=document.querySelector('.drawer');
  const all=()=>[...d.querySelectorAll('.todo-comment')];
  const before=all().length;
  await window.__fake.app.rpc('todo.comment',{id:5,body:'Arrived '+Math.random()});
  const fresh=await new Promise(done=>{const t=setInterval(()=>{const e=all();if(e.length>before){clearInterval(t);done(e[e.length-1])}},5)});
  return {running:fresh.getAnimations().length};
})()"""


def open_drawer():
    browser('open', origin + '/harness.html?seed=tree-40')
    browser('set', 'viewport', '1512', '950')
    browser('wait', '--fn', 'Boolean(window.__fake && document.querySelector("[data-todo-root]"))')
    if evaluate("document.querySelector('.window').dataset.shelf === 'closed'"):
        browser('press', 'Meta+k')
        browser('wait', '.hint-line.leader')
        browser('press', 'b')
    browser('wait', '.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]')
    browser('click', '.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]')
    browser('wait', '.shelf [data-todo="5"] .todo-open')
    evaluate("window.__fake.app.rpc('todo.comment',{id:5,body:'Opening'})")
    browser('click', '.shelf [data-todo="5"] .todo-open')
    browser('wait', '--fn', 'document.querySelectorAll(".todo-comment").length===1')
    evaluate('document.fonts.ready.then(()=>true)')


try:
    browser('set', 'media', 'dark')
    open_drawer()
    moving = evaluate(arrive)
    assert moving['running'] == 0, moving

    # Keep the same open Drawer: only the host motion preference changes.
    browser('set', 'media', 'dark', 'reduced-motion')
    assert evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches') is True
    still = evaluate(arrive)
    assert still['running'] == 0, still
    print('ok')
finally:
    browser('close')
    profile.cleanup()
