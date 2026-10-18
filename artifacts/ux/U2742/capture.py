import subprocess,json,pathlib,sys,tempfile,os,shutil
root=str(pathlib.Path(__file__).resolve().parents[3])
exe=root+'/apps/desktop/node_modules/.bin/agent-browser'
side=sys.argv[1]; port='5200' if side=='base' else '5199'
session='u2742-capture-'+side+'-'+str(os.getpid())
profile=tempfile.mkdtemp(prefix=session+'-')
out=pathlib.Path(root+'/artifacts/ux/U2742/'+side);out.mkdir(parents=True,exist_ok=True)
def ab(*args):
 p=subprocess.run([exe,'--session',session,'--json',*args],capture_output=True,text=True,timeout=35)
 if p.returncode: raise RuntimeError(str(args)+p.stderr+p.stdout)
 r=json.loads(p.stdout)
 if not r.get('success',True): raise RuntimeError(str(r))
 return r.get('data',{})
def ev(js):return ab('eval',js).get('result')
def wait(js):ab('wait','--fn',js)
def snap(name):
 ab('screenshot',str(out/(name+'.png')))
 (out/(name+'.checks.json')).write_text(json.dumps(ev('window.__checks()'),indent=2)+'\n')
 data=ev('''(() => {const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}; const b=document.querySelector('.bubble:not([hidden])');const f=b?.closest('.bubble-frame');const s=f&&getComputedStyle(f,'::backdrop');return {pane:rect(document.querySelector('.bubbles')),bubble:b&&rect(b),backdrop:s&&{left:s.left,top:s.top,width:s.width,height:s.height,background:s.backgroundColor,filter:s.backdropFilter,pointer:s.pointerEvents},focused:document.activeElement?.closest('.bubble')?.dataset.bubble??(document.activeElement?.closest('.pane-screen')?'agent':'other'),popover:!!document.querySelector('.bubble-frame:popover-open')};})()''')
 (out/(name+'.observation.json')).write_text(json.dumps(data,indent=2)+'\n')
def activate():
 ev('document.querySelector(\'button.terminal-tab[data-bubble="101"]\').click()')
 wait('document.activeElement?.closest(\'.bubble[data-bubble="101"]\') !== null')
def settleOutput():
 wait('window.__terminals.get("101")?.isAtBottom()')
 # xterm.write batches to its render frame; acknowledge the next rendered frame before capture.
 ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
