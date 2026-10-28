cwd: /tmp/r23-work
$ bash -c 'cat /etc/os-release; uname -m; lscpu; nproc; cat /sys/devices/system/cpu/online; sed -n /Cpus_allowed_list/p /proc/self/status; cat /proc/sys/kernel/random/boot_id'
