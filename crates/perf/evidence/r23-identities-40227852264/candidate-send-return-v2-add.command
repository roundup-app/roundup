cwd: /tmp/r23-native-identities
$ sudo -n sh -c 'printf "%s\n" "$1" >> /sys/kernel/tracing/uprobe_events' sh 'r:r23i/candidate_send_return /tmp/r23-queue-bins/candidate-instrumented-rupd:0x1432c90'
