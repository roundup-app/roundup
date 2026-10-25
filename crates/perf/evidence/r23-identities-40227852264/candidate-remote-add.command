cwd: /tmp/r23-native-identities
$ sudo -n sh -c 'printf "%s\n" "$1" >> /sys/kernel/tracing/uprobe_events' sh 'p:r23i/candidate_remote /tmp/r23-queue-bins/candidate-instrumented-rupd:0x170e3a0 task=%si:u64 vtable=+16(%si):u64 idoff=+72(+16(%si)):u64 id48=+48(%si):u64 id56=+56(%si):u64 id64=+64(%si):u64'
