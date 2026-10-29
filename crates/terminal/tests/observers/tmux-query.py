import os,sys,tty,select,json
with open(sys.argv[1], 'w') as f:
 tty.setraw(0)
 os.write(1,b'\x1b[c')
 ready,_,_=select.select([0],[],[],2)
 f.write(json.dumps(list(os.read(0,1024)) if ready else [])); f.flush()
