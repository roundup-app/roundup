# R23 incremental recorder controls (#4109)

Job [40221022276](https://github.com/roundup-app/roundup/actions/runs/40221022276),
boot `b15f494d-3cc6-48d1-bc3e-9ea3080b8b6b`, Ubuntu 24.04, AMD EPYC 9V45,
four available CPUs, affinity 0–3. `lifetime.json`, `jobs-before.stdout.gz`,
`host.stdout.gz`, and the control boundary snapshots retain identity and load.
This is an execution-only observer investigation. It supplies no clean R16 verdict.

## Fixed inputs and states

The [producer archive](../r23-producer-40214115988/README.md) supplies both
instrumented Daemons, their matching CLI executables and the identical common
and marked observers. Historical pin `2029ed2c4ee606d26e73c858c4d7c93130df36e0`;
candidate pin `50e546c1a3ce74689738b08a3dfe273895f9ae31`.
`restore.json` records archive manifest verification; `verified-hashes.json`,
`restored-build-ids.stdout.gz` and `hashes-after.json` identify executable bytes.
No rebuild or diagnostic source change is made. The retained archive's patches
and `archived-build-settings.json` describe debug=1, strip=none,
`--cfg tokio_unstable`, supported runtime hooks and the logger. Those same bytes
remain active in every state. Build settings, hook execution and logging remain
confounded with each other; these controls isolate additional recorder effects
conditional on that configuration, not overhead on an uninstrumented Daemon.

```text
for each pin, then each probe, repeat three times:
  recorder off → scheduler/syscall recorder → same recorder + producer probes
```

Each invocation uses one fresh Daemon, ten login shells, `--runs 1 --calls 1000`,
the original observer warmups and R15 one-unread pacing. These are single-Daemon
diagnostics, not eleven-Daemon clean comparisons. Exact arguments and statuses
are retained per command. The `/proc` snapshot monitor is reused unchanged in
all states. All archive extraction, pre-existing capture analysis, setup and
validation builds finish before controls. No build, compression or offline
analysis overlaps the control window. New control decoding, assessment and
compression necessarily follow collection.

The scheduler state uses the complete original scheduler/syscall event set,
`--clockid mono`, `-a`, `-m 32M` and syscall `--exclude-perf`. Full adds the same
successfully resolved source/function probe groups as the original capture.
Definitions before each state and each perf evlist retain addresses and active
event lists; definitions alone do not mean an event was enabled. Off has no
perf recorder. Historical missing enqueue (237) and candidate exact optimized
publication line (254) remain failures; supported input and following-source
probes are retained, not empty recordings interpreted as zero cost.

## Assessment

All 36 controls are load-qualified: observed load 1.68–3.39 on four CPUs
(maximum 0.8475 per CPU); no latency metric is skipped. All 36 return exit 1
against the unchanged diagnostic scratch ceilings. `ceiling-output.json.gz`
retains each metric's printed verdict and ceiling. The historical/marked second
recorder-off invocation also records cold start 610.779718 ms, over the 300 ms
absolute limit; it is retained, not repeated away or attributed to the recorder.
Write-to-output p95 ranges from 0.161511 to 0.320426 ms, below its 16 ms absolute
limit, and extra RSS from 2.390625 to 3.6953125 MB, below 150 MB. There is no
calibration, repair claim or clean verdict for any metric.

[Write-metric ranges and paired effects](table.md) show substantial variation.
For example, historical/common full-minus-scheduler request/reply p95 spans
−0.052418 to +0.000380 ms; candidate/marked output p95 spans −0.010285 to
+0.033860 ms. Negative differences remain observations, not negative-cost
corrections. `samples.json.gz` retains the 36 per-Daemon metric samples; full
raw perf samples and logger markers remain separately retained.

All 24 evlists match the requested recorder states; all full recordings have
positive input and producer-output source hits. `capture-summary.json.gz`
retains counts and zero-hit enabled groups per recording. Historical
`output_line`/`output_next` resolve optimized addresses without hits; candidate
`output_line` is rejected. Historical `output_publish` has 6633 hits per full
recording, candidate `output_next` has 2211, and each pin's `input_line` has
11000. Unsupported/zero-hit locations supply no zero-cost inference.
No decoded LOST record appears. Each decoder stderr retains perf's generic
warnings that `trace` does not apply to unselected hardware/software event
categories; tracepoint fields and source hits are present. This is absence of
reported loss, not a universal loss-free guarantee. Recorder stderr and headers
remain available for inspection.

See `assessment.json.gz` for each invocation, metric range, all three paired
arithmetic differences and ratios (scheduler minus off, full minus scheduler,
and full minus off), separately for each pin/probe. `table.md` shows the two write
metrics in milliseconds. Three repetitions supply observed variation, never a
universal overhead bound. Effects may change sign with noise and overlapping
work; no difference is a correction to subtract from clean p95s or stage times.

These controls can describe additional recorder perturbation for the exact
retained diagnostic executables and workload. They cannot bound individual
producer or scheduler stage costs in the earlier profiles: aggregate invocation
p95 differences are not per-event overhead, independent timing errors or an
unperturbed counterfactual for each request. The six original clean observations
are labelled history only, not this host's comparison base. Scratch ceilings
remain unchanged and uncalibrated; all misses remain observations, not clean
R16 failures or a repair claim. R8 pins, R13 load ≤2.0 per CPU, R15 pacing,
R16 historical ceilings and rule 7 absolute limits are preserved.

Optimized publication addresses are not exact queue linearization boundaries.
Supported task-spawn hooks precede spawning and are not executor enqueue
timestamps; exact executor enqueue remains unsupported. Thread CPU includes
observer and other task work. Selected-future polls are not complete runtime
polls; runtime hooks exclude root/blocking tasks and include logger work.
Acceptance is not physical completion. Pending-read idle time is not a write's
blocking cost, and overlapping reply/output branches are never summed.

Daemon-only attribution remains incomplete under [#4031](https://github.com/roundup-app/roundup/issues/4031),
[#3760](https://github.com/roundup-app/roundup/issues/3760) and
[#3720](https://github.com/roundup-app/roundup/issues/3720). The remaining scoped
engineering investigation needs (1) an exact executor enqueue observation
supported by the runtime rather than a spawn hook; (2) exact optimized producer
publication/consumption boundaries; and (3) a way to distinguish diagnostic
build, hook and logger work from useful task execution. These observations are
not supplied by subtracting aggregate recorder deltas. No Mac or product
decision is required.

## Reproduction

Use `reproduce.txt`. Scripts are retained as `.py.txt`; their standard-library
JSON/gzip/hash facilities and installed perf commands are reused. Offline replay
writes to a new output directory. Every raw recorder file and decoded trace is
retained compressed with hashes; loss diagnostics are retained per recording.
`failures.md` lists every command returning nonzero, including budget misses.
