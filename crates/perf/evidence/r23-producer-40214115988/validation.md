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
