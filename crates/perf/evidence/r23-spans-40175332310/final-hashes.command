cwd: /tmp/r23-correlated-write-spans
$ bash -c 'sha256sum /tmp/r23-span-bins/*; for executable in /tmp/r23-span-bins/*; do readelf -n "$executable"; done'
