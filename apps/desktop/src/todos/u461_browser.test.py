"""U461/U462: dedicated headless agent-browser, fresh profile, App and real Daemon."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import uuid

mode, origin = sys.argv[1:3]
session = 'u461-' + uuid.uuid4().hex
profile = tempfile.TemporaryDirectory(prefix='u461-profile-')
outputs = dict(zip(['U461', 'U462', 'U461a'], sys.argv[3:6]))


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


def wait(predicate):
    try:
        browser('wait', '--fn', predicate)
    except RuntimeError as error:
        raise RuntimeError(str(error) + '\n' + str(evaluate('(async()=>({text:document.body.innerText.slice(0,3000),tree:window.__u462rpc?await window.__u462rpc("rail.tree"):null,messages:window.__u462rpc?await window.__u462rpc("message.list",{to:null,status:null}):null}))()'))) from error


def save(scenario, name, readings):
    target = outputs.get(scenario)
    if not target:
        return
    # Capture accepted layout after the existing finite transitions finish, never mid-paint.
    evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));})()')
    readings['checks'] = evaluate('window.__checks()')
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
  return {checks:window.__checks(),overflow:d.scrollWidth>d.clientWidth,
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
        browser('set', 'media', scheme)
        for width in [1280, 1440]:
            browser('set', 'viewport', str(width), '800')
            browser('open', origin + '/harness.html?seed=tree-40')
            wait('Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
            evaluate(setup)
            wait('Boolean(document.querySelector("[data-change]"))')
            evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.querySelector(".drawer").getAnimations().map(a=>a.finished));})()')
            evaluate('window.__fake.failNext(-32003,"Unable to complete this Todo")')
            browser('click', '.drawer input[type=checkbox]')
            wait('document.querySelector(".drawer").textContent.includes("Unable to complete this Todo")')
            result = evaluate(reading)
            save('U461', f'worst-{width}-{scheme}', result)
            evaluate('document.querySelector(".todo-history").scrollIntoView({block:"start"})')
            save('U462', f'history-{width}-{scheme}', evaluate(reading))
            evaluate('document.querySelector(".drawer").scrollTop=0')
            # Native Space on the shared tick box; failure preserves focus and permits retry.
            evaluate('document.querySelector(".drawer input").focus()')
            browser('press', 'Space')
            wait('document.querySelector(".drawer input").checked')
            assert evaluate('document.querySelector(".drawer").contains(document.activeElement)')
            # Native keyboard delete: one confirmation; Escape restores the icon.
            evaluate('document.querySelector(".drawer [aria-label=\\"Delete Todo\\"]").focus()')
            before = evaluate('document.querySelector(".drawer").scrollTop')
            browser('press', 'Enter')
            wait('document.activeElement?.textContent.trim()==="Keep"')
            confirmation = evaluate(r"""(() => {
              const d=document.querySelector('.drawer');
              const confirm=d.querySelector('.todo-delete-confirm').getBoundingClientRect();
              const title=d.querySelector('.todo-detail-title p').getBoundingClientRect();
              const del=d.querySelector('[aria-label="Delete Todo"]').getBoundingClientRect();
              return {scroll:d.scrollTop, x:confirm.x, titleX:title.x, bottom:confirm.bottom,
                titleY:title.y, deleteY:del.y, checks:window.__checks()};
            })()""")
            assert confirmation['scroll'] == before, confirmation
            save('U461', f'delete-confirm-{width}-{scheme}', evaluate(reading))
            browser('press', 'Escape')
            wait('document.activeElement?.getAttribute("aria-label")==="Delete Todo"')
            assert evaluate('window.__fake.app.calls.filter(c=>c.method==="todo.delete").length') == 0


def baseline():
    for scheme in ['light', 'dark']:
        browser('set', 'media', scheme)
        for width in [1280, 1440]:
            browser('set', 'viewport', str(width), '800')
            browser('open', origin + '/harness.html?seed=tree-40')
            wait('Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
            evaluate(setup)
            wait('Boolean(document.querySelector(".drawer p[tabindex]"))')
            evaluate('(async()=>{await document.fonts.ready;await Promise.all(document.querySelector(".drawer").getAnimations().map(a=>a.finished));})()')
            save('U461', f'before-{width}-{scheme}', evaluate(reading))


rpc_helper = r"""window.__u462rpc=async(method,params=null)=>{
 const outcome=await (await fetch('/__daemon/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})})).json();
 if(outcome.error)throw new Error(outcome.error.message);return outcome.result;
};"""


def real():
    browser('set', 'viewport', '1280', '800')
    browser('open', origin + '/harness.html?daemon=1')
    wait('Boolean(document.querySelector(".rail-actions button"))')
    evaluate(rpc_helper)
    evaluate("[...document.querySelectorAll('button')].find(b=>['New Workstream','Add Workstream'].includes(b.getAttribute('aria-label')??b.textContent.trim())).click()")
    wait("Boolean(document.querySelector('[data-thread-input]')) || [...document.querySelectorAll('button')].some(b=>/Start supervisor/i.test(b.textContent))")
    evaluate("[...document.querySelectorAll('button')].find(b=>/Start supervisor/i.test(b.textContent))?.click()")
    wait('Boolean(document.querySelector("[data-thread-input]"))')
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
    browser('fill', '[data-thread-input]', text)
    wait('document.querySelector(".thread-send")?.getAttribute("aria-disabled")!=="true"')
    browser('press', 'Enter')
    wait('document.querySelector("[data-thread-input]").value===""')


def restarted():
    browser('set', 'viewport', '1440', '800')
    browser('open', origin + '/harness.html?daemon=1')
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


def reopen_fake():
    browser('set', 'media', 'dark')
    browser('set', 'viewport', '1512', '950')
    browser('open', origin + '/harness.html?seed=tree-40')
    wait('Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
    evaluate(setup)
    wait('Boolean(document.querySelector("[data-change]"))')
    evaluate("(async()=>{await window.__fake.app.rpc('todo.complete',{id:5}); await document.fonts.ready;})()")
    wait('document.querySelector(".drawer input").checked')
    evaluate('window.__fake.failNext(-32003,"Cannot reopen this Todo: try again")')
    browser('click', '.drawer input[type=checkbox]')
    wait('document.querySelector(".drawer").textContent.includes("Cannot reopen this Todo")')
    assert evaluate('document.querySelector(".drawer input").checked')
    result = evaluate(reading)
    assert result['failure'] and result['failure'][0]['text'].startswith('Cannot reopen'), result
    save('U461', 'reopen-failure', result)
    save('U461a', 'drawer-reopen-failure', result)
    evaluate('document.querySelector(".drawer input").focus()')
    browser('press', 'Space')
    wait('!document.querySelector(".drawer input").checked')
    assert evaluate('document.activeElement===document.querySelector(".drawer input")')
    save('U461a', 'drawer-reopened', evaluate(reading))
    # The done fold uses the same input; leaving that list transfers keyboard focus.
    evaluate("(async()=>{await window.__fake.app.rpc('todo.complete',{id:5});})()")
    wait('document.querySelector(".drawer input").checked')
    browser('click', '.drawer .close')
    wait('document.querySelector(".drawer").getAttribute("data-open")==="false"')
    evaluate("[...document.querySelectorAll('.shelf button')].find(b=>/done$/.test(b.textContent.trim())).click()")
    wait('Boolean(document.querySelector(".shelf [data-todo=\\"5\\"] input:checked"))')
    save('U461a', 'done-fold', {'checks':evaluate('window.__checks()')})
    evaluate('document.querySelector(".shelf [data-todo=\\"5\\"] input").focus()')
    browser('press', 'Space')
    wait('Boolean(document.querySelector(".shelf [data-todo=\\"5\\"] input:not(:checked)"))')
    assert evaluate('document.activeElement!==document.body')
    # Done Rail leaves must stay reachable so reopening can keep focus on their input.
    evaluate("(async()=>{window.__fake.actAs({kind:'agent',id:'agent-1',parent:null});const t=await window.__fake.app.rpc('todo.create',{title:'Rail reopen '+ '長'.repeat(280),body:null,blockers:null});window.__reopenRail=t.id;await window.__fake.app.rpc('todo.complete',{id:t.id});})()")
    wait('Boolean(document.querySelector("[data-id=\\"agent-1\\"] [data-pads-control]"))')
    evaluate('document.querySelector("[data-id=\\"agent-1\\"] [data-pads-control]").click()')
    wait('Boolean(document.querySelector(".rail [data-todo=\\""+window.__reopenRail+"\\"] input"))')
    evaluate('document.querySelector(".rail [data-todo=\\""+window.__reopenRail+"\\"] input").focus()')
    browser('press', 'Space')
    wait('!document.querySelector(".rail [data-todo=\\""+window.__reopenRail+"\\"] input").checked')
    assert evaluate('document.activeElement===document.querySelector(".rail [data-todo=\\""+window.__reopenRail+"\\"] input")')
    save('U461a', 'rail-reopened', {'checks': evaluate('window.__checks()')})


def reopen_real():
    browser('set', 'media', 'dark')
    browser('set', 'viewport', '1512', '950')
    browser('open', origin + '/harness.html?daemon=1')
    wait('Boolean(document.querySelector(".rail-actions button"))')
    evaluate(rpc_helper)
    evaluate("(async()=>{const rpc=window.__u462rpc;await rpc('todo.create',{title:'Reopen blocker'});await rpc('todo.create',{title:'Wait for blocker',blockers:[1]});await rpc('todo.complete',{id:1});})()")
    wait("Boolean([...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='1 done'))")
    evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='1 done').click()")
    wait('Boolean(document.querySelector(".shelf [data-todo=\\"1\\"] button"))')
    evaluate('document.querySelector(".shelf [data-todo=\\"1\\"] button").click()')
    wait('Boolean(document.querySelector(".drawer input:checked"))')
    evaluate('document.querySelector(".drawer input").focus()')
    browser('press', 'Space')
    wait('!document.querySelector(".drawer input").checked')
    assert evaluate("(async()=>{const list=await window.__u462rpc('todo.list');const h=await window.__u462rpc('todo.getHistory',{id:1});return list[1].blocked&&h.changes.at(-1).actor.kind==='user';})()")
    evaluate("(async()=>{await window.__u462rpc('todo.complete',{id:1});})()")
    wait('document.querySelector(".drawer input").checked')
    # Reuse the actual stdio tool, with the same Agent identity fake Claude uses.
    import os
    project = sys.argv[6]
    rup = str(Path(__file__).resolve().parents[4] / 'target/debug/rup')
    agent_id = evaluate('(async()=> (await window.__u462rpc("agent.spawn",{cwd:'+json.dumps(project)+',name:"reopen-agent"})).id)()')
    mcp = subprocess.Popen([rup, 'mcp', agent_id], env={**os.environ, 'RUPD_SOCKET': str(Path(project)/'rupd.sock')}, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        requests = [
            {'id':1,'method':'initialize','params':{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'fake-claude','version':'0'}}},
            {'method':'notifications/initialized'},
            {'id':2,'method':'tools/call','params':{'name':'todo_reopen','arguments':{'id':1}}},
        ]
        for request in requests:
            mcp.stdin.write(json.dumps({'jsonrpc':'2.0',**request})+'\n');mcp.stdin.flush()
            if 'id' in request:
                reply=json.loads(mcp.stdout.readline())
                assert 'error' not in reply, reply
                if request['id']==2:
                    assert not reply['result'].get('isError'), reply
    finally:
        mcp.stdin.close()
        mcp.wait(timeout=10)
    wait('!document.querySelector(".drawer input").checked')
    assert evaluate('document.activeElement===document.querySelector(".drawer input")')
    outcome=evaluate("(async()=>({list:await window.__u462rpc('todo.list'),history:await window.__u462rpc('todo.getHistory',{id:1}),touches:await window.__u462rpc('provenance.history',{item:'todo:1'})}))()")
    assert outcome['list'][1]['blocked'], outcome
    assert outcome['history']['changes'][-1]['actor']=={'kind':'agent','id':agent_id,'parent':None}, outcome
    assert outcome['touches'][-1]['actor']['id']==outcome['history']['changes'][-1]['actor']['id'], outcome
    save('U461a', 'real-user-and-agent-reopen', {'checks':evaluate('window.__checks()'),**outcome})


def reopen_restart():
    browser('set', 'media', 'dark')
    browser('set', 'viewport', '1512', '950')
    browser('open', origin + '/harness.html?daemon=1')
    wait('Boolean(document.querySelector(".rail-actions button"))')
    evaluate(rpc_helper)
    outcome=evaluate("(async()=>({list:await window.__u462rpc('todo.list'),history:await window.__u462rpc('todo.getHistory',{id:1}),touches:await window.__u462rpc('provenance.history',{item:'todo:1'})}))()")
    assert not outcome['list'][0]['done'] and outcome['list'][1]['blocked'], outcome
    assert outcome['history']['changes'][-1]['actor']['kind']=='agent', outcome
    assert outcome['touches'][-1]['actor']['id']==outcome['history']['changes'][-1]['actor']['id'], outcome
    save('U461a', 'real-restart', {'checks':evaluate('window.__checks()'),**outcome})


try:
    {'reopen-fake':reopen_fake,'reopen-real':reopen_real,'reopen-restart':reopen_restart,'fake': fake, 'real': real, 'restart': restarted, 'baseline': baseline}[mode]()
finally:
    browser('close')
    profile.cleanup()
