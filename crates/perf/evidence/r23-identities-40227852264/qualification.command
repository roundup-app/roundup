cwd: /tmp/r23-native-identities
$ bash -c '. /etc/os-release; test "$ID:$VERSION_ID" = ubuntu:24.04 && test "$(uname -m)" = x86_64 && test "$(nproc)" = 4 && test "$(cat /sys/devices/system/cpu/online)" = 0-3 && test "$(awk '"'"'/^Cpus_allowed_list:/ {print $2}'"'"' /proc/self/status)" = 0-3'
