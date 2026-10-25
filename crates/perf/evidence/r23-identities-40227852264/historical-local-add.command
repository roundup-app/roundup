cwd: /tmp/r23-native-identities
$ sudo -n sh -c 'printf "%s\n" "$1" >> /sys/kernel/tracing/uprobe_events' sh 'p:r23i/historical_local /tmp/r23-queue-bins/historical-instrumented-rupd:0x3c1750 task=%dx:u64 vtable=+16(%dx):u64 idoff=+72(+16(%dx)):u64 id48=+48(%dx):u64 id56=+56(%dx):u64 id64=+64(%dx):u64'
