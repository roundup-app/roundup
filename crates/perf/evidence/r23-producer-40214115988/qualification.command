cwd: /tmp/r23-work
$ bash -c '. /etc/os-release
model=$(LC_ALL=C lscpu | sed -n '"'"'s/^Model name:[[:space:]]*//p'"'"')
printf '"'"'Recorded CPU: %s
'"'"' "$model"
[ -n "$model" ] && [ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] && [ "$(uname -m)" = x86_64 ] && [ "$(nproc)" = 4 ] && [ "$(cat /sys/devices/system/cpu/online)" = 0-3 ] && [ "$(awk '"'"'/^Cpus_allowed_list:/ {print $2}'"'"' /proc/self/status)" = 0-3 ]
'
