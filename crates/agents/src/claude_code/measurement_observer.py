#!/usr/bin/env python3
"""U3016 source observer: run after pnpm install and cargo build -p rupd -p rup.
Fresh HOME/config/Project, dummy key and loopback responses; production launch, Adapter,
journal and user CLI reads. No subscription credential or real-model inference.
Only counts and source timing projections are printed; disposable local files stay private.
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
  usage={'input_tokens':100*n,'output_tokens':20*n,'cache_read_input_tokens':400*n,'cache_creation_input_tokens':50*n,'cache_creation':{'ephemeral_5m_input_tokens':50*n,'ephemeral_1h_input_tokens':0}}
  msg={'id':f'msg_source_{n}','type':'message','role':'assistant','model':body['model'],'content':[],'stop_reason':None,'stop_sequence':None,'usage':{**usage,'output_tokens':0}}
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
import os,sys
binary=%r
args=sys.argv[1:]
env=os.environ.copy()
if args[:2] not in [['plugin','list'],['plugin','test']]:
 args+=['-p','observe-source-parent-3016','--allowedTools','Agent','--output-format','json']
 with open(%r,'w') as sink: sink.write(env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'])
 env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']=%r+'/v1/traces'
 env.update(ANTHROPIC_API_KEY='sk-fixture-only',ANTHROPIC_BASE_URL=%r,CLAUDE_CODE_MAX_RETRIES='0',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1',DISABLE_AUTOUPDATER='1',CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL='1')
os.execve(binary,[binary]+args,env)
'''%(str(binary),str(root/'trace-endpoint'),url,url))
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
 node=rpc('agent.spawn',{'name':'Source observer','cwd':str(root/'project')})
 start=time.monotonic();accepted={};reads=[];last=None
 while time.monotonic()-start<50:
  at=time.perf_counter_ns();last=rpc('project.measurements');reads.append((time.perf_counter_ns()-at)/1e6)
  for c in last['contributions']:accepted.setdefault(c['identity'],time.time_ns())
  requests=[c for c in last['contributions'] if c['value']['kind']=='request']
  intervals=[c for c in last['contributions'] if c['value']['kind']=='interval']
  if len(requests)>=4 and any(c['value']['category']=='tool' for c in intervals):break
  time.sleep(.02)
 (root/'public.json').write_text(json.dumps(last));(root/'wire-summary.json').write_text(json.dumps(records))
 totals={key:sum(c['value']['usage'][key] for c in requests) for key in ('input','output','cache_read','cache_write')}
 assert totals=={'input':1000,'output':200,'cache_read':4000,'cache_write':500}, totals
 assert len(requests)==4 and len(intervals)==5
 assert sum(c['value']['category']=='agent' for c in intervals)==4
 assert sum(c['value']['category']=='tool' for c in intervals)==1
 local={}
 locations={}
 for path in config.glob('projects/**/*.jsonl'):
  for line in path.read_text().splitlines():
   row=json.loads(line)
   if row.get('type')=='assistant' and row.get('requestId'):
    local[row['requestId']]=row
    locations[row['requestId']]=path.parent.name=='subagents'
 assert set(local)=={f'req_source_{n}' for n in range(1,5)}
 assert sum(locations.values())==1, locations
 import datetime
 local_delay=[]
 for contribution in requests:
  row=local[contribution['identity'].removeprefix('request:')]
  n=int(row['requestId'].rsplit('_',1)[1])
  expected={'input':100*n,'output':20*n,'cache_read':400*n,'cache_write':50*n}
  assert contribution['value']['usage']==expected
  raw=row['message']['usage']
  assert [raw[k] for k in ('input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens')]==list(expected.values())
  source_at=datetime.datetime.fromisoformat(row['timestamp'].replace('Z','+00:00')).timestamp()*1000
  local_delay.append(contribution['observed']-source_at)
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
 version=subprocess.run([str(binary),'--version'],env=env,capture_output=True,text=True,check=True).stdout.strip()
 print(json.dumps({'binary_version':version,'binary_sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'raw_requests':len(records),'local_requests':len(local),'accepted_requests':len(requests),'model_intervals':4,'tool_intervals':1,'raw_completed_spans':len(raw_spans),'excluded_span_names':excluded,'export_arrival_to_public_read_ms':export_to_read,'totals':totals,'record_timestamp_to_accept_ms':local_delay,'span_end_to_accept_ms':span_delay,'public_read_max_ms':max(reads),'public_read_p95_ms':sorted(reads)[int(.95*(len(reads)-1))],'read_samples':len(reads),'cli_and_reopen':'same retained contributions','unsupported':'active execution, clock lifetime across restart, human wait and Message-correlated coordination; permission-check spans excluded','local_artifacts':str(root)},indent=2))

finally:
 daemon.terminate()
 try:daemon.wait(timeout=5)
 except subprocess.TimeoutExpired:daemon.kill();daemon.wait()
 server.shutdown()
