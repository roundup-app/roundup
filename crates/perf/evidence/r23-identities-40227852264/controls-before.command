cwd: /tmp/r23-native-identities
$ bash -c 'date -u --iso-8601=ns; cat /proc/sys/kernel/random/boot_id; cat /proc/loadavg; ps -eo pid,ppid,comm,pcpu,pmem,args --sort=-pcpu'
