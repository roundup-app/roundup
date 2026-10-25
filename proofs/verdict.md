# V1–V3 verdict adoption

Bend [2.0.39](https://github.com/bendlang/bend/releases/tag/v2.0.39), published
2026-10-23T21:40:41Z, was the newest published Bend 2 release checked on
2026-10-25. Before changing the pin, the complete unchanged proof passed its
`--verdict` with Lean 4.34.0 (exit 0, exactly `ALL PROOFS CHECK`). No compatibility
repair was needed after #3886's coordinated event rename.

All four release tarballs were downloaded in full. Python's SHA-256 over their
bytes equalled both `BEND_SHA256` and each asset's `digest` from
`GET /repos/bendlang/bend/releases/tags/v2.0.39`:

| Asset (`bend-2.0.39-…tar.gz`) | SHA-256 |
| --- | --- |
| darwin-arm64 | `d4aaef68de545727429ce83b9e88ff3273bf068df599e3542e446755b5f3d83a` |
| darwin-x64 | `a512cfd1d29ec24c640126a6a640e597b4ea1abe0aefbda7cc57efd85ab56e22` |
| linux-arm64 | `71b43e1bb9313dd14ac2b0553b854e41c39d65ecaa47040796ebff4a46f54a97` |
| linux-x64 | `6cf462fd8f70b094a4950ebb709a9c4ffd8f1d1189d9cedf1fd63cd5d041c7ab` |

`setup.sh` uses elan's supported noninteractive installer flags, with no shell
startup edits or default-toolchain selection. It installs
`leanprover/lean4:v4.34.0`, resolves its executable using `ELAN_TOOLCHAIN` and
`elan which lean`, then checks that executable's version. Both installed versions
are checked on every setup. To replace an older local Bend after a pin update,
remove the git-ignored `proofs/.tools/bend` and rerun `just proofs-setup`; a
mismatched executable is refused rather than silently used.

The selected Bend's [kernel interface](https://github.com/bendlang/bend/blob/v2.0.39/bend2/safe.ts)
uses `~/.elan/toolchains/leanprover--lean4---v4.34.0/bin`, compiles `bendtt.lean`
with `lean -c` and `leanc -O3 -DNDEBUG`, and caches the executable by source and
Lean version. Its CLI emits `ALL PROOFS CHECK` only after `safe_check` succeeds.
The observer requires that exact line and exit 0 from each separate invocation:

```text
ordinary proof → --verdict → eight mutation refusals → final pass
```

The laws remain byte-for-byte unchanged, SHA-256
`b89c08f05cfa3154ed066ac6ec99c0a198fa36ae11ec87ba60699393f79a923b`.
No model, predicate, transition guard, proof or mutant changed. The real observer
still rejects m1 at `send_auto_inv`, m4 at `fl_go4`, m5 at `drop_q_inv`, m6 at
`exit_inv`, m7 at `send_ev7`, m9 at `restart_replay`, m10 at `fgo_alive10`, and
b39 at `fconfirm_inv`. These proofs cover the model, not Rust.

The fake-tool seam now covers the V1/V2 failure tables and ordered success.
The copied-pin test was removed: pin selection is review policy, with release
evidence above. The synthetic extra-law case duplicated the existing deleted
`def Laws` refusal; that existing test remains. The separate “mismatch installs
nothing” assertion specified no scenario clause; the named mismatch refusal
remains. Clean-layout success is replaced by ordered ordinary/kernel/mutation
success. Stale/missing mutation files use fake Bend with the real mutation
runner; the genuine wrong-guard probe runs only m5, and the full real observer
still proves every mutant's intended failure.

Measurements on the same Linux x64 host (kernel 6.17.0-1022-azure, AMD EPYC
9V45, four logical CPUs), using `/usr/bin/time -p`. Bend binaries and the Lean
toolchain were already installed for the sequential full-run comparison; only
the kernel cache state differs. Full runs include the regression suite and the
final real observer, with no proof skipped.

| Command | Revision | Tools | Kernel state | Wall seconds | Exit |
| --- | --- | --- | --- | ---: | ---: |
| `just proofs` before | `e65989178` | Bend 2.0.34 | never invoked | 22.30 | 0 |
| `just proofs` after | `43d24b9f0` | Bend 2.0.39 / Lean 4.34.0 | empty cache, builds kernel | 32.87 | 0 |
| `just proofs` after | `43d24b9f0` | same | cached | 12.80 | 0 |
| Complete proof `--verdict`, before adopting pin | proof at `e65989178` | same | first kernel build | 35.23 | 0 |
| Standalone kernel rebuild, upstream `lean -c` then `leanc -O3 -DNDEBUG` | release v2.0.39 source | Lean 4.34.0 | fresh build directory | 55.24 | 0 |

The last two observations overlapped other investigations/Rust compilation;
they report first-build and compiler costs separately, not the sequential
comparison. An earlier baseline full run under contention took 39.19 seconds
(exit 0). The sequential comparison above ran after that compilation finished.
Both after-runs printed the eight intended mutation locations and the final
`ALL PROOFS CHECK`. The cached total also benefits from removing repeated real
mutation-runner tests; it is not an isolated estimate of the verdict's overhead.

Actual tools: `bend 2.0.39`; `elan 4.2.4 (227caca13 2026-08-25)`;
`Lean (version 4.34.0, x86_64-unknown-linux-gnu, commit
293d5d0c0c3f3dded4688b3ccd6a33939ac5102b, Release)`.
The exact kernel cache key was `e951a3ff12c837f2`; only this run's directory was
moved aside for the cold after-run.

CI already calls `just proofs-setup` in `check.yml`'s Rust lanes, and
`pre.yml`'s `just lint-rust` reaches `just proofs`, whose prerequisite is the
same noninteractive setup. No workflow change is necessary. The measured cold
full gate uses 32.87 of that existing lint job's 900 seconds. Local
`just lint-web`, `just lint-rust`, `loop/rules.sh vocab`, and
`loop/rules.sh merge-loss` pass. CI remains the integration observer before
merge; neither its limit nor any proof selection was changed.
