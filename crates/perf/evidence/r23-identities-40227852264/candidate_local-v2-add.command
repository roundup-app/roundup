cwd: /tmp/r23-native-identities
$ sudo -n sh -c 'printf "%s\n" "$1" >> /sys/kernel/tracing/uprobe_events' sh 'p:r23i/candidate_local /tmp/r23-queue-bins/candidate-instrumented-rupd:0x000000000170e000 task=%dx:u64 vtable=+16(%dx):u64 idoff=+72(+16(%dx)):u64 id48=+48(%dx):u64 id56=+56(%dx):u64 id64=+64(%dx):u64 id40=+40(%dx):u64'
