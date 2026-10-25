# Validation

| Check | Exit | Result |
|---|---:|---|
| `pnpm install --frozen-lockfile` | 0 | Lockfile respected |
| `just lint-rust` | 0 | Includes ALL PROOFS CHECK |
| `cargo build -p rupd -p rup` | 0 | Native test prerequisites |
| `cargo nextest run -p perf` | 0 | 100 passed, none skipped |
| Initial `just lint-web` | 1 | Raw symbol spellcheck; original output retained |
| Final `just lint-web` | 0 | All lanes pass after lossless retention packing |
| Final `pnpm lint:boundaries` | 0 | Rechecked packed reports |
| `loop/rules.sh merge-loss` | 0 | No main-side file loss |
| `loop/rules.sh vocab` | 0 | Vocabulary unchanged |
| Related Vitest for docs/perf.md | 0 | No related tests; no UI behavior change |
| Capture extraction / physical endpoint replay | 0 | 2200 writes per pin |
| Original offline assessment | 1 | Coincident timestamp assumption; v1 retained |
| Repaired assessment / new boundaries / controls assessment | 0 | All records retained, counts/order checked |

These code/integrity checks are separate from diagnostic scratch-budget exits 1.
No clean R16 verdict, replacement timing campaign or calibrated baseline is claimed.

## Fix run 40217777503

Merged main `056360ee6` without conflicts as `4731156a7`. The failed
[lint-web job](https://github.com/roundup-app/roundup/actions/runs/40216558367/job/121239916065)
reproduces on this merge with `just lint-web` (exit 1):

```text
size: raised size ceiling loop/builder.py: 1455 > 1453
```

Every other web lint command passes. The frozen file equals main; this PR
changes neither it nor the shrinking lint inventory. Existing user-owned repair
[#3937](https://github.com/roundup-app/roundup/issues/3937) now blocks #4032.
This failure prevents the required `pre` gate; it is not a performance result.

`pnpm install --frozen-lockfile`, merge-loss, vocabulary and diff checks pass.
Related Vitest for `docs/perf.md` exits 0 with no related tests.

`just lint-rust` exits 0, including `ALL PROOFS CHECK`. The perf suite runs
103 tests: 100 pass initially, and three launch tests fail because the fresh
checkout lacks `rupd`/`rup`. After `cargo build -p rupd -p rup` (exit 0), the
three-test rerun passes (exit 0): both
`n7_launch_sites_clean_on_success_and_failure` instances and
`r20_perf_workstream_never_starts_real_claude`. All 103 tests therefore pass
with the required local launch prerequisites present. No test is changed.
