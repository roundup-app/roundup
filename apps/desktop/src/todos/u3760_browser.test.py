"""U3760: the Drawer's Pad links on tree-40, dark, 1512x950; dedicated headless agent-browser, fresh profile."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

origin, target = sys.argv[1:3]
lifetime = len(sys.argv) > 3 and sys.argv[3] == "P3557c"
session = 'u3760-' + uuid.uuid4().hex
profile = tempfile.TemporaryDirectory(prefix='u3760-profile-')


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
  const key='k';
  const names=['P'.repeat(300),'plans','notes','日本語のメモ','Ünï côdé','roadmap','a','b','c','gone'];
  const headings=[null,'日本語の見出し','Plan: step 1 of 2','Ünï',null,'Q3','x',null,'Longer heading '+'H'.repeat(120),'Old plan'];
  const urls=names.map((n,i)=>'roundup://pad/'+encodeURIComponent(n)+'?project='+key+(headings[i]===null?'':'#'+encodeURIComponent(headings[i])));
  for(const url of urls) await f.app.rpc('todo.addRef',{id:5,url});
  const was=f.app.handlers['todo.refs'];
  f.app.handlers['todo.refs']=async (p)=>(await was(p)).map((r)=>({...r,state:r.url===urls[9]?'missing':'ok'}));
  document.querySelector('[data-id="5"] .row-head button').click();
})()"""
reading = r"""(() => {
  const d=document.querySelector('.drawer');
  const rows=[...d.querySelectorAll('.todo-ref')];
  return {checks:window.__checks(),count:rows.length,heading:d.querySelector('.todo-refs h3').textContent,
    overflow:d.scrollWidth>d.clientWidth,rowsOverflow:rows.some(r=>r.scrollWidth>r.clientWidth),
    links:rows.filter(r=>r.querySelector('[role=link]')).length,missing:rows.filter(r=>r.dataset.state==='missing').length};
})()"""

try:
    browser('open', origin + '/harness.html?seed=tree-40')
    browser('set', 'viewport', '1512', '950')
    browser('set', 'media', 'dark')
    browser('wait', '--fn', 'Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
    assert evaluate("({w:innerWidth,h:innerHeight,d:matchMedia('(prefers-color-scheme: dark)').matches})") == {'w': 1512, 'h': 950, 'd': True}
    if lifetime:
        directory = Path(target)
        directory.mkdir(parents=True, exist_ok=True)
        evaluate('document.querySelector(\'[data-id="5"] .row-head button\').click()')
        browser('wait', '--fn', 'Boolean(document.querySelector(".todo-comment-field"))')
        evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.querySelector(".drawer").getAnimations().map(a=>a.finished))})()')

        def capture(name):
            result = evaluate('window.__checks()')
            browser('screenshot', str(directory / (name + '.png')))
            (directory / (name + '.checks.json')).write_text(json.dumps(result, ensure_ascii=False) + '\n')
            return result

        capture('drawer-before')
        evaluate(r"""(() => {
          const field=document.querySelector('.todo-comment-field');
          field.value='  e\u0301 🧪\n次の行  '; field.dispatchEvent(new Event('input',{bubbles:true}));
          window.__fake.failNext(-32003,'Comment could not be sent; retry or dismiss the failure.');
          document.querySelector('.todo-comments-send button').click();
        })()""")
        browser('wait', '--fn', 'Boolean(document.querySelector(".todo-comments [role=alert]"))')
        capture('comment-failure')
        evaluate("[...document.querySelectorAll('.todo-comments button')].find(b=>b.textContent==='Dismiss').click()")
        browser('wait', '--fn', '!document.querySelector(".todo-comments [role=alert]")')
        assert evaluate("document.querySelector('.todo-comment-field').value") == '  e\u0301 🧪\n次の行  '
        capture('comment-dismissed')
        evaluate("window.__fake.failNext(-32003,'Todo could not be saved; retry or dismiss the failure.'); document.querySelector('.todo-detail-title input[type=checkbox]').click()")
        browser('wait', '--fn', 'Boolean(document.querySelector(".todo-detail > .reserved-line [role=alert]"))')
        capture('drawer-failure')
        evaluate("document.querySelector('.todo-detail-title input[type=checkbox]').click()")
        browser('wait', '--fn', '!document.querySelector(".todo-detail > .reserved-line [role=alert]")')
        assert evaluate("document.querySelector('.todo-comment-field').value") == '  e\u0301 🧪\n次の行  '
        capture('drawer-saved')
    else:
        evaluate(setup)
        browser('wait', '--fn', 'document.querySelectorAll(".todo-ref").length===10')
        evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.querySelector(".drawer").getAnimations().map(a=>a.finished));document.querySelector(".todo-refs").scrollIntoView({block:"start"})})()')
        result = evaluate(reading)
        assert result['count'] == 10 and result['heading'] == 'Pads · 10' and result['links'] == 9 and result['missing'] == 1 and not result['overflow'] and not result['rowsOverflow'], result
        directory = Path(target)
        directory.mkdir(parents=True, exist_ok=True)
        browser('screenshot', str(directory / 'drawer-1512-dark.png'))
        (directory / 'drawer-1512-dark.checks.json').write_text(json.dumps(result['checks'], ensure_ascii=False) + '\n')
    print('ok')
finally:
    browser('close')
    profile.cleanup()
