cwd: /tmp/r23-work
$ sudo -n perf record -a -e sched:sched_switch -o /tmp/r23-preflight-retained.data -- sleep 0.1
