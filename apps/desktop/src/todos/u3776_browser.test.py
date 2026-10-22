"""U3776, U3796: a comment arriving while the Drawer is open fades in once, and runs no animation under reduced motion; tree-40, dark, 1512x950; dedicated headless agent-browser, fresh profile."""
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


# Sends one comment, then reads the new block's animation at once and the offsets of the blocks above it.
arrive = r"""(async () => {
  const d=document.querySelector('.drawer');
  const tops=()=>[...d.querySelectorAll('.todo-comment:not([data-fresh])')].map(e=>e.getBoundingClientRect().top);
  const before=tops();
  await window.__fake.app.rpc('todo.comment',{id:5,body:'Arrived '+Math.random()});
  const fresh=await new Promise(done=>{const t=setInterval(()=>{const e=d.querySelector('.todo-comment[data-fresh]');if(e){clearInterval(t);done(e)}},5)});
  const s=getComputedStyle(fresh);
  return {name:s.animationName,duration:s.animationDuration,count:s.animationIterationCount,
    moved:JSON.stringify(before)!==JSON.stringify(tops().slice(0,before.length)),
    properties:fresh.getAnimations().flatMap(a=>a.effect.getKeyframes().flatMap(k=>Object.keys(k).filter(p=>!['offset','easing','composite','computedOffset'].includes(p))))};
})()"""


def open_drawer():
    browser('open', origin + '/harness.html?seed=tree-40')
    browser('set', 'viewport', '1512', '950')
    browser('wait', '--fn', 'Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
    evaluate("(async()=>{await window.__fake.app.rpc('todo.comment',{id:5,body:'Opening'});document.querySelector('[data-id=\"5\"] .row-head button').click()})()")
    browser('wait', '--fn', 'document.querySelectorAll(".todo-comment").length===1')
    evaluate('document.fonts.ready.then(()=>true)')


try:
    browser('set', 'media', 'dark')
    open_drawer()
    assert evaluate('document.querySelector(".todo-comment[data-fresh]")') is None
    moving = evaluate(arrive)
    seconds = float(moving['duration'].removesuffix('s'))
    assert moving['name'] != 'none' and 0 < seconds <= 0.2 and moving['count'] == '1' and not moving['moved'], moving
    assert set(moving['properties']) == {'opacity'}, moving

    open_drawer()
    browser('set', 'media', 'dark', 'reduced-motion')
    assert evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches') is True
    still = evaluate(arrive)
    assert float(still['duration'].removesuffix('s')) == 0 and not still['moved'], still
    print('ok')
finally:
    browser('close')
    profile.cleanup()
