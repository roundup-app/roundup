# R16 Rail reply isolation

Work order: #1369. Daemon scope: envelope ownership and connection frame rendering only. Remaining RPC conversion/Client work: prerequisite #1374. No class baseline, noise allowance, load threshold, workload or public contract changes.

```text
Agents presentation → rpc::reply → Daemon envelope → Daemon frame → Client parse → Client result
                      #1374       #1369             #1369           #1374         #1374
```

`examples/r16_reply.rs` uses 40 typed empty Workstream rows and compares both old and repaired Daemon operations in the same release binary. Each operation has 100 warmups and 3,300 recorded samples; median and nearest-rank p95 are printed. Input preparation is outside the measured region. It excludes database/presentation work, scheduling and socket I/O. No timing assertion is a functional test or R16 acceptance gate.

`isolation.txt` is the initial fixture at `8988a5c01fab58a7daf724475eea010775ba19e2`, including output destruction in each clock. `metadata.txt` records that binary's hash and environment. Compilation was active; these are attribution only. `isolation-refined.txt` uses the refined fixture, which stops the clock before output destruction. Scenario tests were active during this refined invocation. Both earlier fixtures label the upper-middle sample as the median; the final fixture averages the two middle samples. Retain both earlier reports; their absolute numbers cannot be compared as identical measurements.

Reproduce from the repository root:

```sh
cargo run --release -p rupd --example r16_reply
rustc -Vv
cargo -V
uname -a
cat /etc/os-release
lscpu
rg Cpus_allowed_list /proc/self/status
cat /proc/loadavg
sha256sum target/release/examples/r16_reply
```

The local runner has Ubuntu 24.04, four online/available CPUs and affinity 0–3, but exact CPU model `Intel(R) Xeon(R) 6973P-C` is outside R16's supported classes. These diagnostics supply no supported-class historical/repaired comparison. Required acceptance remains nine alternating eleven-fresh-Daemon invocations per reference on a supported class with identical compatible historical probe bytes (historical Daemon `1d1618d2d9bb5c0f25ecb6b32de1cde20bfad6d0`, retained probe SHA256 `a35e5a3b16a6169ccb025a955ad382fb0f08ec3f098229604780c993bf7c3558`). Preserve every report, metric/load, exit, hash and exact command, including busy/failed observations and ceiling misses. This PR does not close #1369.

The socket tests transport a typed Rail fixture unchanged, including Unicode/escaping, every presentation field, parent-before-child/sibling order and field order. Separate tests cover complete error envelopes and notification suppression between pipelined replies. Existing owning-module and workspace scenarios cover events, concurrent Clients, A38 reporting, caller hang-up, Agent lifecycle/resume/reopen, bounded Terminal I/O and Message semantics.

`final-1.txt` through `final-3.txt` are three subsequent fixture invocations after `just check` and compilation ended. Their metadata records each start time, source commit, load, fixture hash and exit 0. They remain unsupported-host diagnostics, not eleven-Daemon probe invocations or acceptance observations. Median ranges in µs:

| Operation | Median range |
|---|---:|
| RPC typed-result conversion | 30.5405–30.661 |
| Old Daemon envelope | 31.5685–32.3845 |
| Moved Daemon envelope | 0.166–0.168 |
| Old Daemon frame Display | 25.972–26.333 |
| Direct Daemon frame bytes | 7.494–7.743 |
| Client JSON parsing | 59.171–59.645 |
| Client result cloning | 22.2335–22.6625 |

Exact final fixture commands (repository root):

```sh
cargo clippy -p rupd --example r16_reply -- -D warnings
cargo build --release -p rupd --example r16_reply
for turn in 1 2 3; do
  { date -u +%Y-%m-%dT%H:%M:%SZ; git rev-parse HEAD; cat /proc/loadavg; sha256sum target/release/examples/r16_reply; } > "crates/rupd/evidence/rail-reply/final-$turn-metadata.txt"
  target/release/examples/r16_reply > "crates/rupd/evidence/rail-reply/final-$turn.txt"
  printf 'exit=0\n' >> "crates/rupd/evidence/rail-reply/final-$turn-metadata.txt"
done
```

The production release build command was `cargo build --release -p rupd -p rup` (exit 0); `repaired-release.txt` records its source, toolchain and binary hashes. The Cargo release profile is unchanged. The initial/refined fixture commands were `cargo run --release -p rupd --example r16_reply`, redirected respectively to `/tmp/r16-isolation.txt` and `/tmp/r16-isolation-refined.txt`, with build stderr in `/tmp/r16-build.log` and `/tmp/r16-refined-build.log`; both exit 0.
