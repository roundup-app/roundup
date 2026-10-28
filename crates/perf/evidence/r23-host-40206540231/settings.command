cwd: /tmp/roundup-r23-40206540231
$ set -e
printf 'shell=%s\n' "$SHELL"
for key in RUSTFLAGS CARGO_ENCODED_RUSTFLAGS CARGO_BUILD_TARGET CARGO_PROFILE_RELEASE_DEBUG CARGO_PROFILE_RELEASE_LTO CARGO_BUILD_JOBS; do printf '%s=%s\n' "$key" "${!key-<unset>}"; done
perf --version
bpftrace --version
