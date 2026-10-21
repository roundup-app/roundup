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
outputs = dict(zip(['U461', 'U462', 'U461a'], sys.argv[3:6]))


def browser(*args):
    if args[0] == 'open' and len(args) > 1:
        browser('open')
        # Each caller waits for its App state; loading unrelated assets must not decide readiness.
        return browser('eval', 'requestAnimationFrame(()=>location.assign(%s)); true' % json.dumps(args[1]))
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


def refuse_reopen(message):
    evaluate("""(() => {
      const app=window.__fake.app;
      const reopen=app.handlers['todo.reopen'];
      app.handlers['todo.reopen']=(params)=>{
        app.handlers['todo.reopen']=reopen;
        throw new Error(%s);
      };
    })()""" % json.dumps(message))


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
    unread:d.querySelector('.todo-history-count')?.dataset.state??null};
})()"""


def fake():
    for scheme in ['light', 'dark']:
        open_page(origin + '/harness.html?seed=tree-40', scheme)
        wait('Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
        evaluate(setup)
        wait('Boolean(document.querySelector(".todo-history-line"))')
        evaluate('document.querySelector(".todo-history-line").click()')
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
    if evaluate('document.querySelector("#shelf-tab-todos").getAttribute("aria-expanded")!=="true"'):
        browser('click', '#shelf-tab-todos')
    wait('Boolean(document.querySelector("[data-todo=\\"1\\"] button"))')
    evaluate('document.querySelector("[data-todo=\\"1\\"] button").click()')
    wait('Boolean(document.querySelector(".todo-history-line"))')
    evaluate('document.querySelector(".todo-history-line").click()')
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
    wait('Boolean(document.querySelector(".todo-history-line"))')
    # Unread changes show as a state mark on the collapsed count; opening reads them.
    assert evaluate("document.querySelector('.todo-history-count').dataset.state") == 'unread'
    evaluate('document.querySelector(".todo-history-line").click()')
    wait('document.querySelectorAll("[data-change]").length===6')
    result = evaluate(reading)
    assert result['history'] == ['Created Door Todo', 'Wrote the body', 'Renamed to Evolved Todo', 'Wrote the body', 'Now waits on #2', 'Marked done'], result
    save('U462', 'real-daemon-Reopened', result)


def reopen_fake():
    open_page(origin + '/harness.html?seed=tree-40')
    wait('Boolean(window.__fake && document.querySelector("[data-id=\\"5\\"] .row-head button"))')
    evaluate(setup)
    wait('Boolean(document.querySelector(".todo-history-line"))')
    evaluate('document.querySelector(".todo-history-line").click()')
    wait('Boolean(document.querySelector("[data-change]"))')
    baseline_checks = evaluate('window.__checks()')
    save('U461a', 'open-before-reopen-1512-dark', evaluate(reading))
    evaluate("window.__fake.app.rpc('todo.complete',{id:5})")
    wait('document.querySelector(".drawer input").checked')
    refuse_reopen('Unable to reopen this Todo')
    evaluate('document.querySelector(".drawer .close").focus()')
    for _ in range(3):
        browser('press', 'Tab')
        if evaluate('document.activeElement===document.querySelector(".drawer input")'):
            break
    assert evaluate('document.activeElement===document.querySelector(".drawer input")')
    browser('press', 'Space')
    wait('document.querySelector(".drawer").textContent.includes("Unable to reopen this Todo")')
    assert evaluate('document.querySelector(".drawer input").checked && document.activeElement===document.querySelector(".drawer input")')
    result = evaluate(reading)
    assert not result['overflow'], result
    for check in ['D2', 'D5', 'D6']:
        assert result['checks'][check]['status'] == 'pass', result
    assert result['failure'] and all(row['box']['height'] > 0 for row in result['failure']), result
    save('U461a', 'drawer-reopen-failed-1512-dark', result)
    browser('press', 'Space')
    wait('!document.querySelector(".drawer input").checked')
    assert evaluate('document.activeElement===document.querySelector(".drawer input")')
    evaluate('(async()=>{await document.fonts.ready;await Promise.allSettled(document.querySelector(".drawer").getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished));})()')
    reopened = evaluate(reading)
    # U461a keeps every passing Check, including the selected blocker line.
    for check, before in baseline_checks.items():
        if before['status'] == 'pass':
            assert reopened['checks'][check]['status'] == 'pass', reopened
    for check in ['D2', 'D5', 'D6']:
        assert reopened['checks'][check]['status'] == 'pass', reopened
    save('U461a', 'drawer-reopened-1512-dark', reopened)
    browser('click', '.drawer .close')
    wait('document.querySelector(".drawer").getAttribute("data-open")==="false"')


def reopen_surfaces():
    open_page(origin + '/harness.html?seed=tree-40')
    wait('Boolean(window.__fake && document.querySelector("[data-todo-root]"))')
    if evaluate('document.querySelector("#shelf-tab-todos").getAttribute("aria-expanded")!=="true"'):
        browser('click', '#shelf-tab-todos')
    evaluate("(async()=>{window.__blockers=[];for(let n=0;n<10;n++)window.__blockers.push((await window.__fake.app.rpc('todo.create',{title:'Review '+n,body:null,blockers:null})).id);})()")
    # Exercise the root list, Agent-filtered list and actual Rail leaves.
    for surface in ["overview", "agent", "rail"]:
        for key in ['pointer', 'Space']:
            evaluate("(async()=>{const f=window.__fake; const a=(await f.app.rpc('rail.tree',null)).find(n=>n.kind==='agent'&&n.id==='tokens'); f.actAs({kind:'agent',id:a.id,parent:null}); const t=await f.app.rpc('todo.create',{title:'Reopen '+(window.__testId??0)+' '+ 'W'.repeat(290),body:null,blockers:window.__blockers}); window.__testId=t.id; await f.app.rpc('todo.complete',{id:t.id});f.actAs({kind:'user',id:'you',parent:null});})()")
            if surface != "overview":
                browser('click', '.rail-row[data-id="tokens"] .name')
            else:
                evaluate('document.querySelector("[data-todo-root]").click()')
            if surface == 'rail':
                evaluate("(()=>{const b=document.querySelector('.rail-row[data-id=\"tokens\"] [data-pads-control]');if(b.getAttribute('aria-expanded')!=='true')b.click()})()")
            else:
                evaluate("[...document.querySelectorAll('[data-part=branch-control]')].filter(b=>b.closest('.shelf-groups')&&b.closest('[role=treeitem]')?.getAttribute('aria-expanded')==='false').forEach(b=>b.click())")
                wait('Boolean(document.querySelector(".shelf-done-line .todo-row-button"))')
                evaluate("if(!document.querySelector(`.shelf [data-todo=\"${window.__testId}\"] input`)) document.querySelector('.shelf-done-line .todo-row-button').click()")
            scope = '.rail-tree ' if surface == 'rail' else '.shelf '
            evaluate('window.__testScope='+json.dumps(scope)+';window.__testRow=()=>document.querySelector(window.__testScope+`[data-todo="${window.__testId}"]`)')
            wait('Boolean(window.__testRow()?.querySelector("input"))')
            if key == 'Space':
                if surface == 'rail':
                    evaluate('window.__testRow().querySelector("input").focus()')
                    browser('press', 'Shift+Tab')
                else:
                    evaluate('window.__testRow().querySelector(".todo-row-button").focus()')
                browser('press', 'Tab')
                assert evaluate('document.activeElement===window.__testRow().querySelector("input")')
            baseline_checks = evaluate('window.__checks()')
            before = evaluate('window.__fake.app.calls.filter(c=>c.method==="todo.reopen").length')
            refuse_reopen('Reopen refused: try again')
            selector = scope + f'[data-todo="{evaluate("window.__testId")}"] input'
            if key == 'pointer':
                browser('click', selector)
            else:
                browser('press', 'Space')
            wait('Boolean(window.__testRow().querySelector("[role=alert]"))')
            assert evaluate('document.activeElement===window.__testRow().querySelector("input") && document.activeElement.checked')
            assert evaluate('window.__fake.app.calls.filter(c=>c.method==="todo.reopen").length') == before + 1
            failure_readings = {'checks': evaluate('window.__checks()')}
            for check, prior in baseline_checks.items():
                if prior['status'] == 'pass':
                    assert failure_readings['checks'][check]['status'] == 'pass', failure_readings
            save('U461a', f'row-{surface}-{key}-failure-1512-dark', failure_readings)
            if key == 'pointer':
                browser('click', selector)
            else:
                browser('press', 'Space')
            wait('Boolean(window.__testRow().querySelector("input[aria-label^=Complete]"))')
            assert evaluate('window.__fake.app.calls.filter(c=>c.method==="todo.reopen").length') == before + 2
            assert evaluate('document.querySelector(".drawer").getAttribute("data-open")==="false"')
            assert evaluate('document.activeElement!==document.body')
            result = {'checks': evaluate('window.__checks()')}
            for check in ['D2', 'D5', 'D6']:
                assert result['checks'][check]['status'] == 'pass', result
            save('U461a', f'row-{surface}-{key}-1512-dark', result)


def real_reopen():
    real()
    evaluate("window.__u462rpc('todo.create',{title:'Dependent',blockers:[1]})")
    evaluate('document.querySelector(".drawer input").focus()')
    browser('press', 'Space')
    wait('!document.querySelector(".drawer input").checked')
    assert evaluate('document.activeElement===document.querySelector(".drawer input")')
    user = evaluate("window.__u462rpc('todo.getHistory',{id:1})")['changes'][-1]
    assert user['before']['done'] and not user['after']['done'] and user['actor']['kind'] == 'user', user
    assert evaluate("window.__u462rpc('todo.get',{id:3})")['blocked']
    evaluate("window.__u462rpc('todo.complete',{id:1})")
    wait('document.querySelector(".drawer input").checked')
    evaluate("(async()=>{const door=(await window.__u462rpc('rail.tree')).find(n=>n.kind==='workstream');await window.__u462rpc('message.send',{to:door.id,kind:'note',body:'u461a-reopen-todo'});})()")
    wait('!document.querySelector(".drawer input").checked')
    history = evaluate("window.__u462rpc('todo.getHistory',{id:1})")['changes']
    last = history[-1]
    assert len(history) == 7 and last['before']['done'] and not last['after']['done'], history
    assert last['actor']['kind'] == 'agent', last
    writes = [t for t in evaluate("window.__u462rpc('provenance.history',{item:'todo:1'})") if t['verb'] == 'wrote']
    assert writes[-1]['actor'] == last['actor'] and writes[-3]['actor'] == user['actor'], writes
    assert evaluate("window.__u462rpc('todo.get',{id:3})")['blocked']
    wait('document.querySelectorAll("[data-change]").length===7')
    evaluate('(async()=>{await Promise.allSettled(document.querySelector(".drawer").getAnimations({subtree:true}).filter(a=>a.effect.getComputedTiming().iterations!==Infinity).map(a=>a.finished));})()')
    save('U461a', 'real-daemon-user-and-agent-reopened', evaluate(reading))


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
    if evaluate('document.querySelector("#shelf-tab-todos").getAttribute("aria-expanded")!=="true"'):
        browser('click', '#shelf-tab-todos')
    # Stored Todo can be inspected after Reopening the Project even when its Workstream is not selected.
    evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='1 done')?.click()")
    wait('Boolean(document.querySelector("[data-todo=\\"1\\"] button"))')
    evaluate('document.querySelector("[data-todo=\\"1\\"] button").click()')
    wait('document.querySelectorAll("[data-change]").length===7')
    result = evaluate(reading)
    assert result['history'][-1] == 'Open' and 'Changed body\nSecond line' in result['history'][1], result
    assert result['unread'] == 'Open', result
    assert not evaluate("window.__u462rpc('todo.get',{id:1})")['done']
    assert evaluate("window.__u462rpc('todo.getHistory',{id:1})")['changes'][-1]['actor']['kind'] == 'agent'
    save('U461a', 'real-daemon-restart', result)


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
        'reopen-fake': reopen_fake,
        'reopen-surfaces': reopen_surfaces,
        'reopen-real': real_reopen,
        'reopen-restart': restarted,
        'emulation-light': u461b_fresh_profile_uses_requested_emulation,
        'emulation-dark': u461b_fresh_profile_uses_requested_emulation,
        'capture-valid': u461b_capture_requires_observed_emulation,
        'capture-viewport-mismatch': u461b_capture_requires_observed_emulation,
        'capture-scheme-mismatch': u461b_capture_requires_observed_emulation,
    }[mode]()
finally:
    browser('close')
    profile.cleanup()
