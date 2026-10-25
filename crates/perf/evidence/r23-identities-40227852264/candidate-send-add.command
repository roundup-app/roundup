cwd: /tmp/r23-native-identities
$ sudo -n sh -c 'printf "%s\n" "$1" >> /sys/kernel/tracing/uprobe_events' sh 'p:r23i/candidate_send /tmp/r23-queue-bins/candidate-instrumented-rupd:0x1432c90 result=%di:u64 sender=%si:u64 chunk=%dx:u64 word0=+0(%dx):u64 word8=+8(%dx):u64 word16=+16(%dx):u64'
