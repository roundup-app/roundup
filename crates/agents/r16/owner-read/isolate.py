import os,sys,socket,json,time,tempfile,subprocess,statistics,pathlib,hashlib
binary=sys.argv[1]; dest=pathlib.Path(sys.argv[2]); reports=[]
def p95(v):return sorted(v)[int(len(v)*.95)-1]
for turn in range(3):
 with tempfile.TemporaryDirectory() as d:
  sock=d+'/rupd.sock'; env=dict(os.environ,RUPD_SOCKET=sock,XDG_DATA_HOME=d+'/data')
  log=open(str(dest)+f'-{turn}.stderr','w')
  child=subprocess.Popen([binary,d],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=log)
  try:
   for _ in range(10000):
    try:s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(sock);break
    except OSError:s.close();time.sleep(.001)
   reader=s.makefile('rb'); serial=0; events=[]
   def ask(method,params=None):
    global serial
    serial+=1;s.sendall((json.dumps(dict(jsonrpc='2.0',id=serial,method=method,params=params))+'\n').encode())
    while True:
     r=json.loads(reader.readline())
     if r.get('id')==serial:
      if 'error' in r:raise Exception(r)
      return r['result']
     events.append(r)
   def sample(method,params=None):
    vals=[]
    for i in range(1100):
     start=time.perf_counter_ns();ask(method,params);elapsed=(time.perf_counter_ns()-start)/1e6
     if i>=100:vals.append(elapsed)
    return dict(p50=statistics.median(vals),p95=p95(vals),values=vals)
   result=dict(load=os.getloadavg(),measurements={})
   for count in [0,40]:
    if count:
     for i in range(count):ask('rail.createWorkstream',dict(name=f'g{i}',parent=None))
    result['measurements'][f'ping-{count}']=sample('daemon.ping')
    result['measurements'][f'tree-{count}']=sample('rail.tree')
   ask('events.subscribe'); tid=ask('terminal.spawn',dict(cwd=d,command=['/bin/sh','-c','stty raw -echo; echo ready; exec cat'],env={},cols=80,rows=24))['id']
   def echo():
    while True:
     if events:r=events.pop(0)
     else:r=json.loads(reader.readline())
     if r.get('method')=='event' and r['params'].get('type')=='terminal.output':return
   # Event serde uses method field? inspect and allow matching id anywhere
   def echo():
    while True:
     r=events.pop(0) if events else json.loads(reader.readline())
     if r.get('method')=='event' and str(tid) in json.dumps(r) and ('terminal.output' in json.dumps(r)):return
   echo()
   for actor in ['user','ext','user']:
    ask('daemon.identify',dict(actor=dict(kind=actor,id=actor,parent=None)))
    vals=[]
    for i in range(1100):
     start=time.perf_counter_ns();ask('terminal.write',dict(id=tid,data='YQ==')); elapsed=(time.perf_counter_ns()-start)/1e6;echo()
     if i>=100:vals.append(elapsed)
    result['measurements'][f'write-{actor}-{len(result["measurements"])}']=dict(p50=statistics.median(vals),p95=p95(vals),values=vals)
   reports.append(result)
  finally:
   child.terminate();child.wait(timeout=10);log.close()
 dest.write_text(json.dumps(dict(binary=binary,sha256=hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),reports=reports),indent=2))
 print(json.dumps({k:{m:{q:v[q] for q in ['p50','p95']} for m,v in r['measurements'].items()} for k,r in enumerate(reports)}))
