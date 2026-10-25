cwd: /tmp/r23-native-identities
$ sudo -n sh -c 'printf "%s\n" "$1" >> /sys/kernel/tracing/uprobe_events' sh 'p:r23i/candidate_send /tmp/r23-queue-bins/candidate-instrumented-rupd:0x1432c90 result=%di:u64 sender=%si:u64 shared=+0(%si):u64 chunk=%dx:u64 arc=+0(%dx):u64 length=+8(%dx):u64 offset=+16(%dx):u64 byte=+16(+0(%dx)):u8'
