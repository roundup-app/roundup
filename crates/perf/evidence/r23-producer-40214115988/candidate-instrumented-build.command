cwd: /tmp/r23-candidate
$ env CARGO_TARGET_DIR=/tmp/r23-queue-hook-target 'RUSTFLAGS=--cfg tokio_unstable' CARGO_PROFILE_RELEASE_DEBUG=1 CARGO_PROFILE_RELEASE_STRIP=none cargo build --release -p rupd
