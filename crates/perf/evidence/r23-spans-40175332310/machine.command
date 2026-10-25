cwd: /tmp/r23-correlated-write-spans
$ bash -c 'cat /etc/os-release; uname -a; lscpu; nproc; cat /sys/devices/system/cpu/online; cat /proc/self/status; cat /proc/sys/kernel/random/boot_id; rustc -Vv; cargo -V; /bin/bash --version; readlink -f /bin/sh; perf --version; strace --version; bpftrace --version; cat /proc/sys/kernel/perf_event_paranoid'
