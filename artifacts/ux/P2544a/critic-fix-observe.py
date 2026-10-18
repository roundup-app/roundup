import subprocess,json,pathlib,sys,os

# Run baseline and head Vite servers on ports 5201 and 5202, then run this file.
# Only this dedicated headless session is opened and closed.
root=str(pathlib.Path(__file__).resolve().parents[3])
cli=root+'/apps/desktop/node_modules/.bin/agent-browser'
session='builder-39089911478'
out=pathlib.Path(root+'/artifacts/ux/P2544a/critic-fix')
out.mkdir(parents=True,exist_ok=True)
def ab(*args):
 r=subprocess.run([cli,'--session',session,*args],cwd=root,text=True,capture_output=True,timeout=70)
 if r.returncode: raise RuntimeError(str(args)+r.stderr)
 return r.stdout
def ev(js): return json.loads(ab('eval',js))
def opened(port):
 ab('open',f'http://127.0.0.1:{port}/harness.html?seed=tree-40')
 ab('wait','#shelf-tab-pads');ab('click','#shelf-tab-pads');ab('wait','[data-shelf-row] .pad-name')
 ab('eval',"document.querySelectorAll('[data-shelf-row] .pad-name')[3].click()")
 ab('wait','.ProseMirror[contenteditable=true]')
def capture(side,name):
 p=out/side;p.mkdir(exist_ok=True)
 ab('screenshot',str(p/(name+'.png')))
 (p/(name+'.checks.json')).write_text(json.dumps(ev('window.__checks()'),indent=2)+'\n')
ab('set','viewport','1512','950')
try:
 for side,port in [('base',5201),('head',5202)]:
  for scheme in ['light','dark']:
   ab('set','media',scheme);opened(port)
   capture(side,scheme+'-opened')
   ab('focus','.ProseMirror');ab('press','Control+End');ab('press','Enter');ab('keyboard','type','/')
   ab('wait','.milkdown-slash-menu[data-show=true]')
   capture(side,scheme+'-slash')
   ab('press','ArrowDown');capture(side,scheme+'-slashdown')
   ab('press','Escape');ab('press','Control+Home');ab('hover','.ProseMirror p:first-of-type')
   ab('wait','.milkdown-block-handle[data-show=true]')
   capture(side,scheme+'-handle')
   ab('focus','.ProseMirror');ab('press','Control+End');ab('keyboard','type',' save failure')
   ev("window.__fake.failNext(-32000, 'Pad could not be saved: permission denied')")
   ab('click','.pad-head-name');ab('wait','[role=alert]')
   capture(side,scheme+'-failure')
finally:ab('close')
