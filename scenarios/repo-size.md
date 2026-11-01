# Repository size

Module: `.gitignore`, `crates/perf/evidence/`, `artifacts/`, `docs/`, `scenarios/perf.md`, `tools/lint/debt.json`

Scope: a checkout of `main` costs seconds, not a minute, because the tracked tree holds no run output nothing reads. Source: #5455, where checkout took 40–72 s per `check` job on a 2.58 GB tree of 21,116 files, nearly all evidence. Evidence stays in the GitHub Actions artifact of the job that produced it (R4132a in `scenarios/perf.md`); no history rewrite and no new CI lane.

**SZ5455a the tracked tree is small.** Given the merged tree, when `git ls-tree -r -l HEAD | awk '{s+=$4} END {print s}'` runs, then it prints less than 300,000,000 (policy; observer: that command, and the checkout step time of the PR's own `check` run against the 40–72 s of #5455).

**SZ5455b dead evidence is gone.** Given the tree, then `crates/perf/evidence/`, `artifacts/`, `tools/cargo-mutants/evidence/`, `tools/chromium-faults/issue-1977.jsonl`, `tools/chromium-faults/issue-2101.jsonl` and `spikes/hooks-state/screen.run1.jsonl` hold no tracked file, and the closed perf investigations are deleted with the JSON and `.txt.gz` dumps only they cite: `docs/perf-r23-execution.md`, `docs/perf-r23-writes.md`, the R23 sections of `docs/perf.md`, `docs/perf-linux-7763-plugins.json`, `docs/perf-macos-startup.md`, `docs/perf-rail-read.md`, `docs/perf-startup-connections.md`, `docs/perf-sqlite-handoff.md`, `docs/perf-release-profile.md`, `docs/perf-r3800.json` and `docs/evidence/rust-boundaries.md` (policy; observer: `git ls-files` on each path prints nothing).

**SZ5455c live evidence stays.** Given the tree, then `spikes/hooks-state/log*.jsonl` and `spikes/hooks-state/screen.jsonl`, `docs/tauri-latency-report.md`, `docs/perf-keystroke*.md`, `crates/agents/r16/` and R16's and R24's scenarios and committed reports stay, and the tests that read them pass (test: the existing `crates/agents/tests` and `r22_supported_builder_classes_have_committed_evidence`).

**SZ5455d a run cannot commit evidence back.** Given a run that writes under `artifacts/` or `crates/perf/evidence/`, when it stages its work, then `git status` lists none of it, because `.gitignore` covers both paths (policy; observer: `git check-ignore artifacts/ux/x/y.checks.json crates/perf/evidence/x.json` prints both paths).

**SZ5455e no link dangles.** Given a deleted path, then no tracked file links to it: `docs/perf.md`, `docs/release-size.md`, `docs/evidence*.md`, scenario citations and `GLOSSARY.md` point at the conclusions that stay or say the evidence lived in a CI artifact (policy; observer: `loop/rules.sh vocab` passes and `git grep` for each deleted path prints nothing).

**SZ5455f R23 is retired.** Given `scenarios/perf.md`, then **R23** and the rows that cite only it are removed and R16 and R24 keep their text, with R16's diagnostic-collection exception reworded without R23 (policy; observer: `git grep -n "R23" scenarios` prints nothing).

**SZ5455g the lint debt matches the tree.** Given `tools/lint/debt.json`, then it holds no entry for a deleted file (policy; observer: the debt lint inside `just check` passes).
