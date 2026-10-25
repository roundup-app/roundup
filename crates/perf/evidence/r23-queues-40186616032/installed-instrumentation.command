cwd: /tmp/r23-work
$ bash -c 'rg -n '"'"'tokio|tracing|libc|rustix'"'"' Cargo.toml crates/rupd/Cargo.toml Cargo.lock; rg -n '"'"'on_before_task_poll|on_after_task_poll|on_thread_park'"'"' /home/runner/.cargo/registry/src/*/tokio-*/src/runtime/builder.rs; perf version; bpftrace --version; sudo -n cat /sys/kernel/tracing/events/syscalls/sys_enter_write/format'