try:
 ab('--profile',profile,'open','http://127.0.0.1:'+port+'/harness.html?seed=bubbles&renderer=dom')
 for mode,scheme,settings,w,h in [('light','light',[],1512,950),('dark','dark',['dark'],1512,950),('contrast','light',['more-contrast'],1512,950),('reduced','dark',['dark','reduced-transparency'],1512,950),('stress','dark',['dark'],1280,600)]:
  ab('set','media',scheme); ab('set','viewport',str(w),str(h))
  ev('sessionStorage.clear(); localStorage.removeItem("roundup:widths:/Users/you/harness")')
  ab('open','http://127.0.0.1:'+port+'/harness.html?seed=bubbles&renderer=dom')
  wait('!!window.__fake && !!document.querySelector(\'[data-id="runner"]\')')
  ev('''(async()=>{const {underSettings}=await import('/src/testing/media.ts');for(const s of document.querySelectorAll('style'))s.textContent=underSettings(s.textContent,'''+json.dumps(settings)+''');})()''')
  ev('document.querySelector(\'[data-id="runner"]\').click()')
  wait('!!document.querySelector(\'button.terminal-tab[data-bubble="101"]\') && !!document.querySelector(".pane-screen .xterm-screen")')
  ev('''(()=>{let tick=0;window.__fake.writeOutput('t-runner',Array.from({length:180},(_,i)=>'Agent is building: step '+i+'   src/terminal/screens.ts   42 passed   next task waiting\\r\\n').join(''));window.__changing=setInterval(()=>window.__fake.writeOutput('t-runner','working '+(++tick)+'   inspecting output and continuing the command\\r\\n'),150);})()''')
  activate();settleOutput();snap(mode+'-fresh-sparse')
  ev('''window.__fake.writeOutput('101',Array.from({length:150},(_,i)=>'cargo test  case '+i+' ... ok     150 checks passing\\r\\n').join(''))''');settleOutput();snap(mode+'-full-output')
  # Real header double click exercises filled/restore without changing terminal lifetime.
  ab('dblclick','.bubble[data-bubble="101"] .bubble-header');settleOutput();snap(mode+'-filled')
  ab('dblclick','.bubble[data-bubble="101"] .bubble-header');settleOutput();snap(mode+'-restored')
  if side=='head':
   ev('''(()=>{const e=new KeyboardEvent('keydown',{key:'b',code:'KeyB',metaKey:true,bubbles:true,cancelable:true});document.activeElement.dispatchEvent(e);if(!e.defaultPrevented)throw Error('switch was unavailable: '+JSON.stringify({focus:document.activeElement?.outerHTML,main:!!document.querySelector('.pane-screen textarea'),selected:document.querySelector('.rail-row[data-selected=true]')?.dataset.id}));document.activeElement.dispatchEvent(new KeyboardEvent('keyup',{key:'b',code:'KeyB',metaKey:true,bubbles:true}));})()''')
  else:
   ev('document.querySelector(\'.bubble[data-bubble="101"] [aria-label="Minimise"]\').click()')
   ev('document.querySelector(".pane-screen textarea").focus()')
  wait('!document.querySelector(".bubble:not([hidden])")');snap(mode+'-returned')
  ev('clearInterval(window.__changing)')
  # Every saved rectangle, including a pre-change default, survives the new default.
  ev('''(()=>{const key='roundup:bubble-places:/Users/you/harness';const p=JSON.parse(sessionStorage.getItem(key));p['101']={x:40,y:44,w:400,h:260,min:true};sessionStorage.setItem(key,JSON.stringify(p));})()''')
  ab('reload');wait('!!document.querySelector(\'button.terminal-tab[data-bubble="101"]\')')
  ev('''(async()=>{const {underSettings}=await import('/src/testing/media.ts');for(const s of document.querySelectorAll('style'))s.textContent=underSettings(s.textContent,'''+json.dumps(settings)+''');})()''')
  activate();settleOutput();snap(mode+'-saved')
  print(side,mode,flush=True)
 # At 1280x600, the existing width settings shrink the pane below 2*96 + the minimum.
 ab('set','media','dark');ab('set','viewport','1280','600')
 ev('sessionStorage.clear(); localStorage.setItem("roundup:widths:/Users/you/harness",JSON.stringify({rail:480,shelf:500}))')
 ab('open','http://127.0.0.1:'+port+'/harness.html?seed=bubbles&renderer=dom')
 wait('!!document.querySelector(\'.rail-row[data-id="runner"]\')');ev('document.querySelector(\'.rail-row[data-id="runner"]\').click()')
 wait('!!document.querySelector(\'button.terminal-tab[data-bubble="101"]\')');activate();settleOutput();snap('stress-minimum')
 ev('sessionStorage.clear(); localStorage.removeItem("roundup:widths:/Users/you/harness")')
 ab('set','viewport','1512','950');ab('open','http://127.0.0.1:'+port+'/harness.html?seed=bubbles&renderer=dom')
 wait('!!document.querySelector(\'.rail-row[data-id="dense"]\')');ev('document.querySelector(\'.rail-row[data-id="dense"]\').click()')
 wait('!!document.querySelector(\'button.terminal-tab[data-bubble="110"]\')')
 ev('document.querySelector(\'button.terminal-tab[data-bubble="110"]\').click()')
 wait('document.activeElement?.closest(\'.bubble[data-bubble="110"]\') !== null')
 ev('window.__fake.writeOutput("t-dense",Array.from({length:150},(_,i)=>"Agent changing line "+i+String.fromCharCode(13,10)).join(""))')
 ev('document.querySelector(".terminal-new").focus();window.__fake.failNext(-32003,"Could not open Terminal: retry when the command finishes");document.querySelector(".terminal-new").click()')
 wait('!!document.querySelector(".bubble-failure")');snap('dense-failure')
 print(side,'minimum and failure',flush=True)
finally:
 ab('close')
 shutil.rmtree(profile,ignore_errors=True)
