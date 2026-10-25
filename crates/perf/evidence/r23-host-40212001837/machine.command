cwd: /tmp/roundup-r23-40212001837
$ set -e
date -u --iso-8601=seconds
cat /etc/os-release
uname -a
LC_ALL=C lscpu
cat /sys/devices/system/cpu/online
nproc
sed -n 's/^Cpus_allowed_list:[[:space:]]*//p' /proc/self/status
cat /proc/loadavg
ps -eo pid,ppid,comm,pcpu,pmem,stat --sort=-pcpu
rustc -Vv
cargo -V
printf 'shell=%s\n' "$SHELL"
bash --version
python3 --version
git rev-parse HEAD
