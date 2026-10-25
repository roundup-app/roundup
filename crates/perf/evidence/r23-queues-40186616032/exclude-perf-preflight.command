cwd: /tmp/r23-work
$ sudo -n perf record -a --clockid mono -e syscalls:sys_enter_write --exclude-perf -e syscalls:sys_exit_write --exclude-perf -o /tmp/r23-exclude-preflight.data -- true
