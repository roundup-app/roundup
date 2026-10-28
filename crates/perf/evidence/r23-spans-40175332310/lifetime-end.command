cwd: /tmp/r23-correlated-write-spans
$ bash -c 'cat /proc/sys/kernel/random/boot_id; lscpu; nproc; cat /sys/devices/system/cpu/online; sed -n /Cpus_allowed_list/p /proc/self/status; sha256sum /tmp/r23-span-bins/*'
