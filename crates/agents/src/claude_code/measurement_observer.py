#!/usr/bin/env python3
"""U3016 source observer: run after pnpm install and cargo build -p rupd -p rup.
Fresh HOME/config/Project, dummy key and loopback responses; production launch, Adapter,
journal and user CLI reads. No subscription credential or real-model inference.
Only counts and source timing projections are printed (no token or money is read); disposable local files stay private.
"""
import http.server,threading,json,subprocess,os,pathlib,tempfile,time,socket,sys,hashlib
repo=pathlib.Path(__file__).resolve().parents[4]
root=pathlib.Path(tempfile.mkdtemp(prefix='u3016-production-'))
for part in ('home','config','project','data'): (root/part).mkdir()
records=[]
exports=[]
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if self.path=='/v1/traces':
   import urllib.request
   exports.append({'received':time.time_ns(),'body':body})
   target=(root/'trace-endpoint').read_text()
   response=urllib.request.urlopen(urllib.request.Request(target,json.dumps(body).encode(),{'Content-Type':'application/json'}))
   data=response.read();self.send_response(response.status);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
  if 'messages' not in self.path:self.send_response(404);self.end_headers();return
  n=len(records)+1
  records.append({'n':n,'received':time.time_ns()})
  text=json.dumps(body.get('messages',[])[-1:])
  if 'observe-source-child-3016' in text and 'tool_result' not in text:content=[{'type':'text','text':'Child measured.'}]
  elif n==1:content=[{'type':'tool_use','id':'toolu_source_3016','name':'Agent','input':{'description':'Observe local measurement','prompt':'observe-source-child-3016','subagent_type':'general-purpose'}}]
  else:content=[{'type':'text','text':'Measurement observation complete.'}]
  usage={f'{k}_tokens':0 for k in ('input','output')}  # the vendor client requires the fields on the wire
  msg={'id':f'msg_source_{n}','type':'message','role':'assistant','model':body['model'],'content':[],'stop_reason':None,'stop_sequence':None,'usage':usage}
  events=[('message_start',{'type':'message_start','message':msg})]
  for i,block in enumerate(content):
   start={**block};start['input' if block['type']=='tool_use' else 'text']={} if block['type']=='tool_use' else ''
   delta={'type':'input_json_delta','partial_json':json.dumps(block['input'])} if block['type']=='tool_use' else {'type':'text_delta','text':block['text']}
   events.extend([('content_block_start',{'type':'content_block_start','index':i,'content_block':start}),('content_block_delta',{'type':'content_block_delta','index':i,'delta':delta}),('content_block_stop',{'type':'content_block_stop','index':i})])
  events.extend([('message_delta',{'type':'message_delta','delta':{'stop_reason':'tool_use' if content[0]['type']=='tool_use' else 'end_turn','stop_sequence':None},'usage':usage}),('message_stop',{'type':'message_stop'})])
  data=''.join(f'event: {event}\ndata: {json.dumps(value)}\n\n' for event,value in events).encode()
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('request-id',f'req_source_{n}');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  records[-1]['response_end']=time.time_ns()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}'
binary=repo/'node_modules/@anthropic-ai/claude-code/bin/claude.exe'
wrapper=root/'claude'
wrapper.write_text('''#!/usr/bin/env python3
import os,sys,subprocess,pathlib
binary=%r
args=sys.argv[1:]
env=os.environ.copy()
if args[:2] not in [['plugin','list'],['plugin','test']]:
 args+=['-p','observe-source-parent-3016','--allowedTools','Agent','--output-format','json']
 with open(%r,'w') as sink: sink.write(env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'])
 env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']=%r+'/v1/traces'
 env.update(ANTHROPIC_API_KEY='sk-fixture-only',ANTHROPIC_BASE_URL=%r,CLAUDE_CODE_MAX_RETRIES='0',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',DISABLE_AUTOUPDATER='1',CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL='1')
result=subprocess.run([binary]+args,env=env)
if args[:2] not in [['plugin','list'],['plugin','test']]:
 pathlib.Path(%r).write_text(str(result.returncode))
sys.exit(result.returncode)
'''%(str(binary),str(root/'trace-endpoint'),url,url,str(root/'vendor-exit')))
wrapper.chmod(0o755)
config=root/'config'
(config/'settings.json').write_text(json.dumps({'permissions':{'defaultMode':'default'}}))
(config/'.claude.json').write_text(json.dumps({'hasCompletedOnboarding':True,'projects':{str(root/'project'):{'hasTrustDialogAccepted':True}}}))
env={k:v for k,v in os.environ.items() if not k.startswith(('CLAUDE','ANTHROPIC','OTEL','TRACE','ROUNDUP','RUPD'))}
env.update(HOME=str(root/'home'),CLAUDE_CONFIG_DIR=str(config),ROUNDUP_DATA_DIR=str(root/'data'),ROUNDUP_CLAUDE_BIN=str(wrapper),ROUNDUP_RUP_BIN=str(repo/'target/debug/rup'),RUPD_SOCKET=str(root/'rupd.sock'),DISABLE_AUTOUPDATER='1',CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL='1')
err=open(root/'daemon.err','w')
daemon=subprocess.Popen([str(repo/'target/debug/rupd'),str(root/'project'),'--attached'],env=env,stdin=subprocess.PIPE,stderr=err,stdout=subprocess.DEVNULL)
daemon.stdin.write(('roundup-proof 1 '+'0'*64+'\n').encode());daemon.stdin.flush()
def rpc(method,params=None):
 s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(str(root/'rupd.sock'));s.sendall((json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params})+'\n').encode());reply=json.loads(s.makefile().readline());s.close()
 if 'error' in reply:raise RuntimeError(reply['error'])
 return reply['result']
