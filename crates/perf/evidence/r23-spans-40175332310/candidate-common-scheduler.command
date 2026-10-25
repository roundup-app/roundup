cwd: /tmp/r23-correlated-write-spans
$ sudo -n perf script --ns -i /tmp/r23-candidate-common.data -F comm,pid,tid,cpu,time,event,trace
