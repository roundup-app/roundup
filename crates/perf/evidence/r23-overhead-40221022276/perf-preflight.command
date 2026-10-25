cwd: /tmp/r23-overhead
$ sudo -n perf record -a -e sched:sched_switch -o /tmp/overhead-preflight.data -- true
