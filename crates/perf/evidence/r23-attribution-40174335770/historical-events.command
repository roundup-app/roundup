cwd: /tmp/roundup-r23
$ perf script -i /tmp/r23-raw/historical.data --show-task-events --show-mmap-events --show-switch-events -G -F comm,pid,tid,time,event,ip,sym,dso
