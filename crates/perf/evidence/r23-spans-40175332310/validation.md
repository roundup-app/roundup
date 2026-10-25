# Validation

| Command | Exit | Result |
|---|---:|---|
| `pnpm install` | 0 | Dependencies installed before pushing |
| `cargo build -p rupd -p rup` | 0 | Real-executable test prerequisites built |
| `cargo nextest run -p perf` | 0 | 97 passed, none skipped |
| `just lint-rust` | 0 | Full Rust lints, including proofs; repeated after clean main merge |
| `just lint-web`, first attempt | 1 | Scanner read a trace while compression removed its plain-text path; compressed raw bytes retained |
| `just lint-web`, second attempt | 1 | docs/perf.md reached 1026 newlines; reduced conclusion with full evidence linked |
| `just lint-web`, final attempt | 0 | Full web lints pass; docs/perf.md has 997 newlines |
| `loop/rules.sh vocab` | 0 | Vocabulary preserved |
| `loop/rules.sh merge-loss` | 0 | Clean main merge; no unrelated file changed by resolution |
| `git diff origin/main --check` | 0 | Raw context patches retained compressed, preserving their exact bytes |
| `python3 /tmp/r23-analyze.py` | 0 | Both loops, warmups and all 2200 request/echo identities per marked observation reconcile; compressed-input replay passes |
| `python3 /tmp/r23-cpu.py` | 0 | Per-TID switch intervals reconcile; per-loop measured/warmup summaries retained |
| `python3 /tmp/r23-scheduling-example.py` | 0 | Same-write scheduler/syscall example correlation |
| Compressed SHA-256 and tar-member verification | 0 | Every compressed evidence checksum and all eight executable hashes match |

`validation-*.log.gz` retains complete install/lint/test output, including failed
web attempts. No test file changes or synthetic timing acceptance tests. Test
execution is separate from the diagnostic recordings and original clean pairs.
The merge of main has no conflict resolutions; CI judges the final push.
