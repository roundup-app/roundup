cwd: /tmp/r23-correlated-write-spans
$ sudo -n perf record -a --clockid mono -e sched:sched_switch,sched:sched_waking,sched:sched_wakeup -o /tmp/r23-sched-preflight.data -- true
