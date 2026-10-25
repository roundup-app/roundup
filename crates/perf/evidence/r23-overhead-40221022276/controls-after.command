cwd: /tmp/r23-overhead
$ bash -c 'date -u --iso-8601=ns; cat /proc/sys/kernel/random/boot_id; uptime; ps -eo pid,ppid,comm,pcpu,pmem,args --sort=-pcpu'