try:
 for _ in range(500):
  try:rpc('daemon.ping');break
  except (OSError,RuntimeError):time.sleep(.02)
 home=rpc('rail.createWorkstream',{'name':'Source observer work'})
 node=rpc('agent.spawn',{'name':'Source observer','cwd':str(root/'project'),'parent':home['id']})
 start=time.monotonic();accepted={};reads=[];last=None
 while time.monotonic()-start<50:
  at=time.perf_counter_ns();last=rpc('project.measurements');reads.append((time.perf_counter_ns()-at)/1e6)
  for c in last['contributions']:accepted.setdefault(c['identity'],time.time_ns())
  intervals=[c for c in last['contributions'] if c['value']['kind']=='interval']
  emitted_spans={f"interval:{span['traceId']}:{span['spanId']}" for batch in exports for resource in batch['body']['resourceSpans'] for scope in resource['scopeSpans'] for span in scope['spans'] if span['name'] in ('claude_code.llm_request','claude_code.tool.execution')}
  if (root/'vendor-exit').exists() and {c['identity'] for c in intervals}==emitted_spans:break
  time.sleep(.02)
 (root/'public.json').write_text(json.dumps(last));(root/'wire-summary.json').write_text(json.dumps(records))
 assert (root/'vendor-exit').read_text()=='0', 'pinned vendor did not complete successfully'
 assert len(records)>=3, 'parent/tool/child exchange did not complete'
 assert len(intervals)==len(records)+1
 assert sum(c['value']['category']=='agent' for c in intervals)==len(records)
 assert sum(c['value']['category']=='tool' for c in intervals)==1
 assert {c['value']['kind'] for c in last['contributions']}=={'interval'}
 span_delay=[c['observed']-int(c['value']['end_unix_ns'])/1e6 for c in intervals]
 raw_spans={}
 arrivals={}
 for batch in exports:
  for resource in batch['body']['resourceSpans']:
   for scope in resource['scopeSpans']:
    for span in scope['spans']:
     identity=f"interval:{span['traceId']}:{span['spanId']}"
     raw_spans[identity]=span;arrivals[identity]=batch['received']
 for c in intervals:
  raw=raw_spans[c['identity']]
  assert raw['name'] in ('claude_code.llm_request','claude_code.tool.execution')
  assert c['value']['start_unix_ns']==str(int(raw['startTimeUnixNano']))
  assert c['value']['end_unix_ns']==str(int(raw['endTimeUnixNano']))
 export_to_read=[(accepted[c['identity']]-arrivals[c['identity']])/1e6 for c in intervals]
 excluded=sorted({span['name'] for identity,span in raw_spans.items() if identity not in accepted})
 cli=subprocess.run([str(repo/'target/debug/rup'),'--json','project','measurements','--agent',str(node['id'])],env=env,capture_output=True,text=True,check=True)
 assert json.loads(cli.stdout)['contributions']==last['contributions']
 daemon.terminate();daemon.wait(timeout=5)
 daemon=subprocess.Popen([str(repo/'target/debug/rupd'),str(root/'project'),'--attached'],env=env,stdin=subprocess.PIPE,stderr=err,stdout=subprocess.DEVNULL)
 daemon.stdin.write(('roundup-proof 1 '+'0'*64+'\n').encode());daemon.stdin.flush()
 for _ in range(500):
  try:
   reopened=rpc('project.measurements')
   break
  except (OSError,RuntimeError):time.sleep(.02)
 assert reopened['contributions']==last['contributions']
 summary=rpc('project.measurementSummary',{'home':home['id']})
 assert summary['rows'][0]['agent']==str(node['id'])
 assert int(summary['time']['execution_ns'])>0 and int(summary['time']['tools_ns'])>0
 dashboard=None
 if '--dashboard' in sys.argv:
  import signal
  profile=root/'browser-profile';profile.mkdir();(profile/'config.json').write_text('{}')
  probe=socket.socket();probe.bind(('127.0.0.1',0));port=probe.getsockname()[1];probe.close()
  vite_env={**env,'ROUNDUP_REAL_PROJECT':str(root/'project'),'ROUNDUP_REAL_PROOF':'0'*64}
  vite_log=open(root/'vite.log','w')
  vite=subprocess.Popen(['pnpm','--filter','desktop','exec','vite','--host','127.0.0.1','--port',str(port),'--strictPort'],cwd=repo,env=vite_env,stdout=vite_log,stderr=vite_log,start_new_session=True)
  browser_env={k:v for k,v in os.environ.items() if not k.startswith('AGENT_BROWSER_')}
  chrome=os.environ.get('CHROME_PATH','/usr/bin/chromium')
  browser_command=['agent-browser','--executable-path',chrome,'--args','--no-sandbox','--config',str(profile/'config.json'),'--session','u3016-pinned-'+str(os.getpid()),'--profile',str(profile)]
  def browser(*args):return subprocess.run(browser_command+list(args),env=browser_env,capture_output=True,text=True,check=True,timeout=60).stdout
  try:
   import urllib.request
   for _ in range(500):
    try:urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/__roundup_ready',timeout=2).read();break
    except OSError:time.sleep(.02)
   browser('set','viewport','1512','950');browser('set','media','dark')
   browser('open','http://127.0.0.1:'+str(port)+'/harness.html?daemon=1&renderer=dom')
   selector='.rail [data-id="'+home['id']+'"] [data-part="branch-control"]'
   browser('wait','--fn','!!document.querySelector('+json.dumps(selector)+')')
   browser('click',selector)
   browser('wait','--fn',"!!document.querySelector('.measurement-action button')")
   browser('click','.measurement-action button')
   browser('wait','--fn',"document.querySelector('.measurement-dashboard')?.getAttribute('aria-busy') === 'false'")
   text=json.loads(browser('eval',"document.querySelector('.measurement-dashboard').textContent"))
   assert 'elapsed' in text and 'Agent time' in text
   dashboard={'reconciliation':'pinned raw -> production collector -> public summary -> real headless App'}
   if 'U3016f' in os.environ.get('ROUNDUP_CAPTURES','').split(','):
    target=repo/'artifacts/ux/U3016f';target.mkdir(parents=True,exist_ok=True)
    browser('screenshot',str(target/'pinned-vendor.png'))
    (target/'pinned-vendor.checks.json').write_text(browser('eval','window.__checks()'))
  finally:
   subprocess.run(browser_command+['close'],env=browser_env,capture_output=True,timeout=20)
   os.killpg(vite.pid,signal.SIGTERM);vite.wait(timeout=10);vite_log.close()
 version=subprocess.run([str(binary),'--version'],env=env,capture_output=True,text=True,check=True).stdout.strip()
 print(json.dumps({'dashboard':dashboard,'binary_version':version,'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'raw_requests':len(records),'model_intervals':sum(c['value']['category']=='agent' for c in intervals),'tool_intervals':1,'raw_completed_spans':len(raw_spans),'excluded_span_names':excluded,'export_arrival_to_public_read_ms':export_to_read,'span_end_to_accept_ms':span_delay,'public_read_max_ms':max(reads),'public_read_p95_ms':sorted(reads)[int(.95*(len(reads)-1))],'read_samples':len(reads),'cli_and_reopen':'same retained contributions','unsupported':'active execution, clock lifetime across restart, human wait and Message-correlated coordination; permission-check spans excluded','local_artifacts':str(root)},indent=2))

finally:
 daemon.terminate()
 try:daemon.wait(timeout=5)
 except subprocess.TimeoutExpired:daemon.kill();daemon.wait()
 server.shutdown()
