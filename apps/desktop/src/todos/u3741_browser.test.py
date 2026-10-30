"""U3741: the Drawer's thread on tree-40, dark, 1512x950; dedicated headless agent-browser, fresh profile."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

origin, target = sys.argv[1:3]
session = 'u3741-' + uuid.uuid4().hex
profile = tempfile.TemporaryDirectory(prefix='u3741-profile-')


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
  const say=(body)=>f.app.rpc('todo.comment',{id:5,body});
  await say('長いコメント 🙂 '+'W'.repeat(300));
  for(let n=0;n<9;n++) await say('Comment '+n+' 第'+n+'行');
})()"""
reading = r"""(() => {
  const d=document.querySelector('.drawer');
  const rows=[...d.querySelectorAll('.todo-comment')];
  const field=d.querySelector('.todo-comment-field');
  return {checks:window.__checks(),count:rows.length,heading:d.querySelector('.todo-comments h3').textContent,
    overflow:d.scrollWidth>d.clientWidth,rowsOverflow:rows.some(r=>r.scrollWidth>r.clientWidth),
    authors:rows.map(r=>r.querySelector('.todo-comment-author').textContent),
    inView:field.getBoundingClientRect().width>0};
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
    assert evaluate("({w:innerWidth,h:innerHeight,d:matchMedia('(prefers-color-scheme: dark)').matches})") == {'w': 1512, 'h': 950, 'd': True}
    evaluate(setup)
    browser('click', '.shelf [data-todo="5"] .todo-open')
    browser('wait', '--fn', 'document.querySelectorAll(".todo-comment").length===10')
    evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.querySelector(".drawer").getAnimations().map(a=>a.finished));document.querySelector(".todo-comments").scrollIntoView({block:"start"})})()')
    result = evaluate(reading)
    assert result['count'] == 10 and result['heading'].startswith('Comments') and not result['overflow'] and not result['rowsOverflow'], result
    directory = Path(target)
    directory.mkdir(parents=True, exist_ok=True)
    browser('screenshot', str(directory / 'drawer-1512-dark.png'))
    (directory / 'drawer-1512-dark.checks.json').write_text(json.dumps(result['checks'], ensure_ascii=False) + '\n')
    print('ok')
finally:
    browser('close')
    profile.cleanup()
