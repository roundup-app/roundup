cwd: /tmp/r23-work
$ sudo -n perf record -a --clockid mono -e sched:sched_switch,sched:sched_waking,sched:sched_wakeup,syscalls:sys_enter_read,syscalls:sys_exit_read,syscalls:sys_enter_write,syscalls:sys_exit_write -o /tmp/r23-kernel-preflight.data -- true
