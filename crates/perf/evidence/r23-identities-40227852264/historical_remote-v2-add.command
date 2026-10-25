cwd: /tmp/r23-native-identities
$ sudo -n sh -c 'printf "%s\n" "$1" >> /sys/kernel/tracing/uprobe_events' sh 'p:r23i/historical_remote /tmp/r23-queue-bins/historical-instrumented-rupd:0x00000000003c1af0 task=%si:u64 vtable=+16(%si):u64 idoff=+72(+16(%si)):u64 id48=+48(%si):u64 id56=+56(%si):u64 id64=+64(%si):u64 id40=+40(%si):u64'
