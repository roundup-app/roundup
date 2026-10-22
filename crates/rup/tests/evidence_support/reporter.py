import hashlib,json,os,socket,subprocess,sys,time
id=os.environ['ROUNDUP_AGENT']
s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(os.environ['RUPD_SOCKET']);f=s.makefile('rb')
n=0
def wire(method,p):
 global n
 n+=1;s.sendall((json.dumps({'jsonrpc':'2.0','id':n,'method':method,'params':p})+'\n').encode())
 while True:
  r=json.loads(f.readline())
  if r.get('id')==n:return r
def call(method,p):
 r=wire(method,p);assert 'result' in r,r;return r['result']
call('daemon.identify',{'actor':{'kind':'agent','id':id,'parent':None}})
end=time.monotonic()+10
while True:
 ins=call('agent.instructions',{'id':id})
 ds=[d for d in ins['deliveries'] if d['state']=='submitted']
 if ds:break
 assert time.monotonic()<end,'no submitted instruction'
 time.sleep(.01)
project=ins['project'];delivery=ds[-1]['id'];text=b'login output V1'
open(os.path.join(project,'output.txt'),'wb').write(text)
pub=call('deliverable.publish',{'key':'login-v1','title':'Login output','target':{'kind':'file','path':'output.txt'}})
p={'project':project,'id':id,'key':'login-v1','delivery':delivery,'target':{'id':'login','revision':'v1'},'output':{'project':pub['project'],'id':pub['id']},'result':'Implementation retained; repair pending','next':'Repair login; then run final checks','state':'reported','check':{'kind':'publication','sha256':hashlib.sha256(text).hexdigest()}}
if sys.argv[3]=='late-report':call('agent.setOrder',{'id':id,'order':{'kind':'work','ask':'Fix another path','done':'Other path passes','limits':[]}})
if sys.argv[3]=='wrong-digest':p['check']['sha256']='0'*64
if sys.argv[3] in ('complete','document'):p['next']=''
cmd=[sys.argv[1],'message','report',project,id,p['key'],delivery,p['result'],p['next'],'--target',json.dumps(p['target']),'--output',json.dumps(p['output']),'--state',json.dumps(p['state']),'--check',json.dumps(p['check']),'--json']
a=subprocess.run(cmd,capture_output=True,text=True);assert a.returncode==0,(cmd,a.stdout,a.stderr)
report=json.loads(a.stdout);replay=call('message.report',p);assert report==replay
bad=[]
for field,value in [('result','conflicting retry'),('project','/wrong-project'),('id','1'),('delivery','999999')]:
 q={**p,field:value};bad.append(wire('message.report',q))
# Neither identifying as the user nor supplying authority fields can forge acceptance/verifier facts.
call('daemon.identify',{'actor':{'kind':'user','id':'you','parent':None}})
bad.append(wire('message.acceptResult',{'project':project,'id':id,'report':report['report'],'evidence':'forged user'}))
bad.append(wire('message.verifyResult',{'project':project,'id':id,'report':report['report'],'verdict':'passed'}))
call('daemon.identify',{'actor':{'kind':'agent','id':id,'parent':None}})
bad.append(wire('message.progress',{'project':project,'id':'1'}))
if sys.argv[3]=='document':
 for t,nx in [('outline',''),('document',''),('diagram','Prepare the diagram'),('export','')]:
  b=(t+' r1').encode();open(os.path.join(project,'output.txt'),'wb').write(b)
  o=call('deliverable.publish',{'key':t,'title':t,'target':{'kind':'file','path':'output.txt'}})
  call('message.report',{**p,'key':t,'target':{'id':t,'revision':'r1'},'output':{'project':o['project'],'id':o['id']},'next':nx,'check':{'kind':'publication','sha256':hashlib.sha256(b).hexdigest()}})
# Three uncertain external effects use unsupported sources and cannot be resolved by a report.
effects=[]
for effect in ['deployment','payment','push']:
 with open(sys.argv[2]+'.effects','a') as calls:calls.write(effect+'\n')
 q={**p,'key':effect,'target':{'id':effect,'revision':'v1'},'state':'unknown-effect','check':{'kind':'unsupported','source':effect}}
 effects.append(call('message.report',q))
 if sys.argv[3]=='effect-claim':
  call('message.report',{**q,'key':effect+'-claim','state':'reported','check':p['check']})
bad.append(wire('message.resolveResult',{'project':project,'id':id,'report':effects[0]['report'],'source':'http://127.0.0.1:9/receipt'}))
a=subprocess.run([sys.argv[1],'message','resolve-result',project,id,effects[0]['report'],'http://127.0.0.1:9/receipt','--json'],capture_output=True,text=True)
assert a.returncode==1 and 'only the user' in a.stderr,(a.returncode,a.stdout,a.stderr)
if sys.argv[3]=='replace':
 q={**p,'key':'unchanged','target':{'id':'unchanged','revision':'v1'}}
 call('message.report',q)
 for key,revision,contents in [('replacement','v2',b'login output V2'),('equal-bytes','v1',text)]:
  open(os.path.join(project,'output.txt'),'wb').write(contents)
  output=call('deliverable.publish',{'key':key,'title':'Login output','target':{'kind':'file','path':'output.txt'}})
  q={**p,'key':key,'target':{'id':'login','revision':revision},'output':{'project':output['project'],'id':output['id']},'check':{'kind':'publication','sha256':hashlib.sha256(contents).hexdigest()}}
  call('message.report',q)
open(sys.argv[2],'w').write(json.dumps({'report':report,'request':p,'bad':bad,'effects':effects}))
call('message.send',{'to':'you','kind':'note','body':'evidence-ready'})
