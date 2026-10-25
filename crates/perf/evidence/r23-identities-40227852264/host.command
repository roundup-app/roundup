cwd: /tmp/r23-native-identities
$ bash -c 'date -u --iso-8601=ns; cat /proc/sys/kernel/random/boot_id; cat /etc/os-release; uname -a; lscpu; nproc; cat /proc/self/status; perf version; readelf --version; objdump --version; cat /proc/sys/kernel/perf_event_paranoid'
