cwd: /tmp/r23-overhead
$ bash -c 'for executable in /tmp/r23-queue-bins/*; do if test -f "$executable"; then sha256sum "$executable"; readelf -n "$executable"; fi; done'
