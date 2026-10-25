cwd: /tmp/r23-correlated-write-spans
$ sudo -n perf script --ns -i /tmp/r23-historical-marked.data -F comm,pid,tid,cpu,time,event,trace
