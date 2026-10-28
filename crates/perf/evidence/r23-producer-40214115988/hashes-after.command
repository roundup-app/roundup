cwd: /tmp/r23-work
$ bash -c 'sha256sum /tmp/r23-queue-bins/*; for executable in /tmp/r23-queue-bins/*; do readelf -n "$executable"; done'
