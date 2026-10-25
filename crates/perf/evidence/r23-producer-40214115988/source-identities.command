cwd: /tmp/r23-work
$ bash -c 'for ref in historical candidate; do git -C /tmp/r23-$ref rev-parse HEAD; git -C /tmp/r23-$ref show HEAD:Cargo.toml; git -C /tmp/r23-$ref show HEAD:crates/terminal/src/lib.rs; done'
