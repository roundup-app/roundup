cwd: /tmp/r23-overhead
$ bash -c 'date -u --iso-8601=ns; uname -a; cat /etc/os-release; lscpu; nproc; cat /proc/self/status; uptime; ps -eo pid,ppid,comm,pcpu,pmem,args --sort=-pcpu; perf --version; cat /proc/sys/kernel/perf_event_paranoid'
