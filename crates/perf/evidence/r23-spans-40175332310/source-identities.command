cwd: /tmp/r23-correlated-write-spans
$ bash -c 'git -C /tmp/r23-historical rev-parse HEAD; git -C /tmp/r23-historical diff --exit-code; git -C /tmp/r23-candidate rev-parse HEAD; git -C /tmp/r23-candidate diff --exit-code; sha256sum /tmp/r23-historical/Cargo.lock /tmp/r23-candidate/Cargo.lock'
