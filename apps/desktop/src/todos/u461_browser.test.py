"""U461/U461b/U462: dedicated headless agent-browser, fresh profile, App and real Daemon."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

mode, origin = sys.argv[1:3]
session = 'u461-' + uuid.uuid4().hex
profile = tempfile.TemporaryDirectory(prefix='u461-profile-')
outputs = dict(zip(['U461', 'U462'], sys.argv[3:5]))


def browser(*args):
    result = subprocess.run(['agent-browser', '--session', session, '--profile', profile.name,
                             '--args', '--no-sandbox', '--json', *args], text=True,
                            capture_output=True, timeout=45)
    if not result.stdout:
        raise RuntimeError(result.stderr)
    reply = json.loads(result.stdout)
    if not reply['success']:
        raise RuntimeError(reply)
    return reply['data']


def evaluate(script):
    return browser('eval', script)['result']


def verify_environment(scheme):
    expected = {'width': 1512, 'height': 950, 'dark': scheme == 'dark'}
    observed = evaluate("({width:innerWidth,height:innerHeight,dark:matchMedia('(prefers-color-scheme: dark)').matches})")
    if observed != expected:
        raise AssertionError(f'Page environment: expected {expected}, observed {observed}')
    return observed


def open_page(url, scheme='dark'):
    browser('open', url)
    browser('set', 'viewport', '1512', '950')
    browser('set', 'media', scheme)
    verify_environment(scheme)


def wait(predicate):
    try:
        browser('wait', '--fn', predicate)
    except RuntimeError as error:
        raise RuntimeError(str(error) + '\n' + str(evaluate('(async()=>({text:document.body.innerText.slice(0,3000),tree:window.__u462rpc?await window.__u462rpc("rail.tree"):null,messages:window.__u462rpc?await window.__u462rpc("message.list",{to:null,status:null}):null}))()'))) from error


def save(scenario, name, readings):
    target = outputs.get(scenario)
    if not target:
        return
    environment = verify_environment('dark')
    readings = {**readings, 'environment': environment}
    directory = Path(target)
    directory.mkdir(parents=True, exist_ok=True)
    browser('screenshot', str(directory / (name + '.png')))
    (directory / (name + '.checks.json')).write_text(json.dumps(readings['checks'], ensure_ascii=False) + '\n')
    (directory / (name + '.json')).write_text(json.dumps(readings, ensure_ascii=False) + '\n')


setup = r"""(async () => {
  const f=window.__fake;
  const title='長い Todo 🙂 '+ 'W'.repeat(290);
  const body='First paragraph.\nNext step: read the evolution.\n第三行。';
  const blockers=[];
  for(let n=0;n<10;n++) blockers.push((await f.app.rpc('todo.create',{title:'依存 '+n+' '+ 'long title '.repeat(12),body:null,blockers:null})).id);
  await f.app.rpc('todo.update',{id:5,title,body});
  await f.app.rpc('todo.setBlockers',{id:5,blockers});
  document.querySelector('[data-id="5"] .row-head button').click();
})()"""
reading = r"""(() => {
  const d=document.querySelector('.drawer');
  const title=[...d.querySelectorAll('p')].find(p=>p.tabIndex===0);
  const body=[...d.querySelectorAll('p')].filter(p=>p.tabIndex===0).at(-1);
  const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
  const complete=d.querySelector('input[type=checkbox]');
  const del=d.querySelector('[aria-label="Delete Todo"]');
  const close=d.querySelector('.close');
  return {checks:matchMedia('(prefers-color-scheme: dark)').matches?window.__checks():null,overflow:d.scrollWidth>d.clientWidth,
    titleSize:getComputedStyle(title).fontSize,bodySize:getComputedStyle(body).fontSize,
    titleFont:getComputedStyle(title).fontFamily,bodyFont:getComputedStyle(body).fontFamily,
    complete:complete?box(complete):null,delete:del?box(del):null,close:box(close),
    dependencyGroups:[...d.querySelectorAll('p')].filter(p=>['Waits on','Blocks'].includes(p.textContent)).map(p=>p.textContent),
    failure:[...d.querySelectorAll('[role=alert]')].map(e=>({text:e.textContent,box:box(e)})),
    history:[...d.querySelectorAll('[data-change]')].map(e=>e.textContent),
    unread:d.querySelector('hr')?.nextElementSibling?.textContent??null};
})()"""


def fake():
    for scheme in ['light', 'dark']:
        open_page(origin + '/harness.html?seed=tree-40', scheme)
        wait('Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
        evaluate(setup)
        wait('Boolean(document.querySelector("[data-change]"))')
        evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.querySelector(".drawer").getAnimations().map(a=>a.finished));})()')
        evaluate('window.__fake.failNext(-32003,"Unable to complete this Todo")')
        browser('click', '.drawer input[type=checkbox]')
        wait('document.querySelector(".drawer").textContent.includes("Unable to complete this Todo")')
        result = evaluate(reading)
        if scheme == 'dark':
            save('U461', f'worst-1512-{scheme}', result)
        evaluate('document.querySelector(".todo-history").scrollIntoView({block:"start"})')
        if scheme == 'dark':
            save('U462', f'history-1512-{scheme}', evaluate(reading))
        evaluate('document.querySelector(".drawer").scrollTop=0')
        # Native Space on the shared tick box; failure preserves focus and permits retry.
        evaluate('document.querySelector(".drawer input").focus()')
        browser('press', 'Space')
        wait('document.querySelector(".drawer input").checked')
        assert evaluate('document.querySelector(".drawer").contains(document.activeElement)')
        # Native keyboard delete: one confirmation; Escape restores the icon.
        evaluate('document.querySelector(".drawer [aria-label=\\"Delete Todo\\"]").focus()')
        browser('press', 'Enter')
        wait('document.activeElement?.textContent.trim()==="Keep"')
        if scheme == 'dark':
            save('U461', f'delete-confirm-1512-{scheme}', evaluate(reading))
        browser('press', 'Escape')
        wait('document.activeElement?.getAttribute("aria-label")==="Delete Todo"')
        assert evaluate('window.__fake.app.calls.filter(c=>c.method==="todo.delete").length') == 0


def baseline():
    for scheme in ['light', 'dark']:
        open_page(origin + '/harness.html?seed=tree-40', scheme)
        wait('Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
        evaluate(setup)
        wait('Boolean(document.querySelector(".drawer p[tabindex]"))')
        evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.querySelector(".drawer").getAnimations().map(a=>a.finished));})()')
        if scheme == 'dark':
            save('U461', f'before-1512-{scheme}', evaluate(reading))


rpc_helper = r"""window.__u462rpc=async(method,params=null)=>{
 const outcome=await (await fetch('/__daemon/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})})).json();
 if(outcome.error)throw new Error(outcome.error.message);return outcome.result;
};"""


def real():
    open_page(origin + '/harness.html?daemon=1')
    wait('Boolean(document.querySelector(".rail-actions button"))')
    evaluate(rpc_helper)
    evaluate("[...document.querySelectorAll('button')].find(b=>['New Workstream','Add Workstream'].includes(b.getAttribute('aria-label')??b.textContent.trim())).click()")
    wait("Boolean(document.querySelector('.pane-screen')) || [...document.querySelectorAll('button')].some(b=>/Start supervisor/i.test(b.textContent))")
    evaluate("[...document.querySelectorAll('button')].find(b=>/Start supervisor/i.test(b.textContent))?.click()")
    wait('Boolean(document.querySelector(".pane-screen"))')
    evaluate("(async()=>{let nodes;do{nodes=await window.__u462rpc('rail.tree');if(nodes.some(n=>n.status?.label==='starting'))await new Promise(requestAnimationFrame)}while(nodes.some(n=>n.status?.label==='starting'));})()")
    send('u462-create-todo')
    wait('Boolean(document.querySelector("[data-todo=\\"1\\"] button"))')
    evaluate('document.querySelector("[data-todo=\\"1\\"] button").click()')
    wait('Boolean(document.querySelector("[data-change]"))')
    evaluate("(async()=>{let h;do{h=await window.__u462rpc('todo.getHistory',{id:1});if(h.unread!==null)await new Promise(requestAnimationFrame)}while(h.unread!==null);})()")
    browser('click', '.drawer .close')
    wait('document.querySelector(".drawer").getAttribute("data-open")==="false"')
    send('u462-evolve-todo')
    evaluate("(async()=>{let t;do{t=await window.__u462rpc('todo.list');if(!t[0]?.done)await new Promise(requestAnimationFrame)}while(!t[0]?.done);})()")
    # Done is reachable from the Shelf; selecting the resulting Todo follows the journey's Review stage.
    evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='1 done').click()")
    wait('Boolean(document.querySelector("[data-todo=\\"1\\"] button"))')
    evaluate('document.querySelector("[data-todo=\\"1\\"] button").click()')
    wait('document.querySelectorAll("[data-change]").length===4')
    result = evaluate(reading)
    assert result['history'] == ['Title: Door TodoBody: Initial bodyOpen', 'Title: Evolved TodoBody: Changed body\nSecond line', 'Waits on: #2', 'Done'], result
    assert result['unread'] == result['history'][1], result
    save('U462', 'real-daemon-Reopened', result)


def send(text):
    # U467 replaced the Thread composer with the live Terminal; the public Message
    # seam still delivers these fixture prompts to the real Door and its MCP tools.
    evaluate("(async()=>{const door=(await window.__u462rpc('rail.tree')).find(n=>n.kind==='workstream');"
             "await window.__u462rpc('message.send',{to:door.id,kind:'note',body:"
             + json.dumps(text) + ",replyTo:null});})()")


def restarted():
    open_page(origin + '/harness.html?daemon=1')
    wait('Boolean(document.querySelector(".rail-actions button"))')
    evaluate(rpc_helper)
    # Stored Todo can be inspected after Reopening the Project even when its Workstream is not selected.
    evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='1 done')?.click()")
    wait('Boolean(document.querySelector("[data-todo=\\"1\\"] button"))')
    evaluate('document.querySelector("[data-todo=\\"1\\"] button").click()')
    wait('document.querySelectorAll("[data-change]").length===4')
    result = evaluate(reading)
    assert result['history'][-1] == 'Done' and 'Changed body\nSecond line' in result['history'][1], result
    assert result['unread'] is None, result
    save('U462', 'real-daemon-restart', result)


def u461b_fresh_profile_uses_requested_emulation():
    scheme = mode.removeprefix('emulation-')
    for index in range(2):
        if index:
            browser('set', 'viewport', '1280', '800')
            browser('set', 'media', 'light' if scheme == 'dark' else 'dark')
        open_page(origin + '/harness.html?seed=tree-40', scheme)
        observed = evaluate("({width:innerWidth,height:innerHeight,dark:matchMedia('(prefers-color-scheme: dark)').matches})")
        assert observed == {'width': 1512, 'height': 950, 'dark': scheme == 'dark'}, observed


def u461b_capture_requires_observed_emulation():
    open_page(origin + '/harness.html?seed=tree-40')
    wait('Boolean(window.__fake && document.querySelector(".rail"))')
    evaluate(setup)
    wait('Boolean(document.querySelector("[data-change]"))')
    evaluate('window.__fake.failNext(-32003,"Unable to complete this Todo")')
    browser('click', '.drawer input[type=checkbox]')
    wait('document.querySelector(".drawer").textContent.includes("Unable to complete this Todo")')
    if mode == 'capture-viewport-mismatch':
        browser('set', 'viewport', '1280', '800')
    elif mode == 'capture-scheme-mismatch':
        browser('set', 'media', 'light')
    save('U461', mode, evaluate(reading))


try:
    {
        'fake': fake,
        'real': real,
        'restart': restarted,
        'baseline': baseline,
        'emulation-light': u461b_fresh_profile_uses_requested_emulation,
        'emulation-dark': u461b_fresh_profile_uses_requested_emulation,
        'capture-valid': u461b_capture_requires_observed_emulation,
        'capture-viewport-mismatch': u461b_capture_requires_observed_emulation,
        'capture-scheme-mismatch': u461b_capture_requires_observed_emulation,
    }[mode]()
finally:
    browser('close')
    profile.cleanup()
