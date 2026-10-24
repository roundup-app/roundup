# R16 Rail presentation diagnosis and repair

Refs #1365; implementation PR #1368; remaining Daemon reply/frame prerequisite #1369. These are diagnosis measurements, not class baselines or completion observations. #1361 retains the final combined four-metric comparison; #1251 retains class baselines and completion observations.

Nine clean historical and nine clean repaired invocations are retained. Historical `rail_tree_40_p95_ms` invocation-median median is 0.349132 ms; its 10% + 0.001 ms ceiling is 0.3850452 ms. Repaired median is 0.797801 ms; 9/9 repaired invocations miss. #1365 stays open, blocked by #1369. No ceiling miss was discarded and no baseline, threshold, noise allowance, metric, call count or workload was changed.

```text
load ordered rows + conversation availability
  → present Status / Attempt / Channel / Stray
  → gate can_resume on the exited Attempt
  → return every Rail field
```

The original release module fixture profiled 3,300 40-row tree reads (132,000 node samples). Median sums per tree: Status 3.986 µs, conversation queries 209.232 µs, Channel 1.734 µs, Stray 1.706 µs. This selects the repair: read the complete-conversation predicate in the existing row query, then retain the original live-Attempt eligibility gate. There is no cache or invalidation policy. Ordering and all other presentation logic remain intact.

Three separately launched diagnostic Daemons retain over 135,000 presentation-node samples each. Source clocks and logging are attribution only; compilation was active during attribution. After repair, presentation takes about 4 µs per 40-row tree; loading, reply conversion and frame rendering remain measurable. Further loading isolation finds sorting/cloning smaller than row querying/decoding.

`profile-summary.json`:

```json
{
  "samples": 132000,
  "per_node_median_ns": {
    "status": 81.0,
    "conversation": 5040.0,
    "channel": 40.0,
    "stray": 40.0
  },
  "per_40_row_invocation_median_us": {
    "status": 3.986,
    "conversation": 209.232,
    "channel": 1.734,
    "stray": 1.706
  }
}
```

`daemon-profile-summary.json`:

```json
[
  {
    "daemon": 0,
    "samples": 135516,
    "node_median_ns": {
      "status": 60.0,
      "conversation": 5020.0,
      "channel": 40.0,
      "stray": 40.0
    }
  },
  {
    "daemon": 1,
    "samples": 135458,
    "node_median_ns": {
      "status": 51.0,
      "conversation": 5120.0,
      "channel": 60.0,
      "stray": 40.0
    }
  },
  {
    "daemon": 2,
    "samples": 135513,
    "node_median_ns": {
      "status": 51,
      "conversation": 5030,
      "channel": 40,
      "stray": 40
    }
  }
]
```

`remaining-profile-summary.json`:

```json
[
  {
    "daemon": 0,
    "tree_samples": 3360,
    "load_us": 140.593,
    "presentation_us": 4.078,
    "reply_us": 125.2645,
    "frame_us": 114.444
  },
  {
    "daemon": 1,
    "tree_samples": 3367,
    "load_us": 138.89,
    "presentation_us": 3.897,
    "reply_us": 126.636,
    "frame_us": 114.399
  },
  {
    "daemon": 2,
    "tree_samples": 3361,
    "load_us": 139.06,
    "presentation_us": 3.998,
    "reply_us": 126.397,
    "frame_us": 115.03
  }
]
```

`load-profile-summary.json`:

```json
[
  {
    "daemon": 0,
    "samples": 3362,
    "medians_us": {
      "query_decode": 103.544,
      "sort": 0.681,
      "descend_clone": 7.514
    }
  },
  {
    "daemon": 1,
    "samples": 3360,
    "medians_us": {
      "query_decode": 78.466,
      "sort": 0.531,
      "descend_clone": 6.984
    }
  },
  {
    "daemon": 2,
    "samples": 3372,
    "medians_us": {
      "query_decode": 67.396,
      "sort": 0.3955,
      "descend_clone": 6.593
    }
  }
]
```

Regression tests cross the existing Rail RPC seam, plus the internal Rail seam whose returned rows feed it. The initial loaded-availability test was committed red (`4ef9c1df6b30f657e8be75728c88b42ad2acbb6c`, exit 101); the repair is `0f9c3712863d15009096d06deb94d2fa6117ec9c`.

| Test | Invariant |
|---|---|
| `r16_loaded_rail_keeps_complete_conversation_availability_in_tree_order` | Complete versus missing/partial saved data; parent-before-child and sibling order; single-node loading agrees. |
| `r16_empty_workstreams_keep_every_presentation_field` | All forty complete rows match the creation replies, including Status, Attempt/revision, Channel, Stray and Iteration. |
| `r16_resume_availability_is_gated_by_the_current_attempt` | Exited saved Agent can resume; pending and acknowledged Attempts cannot; pending revision is 1 and Status is starting; full running reply agrees with the tree. |
| `r16_reopened_rail_keeps_resume_data_without_live_presentation` | Saved conversation and Attempt survive reopen; Terminal/revision/Channel/Stray do not become live; order, Model, Effort and Iteration remain. |

`cargo test -p agents` passes 538 tests (including all owning-module scenarios). `pnpm install` exits 0. `just check` before and after merging main exits 0: 1,508 Rust tests and 2,457 web tests pass, with two existing web skips; `just proofs` prints `ALL PROOFS CHECK`. Main advanced only loop/web-test files; the final merge and release verification are recorded with the final PR head. Daemon sources, dependencies and build settings used by the frozen repaired binary remain unchanged.

## Historical/repaired invocation medians

| Metric | Historical (ms; RSS MB) | Repaired | 10% + existing noise | Repaired misses |
|---|---:|---:|---:|---:|
| `cold_start_ms` | 15.152274 | 34.854753 | 16.9675014 | 9/9 |
| `ping_p95_ms` | 0.066374 | 0.135133 | 0.0740114 | 9/9 |
| `rail_tree_10_p95_ms` | 0.181159 | 0.292106 | 0.1992749 | 9/9 |
| `rail_tree_40_p95_ms` | 0.349132 | 0.797801 | 0.3850452 | 9/9 |
| `rss_extra_mb` | 2.503906 | 2.601562 | 2.8042969 | 0/9 |
| `terminal_write_p95_ms` | 0.103984 | 0.365723 | 0.1153824 | 9/9 |
| `write_to_output_p95_ms` | 0.210278 | 0.477293 | 0.2323058 | 9/9 |

Only the Rail ceiling is this Issue’s completion condition; the combined four-latency-metric conclusion remains with #1361. All original absolute limits are also checked by the unchanged compatible historical probe. Every invocation’s committed-budget exit is retained; exit 1 does not invalidate a complete report, and no report is calibration or completion evidence.

| Pair | Reference | Attempt | Rail p95 ms | Median load/CPU | Exit | Qualification |
|---|---|---:|---:|---:|---:|---|
| 1 | historical | 1 | 0.349132 | 0.4225 | 1 | clean under R13 |
| 1 | repaired | 1 | 0.797801 | 0.53 | 1 | clean under R13 |
| 2 | historical | 1 | 0.356707 | 0.6175 | 1 | clean under R13 |
| 2 | repaired | 1 | 0.8312219999999999 | 0.7375 | 1 | clean under R13 |
| 3 | historical | 1 | 0.444501 | 0.725 | 1 | clean under R13 |
| 3 | repaired | 1 | 0.800977 | 0.935 | 1 | clean under R13 |
| 4 | historical | 1 | 0.342625 | 0.745 | 1 | clean under R13 |
| 4 | repaired | 1 | 0.785991 | 1.0875 | 1 | clean under R13 |
| 5 | historical | 1 | 0.354975 | 1.28 | 1 | clean under R13 |
| 5 | repaired | 1 | 1.136133 | 1.3025 | 1 | clean under R13 |
| 6 | historical | 1 | 0.50719 | 1.1475 | 1 | clean under R13 |
| 6 | repaired | 1 | 3.4389149999999997 | 2.5725 | 1 | busy: median load 2.5725 per CPU exceeds 2.0; not counted |
| 6 | repaired | 2 | 4.007095 | 3.0525 | 1 | busy: median load 3.0525 per CPU exceeds 2.0; not counted |
| 6 | repaired | 3 | 3.84183 | 2.925 | 1 | busy: median load 2.925 per CPU exceeds 2.0; not counted |
| 6 | repaired | 4 | 0.80264 | 0.5575 | 1 | clean under R13 |
| 7 | historical | 1 | 0.34622400000000003 | 0.9175 | 1 | clean under R13 |
| 7 | repaired | 1 | 0.7903279999999999 | 0.7975 | 1 | clean under R13 |
| 8 | historical | 1 | 0.339254 | 0.7225 | 1 | clean under R13 |
| 8 | repaired | 1 | 0.772273 | 0.5325 | 1 | clean under R13 |
| 9 | historical | 1 | 0.340065 | 0.415 | 1 | clean under R13 |
| 9 | repaired | 1 | 0.784576 | 0.625 | 1 | clean under R13 |

Busy/failed invocations are retained with their qualification reason and repeated. The comparison queue was parked after three busy repaired pair-six observations while the web suite finished; active observations finished and were retained. The 2.0 threshold remains unchanged. The older identical probe predates R13, so busy qualification is recorded outside its untouched reports. Its committed-budget memory comparison still runs at every load. The original login-shell workload (ten Terminals), 1,000 calls, 100 warmups and eleven fresh Daemons per invocation remain intact.

## Machine and binary provenance

```json
{
  "os": "PRETTY_NAME=\"Ubuntu 24.04.5 LTS\"\nNAME=\"Ubuntu\"\nVERSION_ID=\"24.04\"\nVERSION=\"24.04.5 LTS (Noble Numbat)\"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nHOME_URL=\"https://www.ubuntu.com/\"\nSUPPORT_URL=\"https://help.ubuntu.com/\"\nBUG_REPORT_URL=\"https://bugs.launchpad.net/ubuntu/\"\nPRIVACY_POLICY_URL=\"https://www.ubuntu.com/legal/terms-and-policies/privacy-policy\"\nUBUNTU_CODENAME=noble\nLOGO=ubuntu-logo\n",
  "cpu": "Architecture:                            x86_64\nCPU op-mode(s):                          32-bit, 64-bit\nAddress sizes:                           48 bits physical, 48 bits virtual\nByte Order:                              Little Endian\nCPU(s):                                  4\nOn-line CPU(s) list:                     0-3\nVendor ID:                               AuthenticAMD\nModel name:                              AMD EPYC 7763 64-Core Processor\nCPU family:                              25\nModel:                                   1\nThread(s) per core:                      2\nCore(s) per socket:                      2\nSocket(s):                               1\nStepping:                                1\nBogoMIPS:                                4890.85\nFlags:                                   fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx mmxext fxsr_opt pdpe1gb rdtscp lm constant_tsc rep_good nopl tsc_reliable nonstop_tsc cpuid extd_apicid aperfmperf tsc_known_freq pni pclmulqdq ssse3 fma cx16 pcid sse4_1 sse4_2 movbe popcnt aes xsave avx f16c rdrand hypervisor lahf_lm cmp_legacy svm cr8_legacy abm sse4a misalignsse 3dnowprefetch osvw topoext vmmcall fsgsbase bmi1 avx2 smep bmi2 erms invpcid rdseed adx smap clflushopt clwb sha_ni xsaveopt xsavec xgetbv1 xsaves user_shstk clzero xsaveerptr rdpru arat npt nrip_save tsc_scale vmcb_clean flushbyasid decodeassists pausefilter pfthreshold v_vmsave_vmload umip vaes vpclmulqdq rdpid fsrm\nVirtualization:                          AMD-V\nHypervisor vendor:                       Microsoft\nVirtualization type:                     full\nL1d cache:                               64 KiB (2 instances)\nL1i cache:                               64 KiB (2 instances)\nL2 cache:                                1 MiB (2 instances)\nL3 cache:                                32 MiB (1 instance)\nNUMA node(s):                            1\nNUMA node0 CPU(s):                       0-3\nVulnerability Gather data sampling:      Not affected\nVulnerability Ghostwrite:                Not affected\nVulnerability Indirect target selection: Not affected\nVulnerability Itlb multihit:             Not affected\nVulnerability L1tf:                      Not affected\nVulnerability Mds:                       Not affected\nVulnerability Meltdown:                  Not affected\nVulnerability Mmio stale data:           Not affected\nVulnerability Old microcode:             Not affected\nVulnerability Reg file data sampling:    Not affected\nVulnerability Retbleed:                  Not affected\nVulnerability Spec rstack overflow:      Vulnerable: Safe RET, no microcode\nVulnerability Spec store bypass:         Vulnerable\nVulnerability Spectre v1:                Mitigation; usercopy/swapgs barriers and __user pointer sanitization\nVulnerability Spectre v2:                Mitigation; Retpolines; STIBP disabled; RSB filling; PBRSB-eIBRS Not affected; BHI Not affected\nVulnerability Srbds:                     Not affected\nVulnerability Tsa:                       Vulnerable: No microcode\nVulnerability Tsx async abort:           Not affected\nVulnerability Vmscape:                   Not affected\n",
  "online": "0-3\n",
  "available": "4\n",
  "affinity": "pid 122900's current affinity list: 0-3\n",
  "kernel": "Linux runnervmmprz5 6.17.0-1022-azure #22-Ubuntu SMP Mon Jul 27 17:24:03 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux\n",
  "rust": "rustc 1.99.0 (b940084d7 2026-09-28)\nbinary: rustc\ncommit-hash: b940084d7eb6a299eb4bfeb8e34901bc051e7ac4\ncommit-date: 2026-09-28\nhost: x86_64-unknown-linux-gnu\nrelease: 1.99.0\nLLVM version: 23.1.1\n",
  "cargo": "cargo 1.99.0 (5f94df478 2026-08-27)\n",
  "shell": "GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)\nCopyright (C) 2022 Free Software Foundation, Inc.\nLicense GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>\n\nThis is free software; you are free to change and redistribute it.\nThere is NO WARRANTY, to the extent permitted by law.\n",
  "env": {
    "RUSTFLAGS": null,
    "CARGO_BUILD_RUSTFLAGS": null,
    "SHELL": "/bin/bash"
  },
  "profile": "default release, committed lockfiles, no instrumentation",
  "refs": {
    "historical": "1d1618d2d9bb5c0f25ecb6b32de1cde20bfad6d0",
    "repaired": "0f9c3712863d15009096d06deb94d2fa6117ec9c"
  },
  "hashes": {
    "/tmp/rail-historical/target/release/perf": "a35e5a3b16a6169ccb025a955ad382fb0f08ec3f098229604780c993bf7c3558",
    "/tmp/rail-historical/target/release/rupd": "4b2d5860816634d313127bc5ecfa7276710906473eefdddf8c17a8d57d381bc4",
    "/tmp/rail-historical/target/release/rup": "7f74cc5a85df94f144f36231ba40d0165010138fbf3b106e38e981098e4a6012",
    "/tmp/rail-evidence/rupd-repaired": "bf9dc19d5226af2b0a20a8af93dbf1dbf4947604a25bf49e4bdf3698156a2a02",
    "/tmp/rail-evidence/rup-repaired": "a5ef6e5fe090f94efa43894d64423d2590308ab553128e79495b23c5f7597853"
  }
}
```

Diagnostic and frozen uninstrumented binary hashes (the latter contain no diagnostic marker):

```json
{
  "rupd-before": {
    "sha256": "bfb29b2fab40d69af87d5e24c5f9081a63555006f9b5bfe56aca0b76577964e8",
    "has_diagnostic_markers": false
  },
  "rup-before": {
    "sha256": "a5ef6e5fe090f94efa43894d64423d2590308ab553128e79495b23c5f7597853",
    "has_diagnostic_markers": false
  },
  "rupd-repaired": {
    "sha256": "bf9dc19d5226af2b0a20a8af93dbf1dbf4947604a25bf49e4bdf3698156a2a02",
    "has_diagnostic_markers": false
  },
  "rup-repaired": {
    "sha256": "a5ef6e5fe090f94efa43894d64423d2590308ab553128e79495b23c5f7597853",
    "has_diagnostic_markers": false
  },
  "rupd-diagnostic": {
    "sha256": "0beba08348bd14920f28d52262fbf498d334a9f12ae3909db55c327920f03ab2",
    "has_diagnostic_markers": true
  },
  "rupd-remaining-profile": {
    "sha256": "0eb411a20042bcbcc4a434b212fde66c8a44e4801b2c69cefe02be55566987f6",
    "has_diagnostic_markers": true
  },
  "rupd-load-profile": {
    "sha256": "a7715ca05fa1ea69c6d77d94114ced7a5639812d3c5a0b397ffe32e91fd2f0a0",
    "has_diagnostic_markers": true
  }
}
```

## Exact commands and measurement source

All release builds use the same Rust toolchain and default committed profiles/lockfiles, without RUSTFLAGS. Initial historical/current, compatible probe, presentation diagnostic, repaired and remaining diagnostic builds exit 0. An initial diagnostic-script quoting failure was repaired; overlapping diagnostic fixture logs were retained locally and repeated into `profile-clean.log` before interpreting the clocks. Neither is acceptance evidence.

`build-commands.txt`:

```sh
git worktree add /tmp/rail-presentation -b build/rail-presentation-latency-regression origin/main
# origin/main = 6189fcc15e0327b8800325e237b137e573926505
git worktree add --detach /tmp/rail-historical 1d1618d2d9bb5c0f25ecb6b32de1cde20bfad6d0
cd /tmp/rail-presentation
cargo build --release -p rupd -p rup -p perf
cp target/release/rupd /tmp/rail-evidence/rupd-before
cp target/release/rup /tmp/rail-evidence/rup-before
cd /tmp/rail-historical
cargo build --release -p rupd -p rup -p perf
git apply --unidiff-zero /tmp/rail-evidence/compatibility.patch
cargo build --release -p perf
# Compatibility patch came verbatim from main's crates/terminal/rss-r16.md.
cd /tmp/rail-presentation
pnpm install
cargo test -p agents --lib r16_loaded_rail
# red: exit 101, availability false for complete conversation
# Apply diagnostic.py, adding profile-test.rs as tests/scenarios/diagnostic.rs.
python3 /tmp/rail-evidence/diagnostic.py
cargo test --release -p agents --test scenarios r16_diagnostic_presentation -- --nocapture
# A repeated clean diagnostic run supplies profile-clean.log (earlier overlapping logs retained).
cargo build --release -p rupd
cp target/release/rupd /tmp/rail-evidence/rupd-diagnostic
python3 /tmp/rail-evidence/isolate.py /tmp/rail-evidence/rupd-diagnostic /tmp/rail-evidence/isolation-diagnostic.json
# Remove instrumentation and apply the committed repair.
cargo test -p agents
cargo build --release -p rupd -p rup
cp target/release/rupd /tmp/rail-evidence/rupd-repaired
cp target/release/rup /tmp/rail-evidence/rup-repaired
just check
python3 /tmp/rail-evidence/isolate.py /tmp/rail-evidence/rupd-repaired /tmp/rail-evidence/isolation-repaired.json
# Diagnostic-only remaining owner attribution; no source from this checkout enters the PR.
git worktree add --detach /tmp/rail-diagnostic 0f9c3712
cd /tmp/rail-diagnostic
git apply /tmp/rail-evidence/remaining-profile.patch
CARGO_TARGET_DIR=/tmp/rail-presentation/target cargo build --release -p rupd
cp /tmp/rail-presentation/target/release/rupd /tmp/rail-evidence/rupd-remaining-profile
python3 /tmp/rail-evidence/isolate.py /tmp/rail-evidence/rupd-remaining-profile /tmp/rail-evidence/isolation-remaining.json
python3 /tmp/rail-evidence/compare.py
# Hold only the comparison orchestrator after busy pair-six observations while the web suite runs.
# An active perf child is allowed to finish, and its report is retained.
pkill -STOP -f '^python3 /tmp/rail-evidence/compare.py$'
# After just check ends and load settles, resume the queue; busy/failed observations repeat.
pkill -CONT -f '^python3 /tmp/rail-evidence/compare.py$'

# Main advanced only loop/web-test files; no Daemon source, dependency or build-setting changes.
git merge origin/main
# Merge head: 9717d898b4b80cd1b0181838ae20605e7fe8042e
pnpm install
just check
git diff 0f9c3712863d15009096d06deb94d2fa6117ec9c HEAD -- crates Cargo.toml Cargo.lock .cargo rust-toolchain.toml
# The diff above is empty.

```

`compatibility.patch`:

```diff
diff --git a/crates/perf/src/measure.rs b/crates/perf/src/measure.rs
index 7a45f1e8..0abf1760 100644
--- a/crates/perf/src/measure.rs
+++ b/crates/perf/src/measure.rs
@@ -188 +188 @@ pub async fn one_run(rupd: &Path, calls: usize) -> io::Result<Sample> {
-                "rail.createGroup",
+                if std::env::var_os("R16_CURRENT_PROTOCOL").is_some() { "rail.createWorkstream" } else { "rail.createGroup" },
@@ -237,14 +237,11 @@ pub async fn one_run(rupd: &Path, calls: usize) -> io::Result<Sample> {
-    // Last: its echoes are never read, so they must not sit in front of a write_to_output sample.
-    sample.insert(
-        "terminal_write_p95_ms".into(),
-        percentile(
-            latencies(
-                &client,
-                "terminal.write",
-                json!({ "id": terminal, "data": "YQ==" }),
-                calls,
-            )
-            .await?,
-            0.95,
-        ),
-    );
+    // Diagnostic R15 pacing: the echo wait is outside the timed write call.
+    let params = json!({ "id": terminal, "data": "YQ==" });
+    let mut writes = Vec::new();
+    for turn in 0..WARMUP + calls {
+        let started = Instant::now();
+        ask(&client, "terminal.write", params.clone()).await?;
+        let elapsed = ms(started.elapsed());
+        wait_for_output(&mut events, terminal).await?;
+        if turn >= WARMUP { writes.push(elapsed); }
+    }
+    sample.insert("terminal_write_p95_ms".into(), percentile(writes, 0.95));

```

`compare.py`:

```python
import json,os,pathlib,subprocess,statistics,hashlib,time
root=pathlib.Path('/tmp/rail-evidence')
probe='/tmp/rail-historical/target/release/perf'
refs={'historical':'/tmp/rail-historical','repaired':'/tmp/rail-presentation'}
meta={}
for name,cmd in {'os':['cat','/etc/os-release'],'cpu':['lscpu'],'online':['cat','/sys/devices/system/cpu/online'],'available':['nproc'],'affinity':['taskset','-pc',str(os.getpid())],'kernel':['uname','-a'],'rust':['rustc','-Vv'],'cargo':['cargo','-V'],'shell':['bash','--version']}.items():
 meta[name]=subprocess.check_output(cmd,text=True)
meta['env']={k:os.environ.get(k) for k in ['RUSTFLAGS','CARGO_BUILD_RUSTFLAGS','SHELL']}
meta['profile']='default release, committed lockfiles, no instrumentation'
meta['refs']={n:subprocess.check_output(['git','rev-parse','HEAD'],cwd=p,text=True).strip() for n,p in refs.items()}
meta['hashes']={p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in [probe]+[refs['historical']+'/target/release/'+b for b in ['rupd','rup']]+[str(root/('rupd-repaired')),str(root/('rup-repaired'))]}
(root/'metadata.json').write_text(json.dumps(meta,indent=2))
for pair in range(1,10):
 for name,d in refs.items():
  attempt=0
  while True:
   attempt+=1
   env=dict(os.environ)
   if name=='repaired':env['R16_CURRENT_PROTOCOL']='1'
   else:env.pop('R16_CURRENT_PROTOCOL',None)
   dest=root/f'paired-{pair}-{name}-{attempt}'
   cmd=[probe,'--runs','11','--calls','1000','--rupd',(d+'/target/release/rupd' if name=='historical' else str(root/'rupd-repaired')),'--out',str(dest)+'.json']
   pathlib.Path(str(dest)+'.command').write_text(json.dumps({'cmd':cmd,'cwd':refs['historical'],'protocol':env.get('R16_CURRENT_PROTOCOL')},indent=2))
   with pathlib.Path(str(dest)+'.log').open('w') as log:
    try: result=subprocess.run(cmd,cwd=refs['historical'],env=env,stdout=log,stderr=subprocess.STDOUT,timeout=240); code=result.returncode
    except subprocess.TimeoutExpired: code=124
   pathlib.Path(str(dest)+'.exit').write_text(str(code)+'\n')
   report_file=pathlib.Path(str(dest)+'.json')
   if report_file.exists():
    report=json.loads(report_file.read_text()); load=statistics.median(report['loads'])/report['cpus']
    print(pair,name,attempt,code,report['metrics']['rail_tree_40_p95_ms'],load,flush=True)
    if code in [0,1] and load<=2.0:break
   else: print(pair,name,attempt,code,'NO REPORT',flush=True)
   time.sleep(5)

```

`summarize.py`:

```python
from pathlib import Path
import json,statistics
p=Path('/tmp/rail-evidence');rows=[]
for f in sorted(p.glob('paired-*.exit')):
 stem=f.stem;_,pair,ref,attempt=stem.split('-');jf=p/(stem+'.json')
 report=json.loads(jf.read_text()) if jf.exists() else None
 rows.append(dict(pair=int(pair),reference=ref,attempt=int(attempt),exit=int(f.read_text()),median_load_per_cpu=statistics.median(report['loads'])/report['cpus'] if report else None,command=json.loads((p/(stem+'.command')).read_text()),report=report,log=(p/(stem+'.log')).read_text()))
for r in rows:
 r['qualification'] = ('failed observation: no complete report' if r['report'] is None or r['exit'] not in (0,1) else (f"busy: median load {r['median_load_per_cpu']} per CPU exceeds 2.0; not counted" if r['median_load_per_cpu']>2 else 'clean under R13'))
(p/'reports.jsonl').write_text(''.join(json.dumps(r,separators=(',',':'))+'\n' for r in rows))
clean={ref:[r for r in rows if r['reference']==ref and r['report'] and r['median_load_per_cpu']<=2 and r['exit'] in (0,1)] for ref in ['historical','repaired']}
noise={'cold_start_ms':.3,'ping_p95_ms':.001,'rail_tree_10_p95_ms':0,'rail_tree_40_p95_ms':.001,'rss_extra_mb':.05,'terminal_write_p95_ms':.001,'write_to_output_p95_ms':.001}
result={'clean_invocations':{ref:len(v) for ref,v in clean.items()},'metrics':{}}
if all(clean.values()):
 for metric in clean['historical'][0]['report']['metrics']:
  historical=statistics.median(r['report']['metrics'][metric] for r in clean['historical']); repaired=statistics.median(r['report']['metrics'][metric] for r in clean['repaired']);ceiling=historical*1.1+noise[metric]
  result['metrics'][metric]={'historical_median':historical,'repaired_median':repaired,'ceiling':ceiling,'misses':[r['pair'] for r in clean['repaired'] if r['report']['metrics'][metric]>ceiling]}
(p/'comparison-summary.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))

```

`diagnostic.py`:

```python
from pathlib import Path
p=Path('/tmp/rail-presentation/crates/agents/src/lib.rs')
s=p.read_text();Path('/tmp/rail-evidence/lib-original.rs').write_text(s)
s=s.replace('        node.status_revision = match runs.get(&node.id) {','        let timed = std::time::Instant::now();\n        node.status_revision = match runs.get(&node.id) {',1)
s=s.replace('        node.can_resume = exited && rail.has_conversation(&node.id).unwrap_or(false);','        let status_ns = timed.elapsed().as_nanos();\n        node.can_resume = exited && rail.has_conversation(&node.id).unwrap_or(false);\n        let resume_ns = timed.elapsed().as_nanos();',1)
s=s.replace('        node.channel = channel_in(&channels, &node.id, runs.get(&node.id));','        node.channel = channel_in(&channels, &node.id, runs.get(&node.id));\n        let channel_ns = timed.elapsed().as_nanos();',1)
s=s.replace('            .unwrap_or_default();\n        node\n    }','            .unwrap_or_default();\n        eprintln!("PROFILE {} {} {} {}", status_ns, resume_ns-status_ns, channel_ns-resume_ns, timed.elapsed().as_nanos()-channel_ns);\n        node\n    }',1)
p.write_text(s)
p=Path('/tmp/rail-presentation/crates/agents/tests/scenarios/main.rs');p.write_text(p.read_text()+'\nmod diagnostic;\n')
Path('/tmp/rail-presentation/crates/agents/tests/scenarios/diagnostic.rs').write_text(Path('/tmp/rail-evidence/profile-test.rs').read_text())

```

`profile-test.rs`:

```rust
#[tokio::test]
async fn r16_diagnostic_presentation() {
    let f = crate::common::Fixture::new();
    for n in 0..40 { f.workstream(&format!("w{n}"), None).await; }
    for _ in 0..3300 { assert_eq!(f.tree().await.len(), 40); }
}

```

`profile.patch`:

```diff
diff --git a/crates/agents/src/lib.rs b/crates/agents/src/lib.rs
index 8e54f19c..df63a096 100644
--- a/crates/agents/src/lib.rs
+++ b/crates/agents/src/lib.rs
@@ -564,6 +564,7 @@ impl Shared {
         rail: &rail::Rail,
         runs: &HashMap<String, Slot>,
     ) -> RailNode {
+        let timed = std::time::Instant::now();
         node.status_revision = match runs.get(&node.id) {
             Some(Slot::Running(run)) => Some(run.status_revision.to_string()),
             // B36: inheriting the ended run's revision closes Messages on the new Attempt.
@@ -593,9 +594,12 @@ impl Shared {
             Some(Slot::Starting { .. } | Slot::Resuming { .. } | Slot::Closing) => false,
             None => true,
         };
+        let status_ns = timed.elapsed().as_nanos();
         node.can_resume = exited && rail.has_conversation(&node.id).unwrap_or(false);
+        let resume_ns = timed.elapsed().as_nanos();
         let channels = self.channels.lock().expect("channels lock");
         node.channel = channel_in(&channels, &node.id, runs.get(&node.id));
+        let channel_ns = timed.elapsed().as_nanos();
         node.stray = self
             .scan
             .found
@@ -604,6 +608,7 @@ impl Shared {
             .get(&node.id)
             .cloned()
             .unwrap_or_default();
+        eprintln!("PROFILE {} {} {} {}", status_ns, resume_ns-status_ns, channel_ns-resume_ns, timed.elapsed().as_nanos()-channel_ns);
         node
     }


```

`remaining-profile.patch`:

```diff
diff --git a/crates/agents/src/lib.rs b/crates/agents/src/lib.rs
index 818fd94b..f1a846cf 100644
--- a/crates/agents/src/lib.rs
+++ b/crates/agents/src/lib.rs
@@ -751,11 +751,13 @@ impl Shared {
     fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
         let rail = self.rail();
         let runs = self.runs();
-        Ok(rail
-            .tree()?
-            .into_iter()
-            .map(|node| self.present(node, &runs))
-            .collect())
+        let start = std::time::Instant::now();
+        let nodes = rail.tree()?;
+        let loaded = start.elapsed().as_nanos();
+        let count = nodes.len();
+        let nodes = nodes.into_iter().map(|node| self.present(node, &runs)).collect();
+        eprintln!("TREE {} {} {}", count, loaded, start.elapsed().as_nanos()-loaded);
+        Ok(nodes)
     }

     /// Fold `observation` into Agent `id`'s Status. A change is announced as `agent.status`, and
@@ -3168,7 +3170,13 @@ impl Module for Agents {
                 shared.answer(ctx, &id, answer.as_deref(), &note, proof.as_deref())?;
                 reply(&())
             }
-            "rail.tree" => reply(&shared.tree()?),
+            "rail.tree" => {
+                let nodes = shared.tree()?;
+                let start = std::time::Instant::now();
+                let result = reply(&nodes);
+                eprintln!("REPLY {} {}", nodes.len(), start.elapsed().as_nanos());
+                result
+            },
             "agent.spawnPrompt" => {
                 let NodeId { id } = params(value)?;
                 reply(&serde_json::json!({ "prompt": shared.rail().spawn_prompt(&id)? }))
diff --git a/crates/rupd/src/lib.rs b/crates/rupd/src/lib.rs
index d54da54a..2a4da96c 100644
--- a/crates/rupd/src/lib.rs
+++ b/crates/rupd/src/lib.rs
@@ -859,7 +859,10 @@ async fn handle(stream: UnixStream, daemon: Arc<Daemon>) -> io::Result<()> {
     let (frames, mut outbox) = mpsc::unbounded_channel::<Value>();
     let writer = tokio::spawn(async move {
         while let Some(frame) = outbox.recv().await {
-            write.write_all(format!("{frame}\n").as_bytes()).await?;
+            let start = std::time::Instant::now();
+            let rendered = format!("{frame}\n");
+            eprintln!("FRAME {} {}", rendered.len(), start.elapsed().as_nanos());
+            write.write_all(rendered.as_bytes()).await?;
         }
         io::Result::Ok(())
     });

```

`load-profile.patch`:

```diff
diff --git a/crates/agents/src/lib.rs b/crates/agents/src/lib.rs
index 818fd94b..f1a846cf 100644
--- a/crates/agents/src/lib.rs
+++ b/crates/agents/src/lib.rs
@@ -751,11 +751,13 @@ impl Shared {
     fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
         let rail = self.rail();
         let runs = self.runs();
-        Ok(rail
-            .tree()?
-            .into_iter()
-            .map(|node| self.present(node, &runs))
-            .collect())
+        let start = std::time::Instant::now();
+        let nodes = rail.tree()?;
+        let loaded = start.elapsed().as_nanos();
+        let count = nodes.len();
+        let nodes = nodes.into_iter().map(|node| self.present(node, &runs)).collect();
+        eprintln!("TREE {} {} {}", count, loaded, start.elapsed().as_nanos()-loaded);
+        Ok(nodes)
     }

     /// Fold `observation` into Agent `id`'s Status. A change is announced as `agent.status`, and
@@ -3168,7 +3170,13 @@ impl Module for Agents {
                 shared.answer(ctx, &id, answer.as_deref(), &note, proof.as_deref())?;
                 reply(&())
             }
-            "rail.tree" => reply(&shared.tree()?),
+            "rail.tree" => {
+                let nodes = shared.tree()?;
+                let start = std::time::Instant::now();
+                let result = reply(&nodes);
+                eprintln!("REPLY {} {}", nodes.len(), start.elapsed().as_nanos());
+                result
+            },
             "agent.spawnPrompt" => {
                 let NodeId { id } = params(value)?;
                 reply(&serde_json::json!({ "prompt": shared.rail().spawn_prompt(&id)? }))
diff --git a/crates/agents/src/rail.rs b/crates/agents/src/rail.rs
index 9836f8ab..f481d4f3 100644
--- a/crates/agents/src/rail.rs
+++ b/crates/agents/src/rail.rs
@@ -99,10 +99,14 @@ impl Rail {

     /// Every node, each parent before its children, siblings by `order`.
     pub fn tree(&self) -> Result<Vec<RailNode>, RpcError> {
+        let start = std::time::Instant::now();
         let mut flat = load(&self.db)?;
+        let loaded = start.elapsed().as_nanos();
         flat.sort_by_key(|node| node.order);
+        let ordered = start.elapsed().as_nanos();
         let mut out = Vec::with_capacity(flat.len());
         descend(&flat, None, &mut out);
+        eprintln!("LOAD {} {} {} {}", flat.len(), loaded, ordered-loaded, start.elapsed().as_nanos()-ordered);
         Ok(out)
     }

diff --git a/crates/rupd/src/lib.rs b/crates/rupd/src/lib.rs
index d54da54a..2a4da96c 100644
--- a/crates/rupd/src/lib.rs
+++ b/crates/rupd/src/lib.rs
@@ -859,7 +859,10 @@ async fn handle(stream: UnixStream, daemon: Arc<Daemon>) -> io::Result<()> {
     let (frames, mut outbox) = mpsc::unbounded_channel::<Value>();
     let writer = tokio::spawn(async move {
         while let Some(frame) = outbox.recv().await {
-            write.write_all(format!("{frame}\n").as_bytes()).await?;
+            let start = std::time::Instant::now();
+            let rendered = format!("{frame}\n");
+            eprintln!("FRAME {} {}", rendered.len(), start.elapsed().as_nanos());
+            write.write_all(rendered.as_bytes()).await?;
         }
         io::Result::Ok(())
     });

```

`isolate.py`:

```python
import os,sys,socket,json,time,tempfile,subprocess,statistics,pathlib,hashlib
binary=sys.argv[1]; dest=pathlib.Path(sys.argv[2]); reports=[]
def p95(v):return sorted(v)[int(len(v)*.95)-1]
for turn in range(3):
 with tempfile.TemporaryDirectory() as d:
  sock=d+'/rupd.sock'; env=dict(os.environ,RUPD_SOCKET=sock,XDG_DATA_HOME=d+'/data')
  log=open(str(dest)+f'-{turn}.stderr','w')
  child=subprocess.Popen([binary,d],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=log)
  try:
   for _ in range(10000):
    try:s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(sock);break
    except OSError:s.close();time.sleep(.001)
   reader=s.makefile('rb'); serial=0; events=[]
   def ask(method,params=None):
    global serial
    serial+=1;s.sendall((json.dumps(dict(jsonrpc='2.0',id=serial,method=method,params=params))+'\n').encode())
    while True:
     r=json.loads(reader.readline())
     if r.get('id')==serial:
      if 'error' in r:raise Exception(r)
      return r['result']
     events.append(r)
   def sample(method,params=None):
    vals=[]
    for i in range(1100):
     start=time.perf_counter_ns();ask(method,params);elapsed=(time.perf_counter_ns()-start)/1e6
     if i>=100:vals.append(elapsed)
    return dict(p50=statistics.median(vals),p95=p95(vals),values=vals)
   result=dict(load=os.getloadavg(),measurements={})
   for count in [0,40]:
    if count:
     for i in range(count):ask('rail.createWorkstream',dict(name=f'g{i}',parent=None))
    result['measurements'][f'ping-{count}']=sample('daemon.ping')
    result['measurements'][f'tree-{count}']=sample('rail.tree')
   ask('events.subscribe'); tid=ask('terminal.spawn',dict(cwd=d,command=['/bin/sh','-c','stty raw -echo; echo ready; exec cat'],env={},cols=80,rows=24))['id']
   def echo():
    while True:
     if events:r=events.pop(0)
     else:r=json.loads(reader.readline())
     if r.get('method')=='event' and r['params'].get('type')=='terminal.output':return
   # Event serde uses method field? inspect and allow matching id anywhere
   def echo():
    while True:
     r=events.pop(0) if events else json.loads(reader.readline())
     if r.get('method')=='event' and str(tid) in json.dumps(r) and ('terminal.output' in json.dumps(r)):return
   echo()
   for actor in ['user','ext','user']:
    ask('daemon.identify',dict(actor=dict(kind=actor,id=actor,parent=None)))
    vals=[]
    for i in range(1100):
     start=time.perf_counter_ns();ask('terminal.write',dict(id=tid,data='YQ==')); elapsed=(time.perf_counter_ns()-start)/1e6;echo()
     if i>=100:vals.append(elapsed)
    result['measurements'][f'write-{actor}-{len(result["measurements"])}']=dict(p50=statistics.median(vals),p95=p95(vals),values=vals)
   reports.append(result)
  finally:
   child.terminate();child.wait(timeout=10);log.close()
 dest.write_text(json.dumps(dict(binary=binary,sha256=hashlib.sha256(pathlib.Path(binary).read_bytes()).hexdigest(),reports=reports),indent=2))
 print(json.dumps({k:{m:{q:v[q] for q in ['p50','p95']} for m,v in r['measurements'].items()} for k,r in enumerate(reports)}))

```

## Every invocation report

Each JSONL row includes the untouched complete report, all eleven per-Daemon values, loads, exact invocation, log, exit and load qualification. Retaining busy rows preserves their unchanged memory comparison.

```jsonl
{"pair":1,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":0.4225,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-1-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[1.82,1.84,1.84,1.84,1.69,1.69,1.56,1.56,1.43,1.43,1.43],"metrics":{"cold_start_ms":15.549013,"ping_p95_ms":0.070853,"rail_tree_10_p95_ms":0.181159,"rail_tree_40_p95_ms":0.349132,"rss_extra_mb":2.50390625,"terminal_write_p95_ms":0.104605,"write_to_output_p95_ms":0.212137},"per_run":{"cold_start_ms":[12.744173,17.879121,17.449668000000003,19.910929,12.324765999999999,18.442822,12.357961000000001,18.753753000000003,15.549013,14.766178,14.491639000000001],"ping_p95_ms":[0.082805,0.08971799999999999,0.073267,0.078081,0.092263,0.065482,0.070853,0.06361900000000001,0.065974,0.062647,0.070782],"rail_tree_10_p95_ms":[0.215849,0.181159,0.2142,0.21895399999999998,0.21857100000000002,0.180187,0.275435,0.161853,0.175859,0.177642,0.178594],"rail_tree_40_p95_ms":[0.43266000000000004,0.376275,0.450923,0.439189,0.460764,0.34878200000000004,0.348061,0.34818099999999996,0.349132,0.319087,0.34251000000000004],"rss_extra_mb":[2.49609375,2.50390625,2.56640625,2.50390625,2.5703125,2.50390625,2.48046875,2.50390625,2.48828125,2.4921875,2.54296875],"terminal_write_p95_ms":[0.131406,0.126046,0.122451,0.12252899999999999,0.122158,0.104605,0.094586,0.097793,0.09622,0.102352,0.103854],"write_to_output_p95_ms":[0.228587,0.23725800000000002,0.229469,0.207348,0.341914,0.210584,0.21338600000000002,0.212137,0.21032599999999999,0.202711,0.204646]}},"log":"run 1/11: load 1.8 on 4 cpus\nrun 2/11: load 1.8 on 4 cpus\nrun 3/11: load 1.8 on 4 cpus\nrun 4/11: load 1.8 on 4 cpus\nrun 5/11: load 1.7 on 4 cpus\nrun 6/11: load 1.7 on 4 cpus\nrun 7/11: load 1.6 on 4 cpus\nrun 8/11: load 1.6 on 4 cpus\nrun 9/11: load 1.4 on 4 cpus\nrun 10/11: load 1.4 on 4 cpus\nrun 11/11: load 1.4 on 4 cpus\ncold_start_ms              median    15.549  range 12.325..19.911  ok\nping_p95_ms                median     0.071  range 0.063..0.092  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.181  range 0.162..0.275  ok\nrail_tree_40_p95_ms        median     0.349  range 0.319..0.461  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.504  range 2.480..2.570  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.105  range 0.095..0.131  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.212  range 0.203..0.342  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [1.82, 1.84, 1.84, 1.84, 1.69, 1.69, 1.56, 1.56, 1.43, 1.43, 1.43] -> /tmp/rail-evidence/paired-1-historical-1.json\n","qualification":"clean under R13"}
{"pair":1,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":0.53,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-1-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[2.44,2.44,2.24,2.22,2.12,2.12,2.03,2.03,2.03,1.95,1.87],"metrics":{"cold_start_ms":34.985530000000004,"ping_p95_ms":0.137327,"rail_tree_10_p95_ms":0.296572,"rail_tree_40_p95_ms":0.797801,"rss_extra_mb":2.59765625,"terminal_write_p95_ms":0.374781,"write_to_output_p95_ms":0.478244},"per_run":{"cold_start_ms":[32.633204,36.672831,33.734277999999996,40.121024,34.205227,35.040971,37.223267,34.985530000000004,36.269162,34.645807,34.493677],"ping_p95_ms":[0.137517,0.13431099999999999,0.146203,0.13943,0.150488,0.144781,0.134031,0.135733,0.12987200000000002,0.110116,0.137327],"rail_tree_10_p95_ms":[0.28070500000000004,0.382229,0.391146,0.292005,0.281947,0.296572,0.589645,0.364932,0.35068499999999997,0.291756,0.29134400000000005],"rail_tree_40_p95_ms":[0.7803289999999999,0.803171,0.904844,0.791729,0.77584,0.797801,0.798883,1.1366239999999999,0.795306,0.801298,0.790777],"rss_extra_mb":[2.6015625,2.59765625,2.7109375,2.6015625,2.34375,2.69921875,2.58984375,2.57421875,2.578125,2.66015625,2.21484375],"terminal_write_p95_ms":[0.37406100000000003,0.37501100000000004,0.36556,0.37008,0.367026,0.37616299999999997,0.374781,0.395509,0.629446,0.367226,0.677175],"write_to_output_p95_ms":[0.478161,0.482441,0.47632,0.477447,0.733611,0.48556499999999997,0.478244,0.495139,0.47747300000000004,0.47820399999999996,0.637842]}},"log":"run 1/11: load 2.4 on 4 cpus\nrun 2/11: load 2.4 on 4 cpus\nrun 3/11: load 2.2 on 4 cpus\nrun 4/11: load 2.2 on 4 cpus\nrun 5/11: load 2.1 on 4 cpus\nrun 6/11: load 2.1 on 4 cpus\nrun 7/11: load 2.0 on 4 cpus\nrun 8/11: load 2.0 on 4 cpus\nrun 9/11: load 2.0 on 4 cpus\nrun 10/11: load 1.9 on 4 cpus\nrun 11/11: load 1.9 on 4 cpus\ncold_start_ms              median    34.986  range 32.633..40.121  ok\nping_p95_ms                median     0.137  range 0.110..0.150  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.297  range 0.281..0.590  ok\nrail_tree_40_p95_ms        median     0.798  range 0.776..1.137  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.598  range 2.215..2.711  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.375  range 0.366..0.677  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.478  range 0.476..0.734  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [2.44, 2.44, 2.24, 2.22, 2.12, 2.12, 2.03, 2.03, 2.03, 1.95, 1.87] -> /tmp/rail-evidence/paired-1-repaired-1.json\n","qualification":"clean under R13"}
{"pair":2,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":0.6175,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-2-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[1.87,2.68,2.68,2.47,2.47,2.47,2.27,2.27,3.21,3.21,3.03],"metrics":{"cold_start_ms":14.947511,"ping_p95_ms":0.06957999999999999,"rail_tree_10_p95_ms":0.192129,"rail_tree_40_p95_ms":0.356707,"rss_extra_mb":2.5078125,"terminal_write_p95_ms":0.102149,"write_to_output_p95_ms":0.213724},"per_run":{"cold_start_ms":[12.31939,14.242967,14.813418,14.947511,16.911525,13.05261,15.731305,14.789089,15.151665999999999,15.077568,17.819654],"ping_p95_ms":[0.093084,0.115316,0.061915000000000005,0.06422,0.065663,0.07177399999999999,0.06957999999999999,0.060352,0.07709500000000001,0.06712599999999999,0.084528],"rail_tree_10_p95_ms":[0.189624,0.21420599999999998,0.19062300000000001,0.213288,0.214862,0.182561,0.363168,0.191164,0.17476699999999998,0.192129,0.21774500000000002],"rail_tree_40_p95_ms":[0.451689,0.458096,0.356707,0.614589,0.6046699999999999,0.350555,0.346758,0.345986,0.330428,0.34941300000000003,0.5009129999999999],"rss_extra_mb":[2.5546875,2.4921875,2.4921875,2.4921875,2.5625,2.48046875,2.5703125,2.50390625,2.56640625,2.5078125,2.5546875],"terminal_write_p95_ms":[0.107251,0.10118100000000001,0.106789,0.102149,0.09447699999999999,0.09593900000000001,0.100999,0.10068,0.10653900000000001,0.103877,0.13966099999999998],"write_to_output_p95_ms":[0.212332,0.233042,0.20982699999999999,0.215259,0.21104399999999998,0.217456,0.211275,0.220452,0.213724,0.210513,0.22071300000000002]}},"log":"run 1/11: load 1.9 on 4 cpus\nrun 2/11: load 2.7 on 4 cpus\nrun 3/11: load 2.7 on 4 cpus\nrun 4/11: load 2.5 on 4 cpus\nrun 5/11: load 2.5 on 4 cpus\nrun 6/11: load 2.5 on 4 cpus\nrun 7/11: load 2.3 on 4 cpus\nrun 8/11: load 2.3 on 4 cpus\nrun 9/11: load 3.2 on 4 cpus\nrun 10/11: load 3.2 on 4 cpus\nrun 11/11: load 3.0 on 4 cpus\ncold_start_ms              median    14.948  range 12.319..17.820  ok\nping_p95_ms                median     0.070  range 0.060..0.115  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.192  range 0.175..0.363  ok\nrail_tree_40_p95_ms        median     0.357  range 0.330..0.615  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.508  range 2.480..2.570  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.102  range 0.094..0.140  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.214  range 0.210..0.233  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [1.87, 2.68, 2.68, 2.47, 2.47, 2.47, 2.27, 2.27, 3.21, 3.21, 3.03] -> /tmp/rail-evidence/paired-2-historical-1.json\n","qualification":"clean under R13"}
{"pair":2,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":0.7375,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-2-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[3.03,2.95,2.71,2.71,2.58,2.45,2.45,3.53,3.33,3.33,3.06],"metrics":{"cold_start_ms":37.993955,"ping_p95_ms":0.136635,"rail_tree_10_p95_ms":0.29429,"rail_tree_40_p95_ms":0.8312219999999999,"rss_extra_mb":2.609375,"terminal_write_p95_ms":0.43478700000000003,"write_to_output_p95_ms":0.6111219999999999},"per_run":{"cold_start_ms":[56.154143,38.221236999999995,35.070582,34.683126,36.369101,38.001872999999996,40.477393,37.993955,33.466385,36.057539,40.48293],"ping_p95_ms":[0.172683,0.13095500000000002,0.149066,0.16245600000000002,0.14442,0.135764,0.44061300000000003,0.119714,0.136635,0.135513,0.13369],"rail_tree_10_p95_ms":[0.363259,0.303137,0.357837,0.26909299999999997,0.29429,0.292867,0.340777,0.288309,0.333951,0.273141,0.284773],"rail_tree_40_p95_ms":[1.49156,0.956024,1.335077,0.789154,0.8312219999999999,0.8060959999999999,0.946779,0.764008,0.80786,1.435543,0.765249],"rss_extra_mb":[2.49609375,2.65234375,2.609375,2.59375,2.4140625,2.60546875,2.6484375,2.6015625,2.6484375,2.71484375,2.6640625],"terminal_write_p95_ms":[0.6613450000000001,0.515272,0.37018100000000004,0.540089,0.35934,0.538432,0.455369,0.35672600000000004,0.365002,0.37079,0.43478700000000003],"write_to_output_p95_ms":[0.879929,0.614146,0.49173900000000004,0.648952,0.501227,0.636579,0.643776,0.473746,0.471702,0.6111219999999999,0.482842]}},"log":"run 1/11: load 3.0 on 4 cpus\nrun 2/11: load 3.0 on 4 cpus\nrun 3/11: load 2.7 on 4 cpus\nrun 4/11: load 2.7 on 4 cpus\nrun 5/11: load 2.6 on 4 cpus\nrun 6/11: load 2.5 on 4 cpus\nrun 7/11: load 2.5 on 4 cpus\nrun 8/11: load 3.5 on 4 cpus\nrun 9/11: load 3.3 on 4 cpus\nrun 10/11: load 3.3 on 4 cpus\nrun 11/11: load 3.1 on 4 cpus\ncold_start_ms              median    37.994  range 33.466..56.154  ok\nping_p95_ms                median     0.137  range 0.120..0.441  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.294  range 0.269..0.363  ok\nrail_tree_40_p95_ms        median     0.831  range 0.764..1.492  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.609  range 2.414..2.715  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.435  range 0.357..0.661  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.611  range 0.472..0.880  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [3.03, 2.95, 2.71, 2.71, 2.58, 2.45, 2.45, 3.53, 3.33, 3.33, 3.06] -> /tmp/rail-evidence/paired-2-repaired-1.json\n","qualification":"clean under R13"}
{"pair":3,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":0.725,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-3-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[2.9,2.9,2.75,2.75,2.77,2.77,2.77,3.67,3.67,3.37,3.37],"metrics":{"cold_start_ms":16.381753,"ping_p95_ms":0.070933,"rail_tree_10_p95_ms":0.21071299999999998,"rail_tree_40_p95_ms":0.444501,"rss_extra_mb":2.50390625,"terminal_write_p95_ms":0.114875,"write_to_output_p95_ms":0.23357599999999998},"per_run":{"cold_start_ms":[18.302882999999998,16.381753,15.321095,16.825606,18.199223,15.055380999999999,17.818814999999997,17.767267999999998,15.440606,16.089968,16.142024000000003],"ping_p95_ms":[0.064541,0.06870799999999999,0.062707,0.062125999999999994,0.078217,0.070933,0.077648,0.079899,0.06967,0.09782300000000001,0.07659300000000001],"rail_tree_10_p95_ms":[0.322743,0.18043700000000001,0.180538,0.176519,0.21588600000000002,0.21071299999999998,0.231102,0.21110500000000001,0.176269,0.21396800000000002,0.20918799999999999],"rail_tree_40_p95_ms":[0.402054,0.413202,0.330918,0.34939299999999995,0.444501,0.338592,0.480806,0.557071,0.477372,0.521635,0.557161],"rss_extra_mb":[2.4921875,2.56640625,2.50390625,2.50390625,2.5078125,2.4921875,2.4921875,2.56640625,2.5546875,2.48046875,2.5625],"terminal_write_p95_ms":[0.106399,0.101159,0.101274,0.18004699999999998,0.114875,0.114624,0.13781700000000002,0.0909,0.158857,0.15776500000000002,0.19625700000000001],"write_to_output_p95_ms":[0.206305,0.211294,0.209451,0.310139,0.327384,0.21735600000000002,0.457715,0.221303,0.41261800000000004,0.296193,0.23357599999999998]}},"log":"run 1/11: load 2.9 on 4 cpus\nrun 2/11: load 2.9 on 4 cpus\nrun 3/11: load 2.8 on 4 cpus\nrun 4/11: load 2.8 on 4 cpus\nrun 5/11: load 2.8 on 4 cpus\nrun 6/11: load 2.8 on 4 cpus\nrun 7/11: load 2.8 on 4 cpus\nrun 8/11: load 3.7 on 4 cpus\nrun 9/11: load 3.7 on 4 cpus\nrun 10/11: load 3.4 on 4 cpus\nrun 11/11: load 3.4 on 4 cpus\ncold_start_ms              median    16.382  range 15.055..18.303  ok\nping_p95_ms                median     0.071  range 0.062..0.098  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.211  range 0.176..0.323  ok\nrail_tree_40_p95_ms        median     0.445  range 0.331..0.557  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.504  range 2.480..2.566  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.115  range 0.091..0.196  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.234  range 0.206..0.458  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [2.9, 2.9, 2.75, 2.75, 2.77, 2.77, 2.77, 3.67, 3.67, 3.37, 3.37] -> /tmp/rail-evidence/paired-3-historical-1.json\n","qualification":"clean under R13"}
{"pair":3,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":0.935,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-3-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[3.1,3.1,4.62,4.33,4.33,3.98,3.74,3.74,3.44,3.25,3.25],"metrics":{"cold_start_ms":37.261057,"ping_p95_ms":0.134762,"rail_tree_10_p95_ms":0.295452,"rail_tree_40_p95_ms":0.800977,"rss_extra_mb":2.59765625,"terminal_write_p95_ms":0.370518,"write_to_output_p95_ms":0.47977600000000004},"per_run":{"cold_start_ms":[30.338844,50.287215,66.057014,42.319303000000005,36.344616,35.875392999999995,33.346122,36.562081000000006,37.953030999999996,37.261057,41.498388],"ping_p95_ms":[0.15158000000000002,0.13319899999999998,0.149359,0.131936,0.137627,0.132668,0.134762,0.13400099999999998,0.141173,0.13603300000000002,0.11237],"rail_tree_10_p95_ms":[0.366424,0.3746,0.303417,0.38640199999999997,0.29570300000000005,0.285804,0.281366,0.287267,0.27248,0.29527200000000003,0.295452],"rail_tree_40_p95_ms":[1.3308470000000001,1.128829,1.1384450000000002,0.9834579999999999,0.7898449999999999,0.787081,0.800977,0.75466,0.786149,0.805926,0.798342],"rss_extra_mb":[2.05078125,2.59375,2.62890625,2.59765625,2.70703125,2.609375,2.578125,2.6640625,2.59375,2.625,2.59375],"terminal_write_p95_ms":[0.485317,0.534919,0.533908,0.357318,0.366751,0.370518,0.36966,0.36339,0.375118,0.3744,0.36661499999999997],"write_to_output_p95_ms":[0.900345,0.653621,0.676063,0.474036,0.476974,0.47028400000000004,0.546591,0.465651,0.486409,0.47977600000000004,0.47584899999999997]}},"log":"run 1/11: load 3.1 on 4 cpus\nrun 2/11: load 3.1 on 4 cpus\nrun 3/11: load 4.6 on 4 cpus\nrun 4/11: load 4.3 on 4 cpus\nrun 5/11: load 4.3 on 4 cpus\nrun 6/11: load 4.0 on 4 cpus\nrun 7/11: load 3.7 on 4 cpus\nrun 8/11: load 3.7 on 4 cpus\nrun 9/11: load 3.4 on 4 cpus\nrun 10/11: load 3.2 on 4 cpus\nrun 11/11: load 3.2 on 4 cpus\ncold_start_ms              median    37.261  range 30.339..66.057  ok\nping_p95_ms                median     0.135  range 0.112..0.152  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.295  range 0.272..0.386  ok\nrail_tree_40_p95_ms        median     0.801  range 0.755..1.331  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.598  range 2.051..2.707  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.371  range 0.357..0.535  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.480  range 0.466..0.900  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [3.1, 3.1, 4.62, 4.33, 4.33, 3.98, 3.74, 3.74, 3.44, 3.25, 3.25] -> /tmp/rail-evidence/paired-3-repaired-1.json\n","qualification":"clean under R13"}
{"pair":4,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":0.745,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-4-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[2.98,2.75,2.75,2.75,3.41,3.41,3.21,3.21,3.21,2.96,2.96],"metrics":{"cold_start_ms":14.993108999999999,"ping_p95_ms":0.066374,"rail_tree_10_p95_ms":0.176943,"rail_tree_40_p95_ms":0.342625,"rss_extra_mb":2.50390625,"terminal_write_p95_ms":0.10109,"write_to_output_p95_ms":0.206846},"per_run":{"cold_start_ms":[13.340387,16.970470000000002,16.67438,22.568545,13.388673,14.993108999999999,13.821888,15.887511,14.774591000000001,13.443662,17.675375],"ping_p95_ms":[0.063922,0.066374,0.069069,0.06272699999999999,0.06809799999999999,0.070713,0.061776,0.063559,0.06847,0.07115400000000001,0.064091],"rail_tree_10_p95_ms":[0.178258,0.151043,0.186188,0.178865,0.176728,0.178156,0.176943,0.175731,0.151756,0.176924,0.178728],"rail_tree_40_p95_ms":[0.34825900000000004,0.338874,0.350816,0.31050099999999997,0.339658,0.346823,0.342625,0.341913,0.33660599999999996,0.34965,0.351794],"rss_extra_mb":[2.50390625,2.50390625,2.4921875,2.5546875,2.50390625,2.55859375,2.50390625,2.50390625,2.4921875,2.5546875,2.5078125],"terminal_write_p95_ms":[0.100517,0.101346,0.120888,0.099797,0.09508899999999999,0.105379,0.104838,0.106931,0.10109,0.08990000000000001,0.094689],"write_to_output_p95_ms":[0.213641,0.206846,0.215222,0.209091,0.204054,0.206519,0.204735,0.199566,0.20824299999999998,0.208894,0.205178]}},"log":"run 1/11: load 3.0 on 4 cpus\nrun 2/11: load 2.8 on 4 cpus\nrun 3/11: load 2.8 on 4 cpus\nrun 4/11: load 2.8 on 4 cpus\nrun 5/11: load 3.4 on 4 cpus\nrun 6/11: load 3.4 on 4 cpus\nrun 7/11: load 3.2 on 4 cpus\nrun 8/11: load 3.2 on 4 cpus\nrun 9/11: load 3.2 on 4 cpus\nrun 10/11: load 3.0 on 4 cpus\nrun 11/11: load 3.0 on 4 cpus\ncold_start_ms              median    14.993  range 13.340..22.569  ok\nping_p95_ms                median     0.066  range 0.062..0.071  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.177  range 0.151..0.186  ok\nrail_tree_40_p95_ms        median     0.343  range 0.311..0.352  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.504  range 2.492..2.559  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.101  range 0.090..0.121  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.207  range 0.200..0.215  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [2.98, 2.75, 2.75, 2.75, 3.41, 3.41, 3.21, 3.21, 3.21, 2.96, 2.96] -> /tmp/rail-evidence/paired-4-historical-1.json\n","qualification":"clean under R13"}
{"pair":4,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":1.0875,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-4-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[2.72,2.72,3.78,3.56,3.56,4.64,4.35,4.35,5.44,5.0,5.0],"metrics":{"cold_start_ms":34.854753,"ping_p95_ms":0.12608699999999998,"rail_tree_10_p95_ms":0.282972,"rail_tree_40_p95_ms":0.785991,"rss_extra_mb":2.6015625,"terminal_write_p95_ms":0.36439699999999997,"write_to_output_p95_ms":0.47679200000000005},"per_run":{"cold_start_ms":[32.554925,34.556005,31.412822,34.663084,34.878572,34.814612000000004,34.854753,36.169199,42.304294,36.295768,38.354154],"ping_p95_ms":[0.11094899999999999,0.110468,0.135044,0.12608699999999998,0.113243,0.114245,0.120808,0.12923300000000001,0.13611600000000001,0.13645700000000002,0.13109600000000002],"rail_tree_10_p95_ms":[0.29512700000000003,0.292872,0.282972,0.26322500000000004,0.28692,0.285958,0.280528,0.254379,0.25726,0.277102,0.30089299999999997],"rail_tree_40_p95_ms":[0.777265,0.7597119999999999,0.740035,0.772976,0.785991,0.801609,0.789847,0.7945260000000001,0.792701,0.8037839999999999,0.7826550000000001],"rss_extra_mb":[2.57421875,2.6015625,2.65625,2.6015625,2.6015625,2.71484375,2.59765625,2.6015625,2.67578125,2.5859375,2.72265625],"terminal_write_p95_ms":[0.362771,0.35980799999999996,0.366769,0.361481,0.366059,0.36420600000000003,0.365197,0.367717,0.36439699999999997,0.374696,0.363724],"write_to_output_p95_ms":[0.47186,0.476618,0.47881300000000004,0.492202,0.472505,0.47407200000000005,0.485301,0.47679200000000005,0.48261000000000004,0.480536,0.475014]}},"log":"run 1/11: load 2.7 on 4 cpus\nrun 2/11: load 2.7 on 4 cpus\nrun 3/11: load 3.8 on 4 cpus\nrun 4/11: load 3.6 on 4 cpus\nrun 5/11: load 3.6 on 4 cpus\nrun 6/11: load 4.6 on 4 cpus\nrun 7/11: load 4.3 on 4 cpus\nrun 8/11: load 4.3 on 4 cpus\nrun 9/11: load 5.4 on 4 cpus\nrun 10/11: load 5.0 on 4 cpus\nrun 11/11: load 5.0 on 4 cpus\ncold_start_ms              median    34.855  range 31.413..42.304  ok\nping_p95_ms                median     0.126  range 0.110..0.136  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.283  range 0.254..0.301  ok\nrail_tree_40_p95_ms        median     0.786  range 0.740..0.804  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.602  range 2.574..2.723  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.364  range 0.360..0.375  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.477  range 0.472..0.492  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [2.72, 2.72, 3.78, 3.56, 3.56, 4.64, 4.35, 4.35, 5.44, 5.0, 5.0] -> /tmp/rail-evidence/paired-4-repaired-1.json\n","qualification":"clean under R13"}
{"pair":5,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":1.28,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-5-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[5.56,5.56,5.12,5.12,4.79,4.79,4.4,4.4,4.4,5.33,5.33],"metrics":{"cold_start_ms":15.310806999999999,"ping_p95_ms":0.06572299999999999,"rail_tree_10_p95_ms":0.185209,"rail_tree_40_p95_ms":0.354975,"rss_extra_mb":2.50390625,"terminal_write_p95_ms":0.10550799999999999,"write_to_output_p95_ms":0.210278},"per_run":{"cold_start_ms":[13.264471,16.247673,14.396391,17.7492,13.993438000000001,15.310806999999999,15.414495,12.900898,13.919371,17.29741,25.423343000000003],"ping_p95_ms":[0.064521,0.063029,0.065462,0.06437,0.067647,0.065824,0.06359000000000001,0.06572299999999999,0.07938,0.07137399999999999,0.08967800000000001],"rail_tree_10_p95_ms":[0.174809,0.177054,0.185209,0.23463499999999998,0.180059,0.153138,0.194442,0.17907700000000001,0.217689,0.2075,0.209281],"rail_tree_40_p95_ms":[0.336604,0.357624,0.335258,0.354975,0.31883,0.35584,0.349487,0.336852,0.448113,0.41454,0.461163],"rss_extra_mb":[2.50390625,2.50390625,2.4921875,2.5625,2.5703125,2.50390625,2.5078125,2.55859375,2.4921875,2.56640625,2.4921875],"terminal_write_p95_ms":[0.088843,0.105819,0.10517699999999999,0.10641,0.09477899999999999,0.104223,0.10550799999999999,0.106801,0.105987,0.113975,0.10210200000000001],"write_to_output_p95_ms":[0.21190900000000001,0.210278,0.204874,0.215388,0.20511100000000002,0.20278200000000002,0.209474,0.211064,0.230183,0.21057599999999999,0.205676]}},"log":"run 1/11: load 5.6 on 4 cpus\nrun 2/11: load 5.6 on 4 cpus\nrun 3/11: load 5.1 on 4 cpus\nrun 4/11: load 5.1 on 4 cpus\nrun 5/11: load 4.8 on 4 cpus\nrun 6/11: load 4.8 on 4 cpus\nrun 7/11: load 4.4 on 4 cpus\nrun 8/11: load 4.4 on 4 cpus\nrun 9/11: load 4.4 on 4 cpus\nrun 10/11: load 5.3 on 4 cpus\nrun 11/11: load 5.3 on 4 cpus\ncold_start_ms              median    15.311  range 12.901..25.423  ok\nping_p95_ms                median     0.066  range 0.063..0.090  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.185  range 0.153..0.235  ok\nrail_tree_40_p95_ms        median     0.355  range 0.319..0.461  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.504  range 2.492..2.570  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.106  range 0.089..0.114  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.210  range 0.203..0.230  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [5.56, 5.56, 5.12, 5.12, 4.79, 4.79, 4.4, 4.4, 4.4, 5.33, 5.33] -> /tmp/rail-evidence/paired-5-historical-1.json\n","qualification":"clean under R13"}
{"pair":5,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":1.3025,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-5-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[4.99,4.99,5.39,5.12,5.03,5.03,5.75,5.6,5.32,5.21,5.21],"metrics":{"cold_start_ms":38.53009,"ping_p95_ms":0.149844,"rail_tree_10_p95_ms":0.341476,"rail_tree_40_p95_ms":1.136133,"rss_extra_mb":2.6015625,"terminal_write_p95_ms":0.527061,"write_to_output_p95_ms":0.655173},"per_run":{"cold_start_ms":[38.050016,38.53009,36.197925,50.635474,99.760844,58.010489,149.048164,37.071126,35.811211,38.498712999999995,42.19016],"ping_p95_ms":[0.146423,0.131958,0.144651,0.136687,0.149785,0.149844,0.165661,0.163106,0.168035,0.160893,0.192301],"rail_tree_10_p95_ms":[0.341476,0.27313400000000004,0.321042,0.345379,0.311916,0.328693,0.34654,0.441879,0.41986999999999997,0.372189,0.28735],"rail_tree_40_p95_ms":[1.1038160000000001,0.786226,0.9556509999999999,1.179168,0.942943,0.956198,1.1389580000000001,1.435559,1.2707140000000001,1.187562,1.136133],"rss_extra_mb":[2.61328125,2.59765625,2.59765625,2.6484375,2.66015625,2.5859375,2.6484375,2.6015625,2.66015625,2.21484375,2.5859375],"terminal_write_p95_ms":[0.54752,0.366688,0.488198,0.496293,0.485943,0.5401959999999999,0.530355,0.527061,0.569696,0.490832,0.759456],"write_to_output_p95_ms":[0.655173,0.485804,0.59579,1.264338,0.590901,0.477277,0.710023,1.037932,1.047846,0.614866,1.857053]}},"log":"run 1/11: load 5.0 on 4 cpus\nrun 2/11: load 5.0 on 4 cpus\nrun 3/11: load 5.4 on 4 cpus\nrun 4/11: load 5.1 on 4 cpus\nrun 5/11: load 5.0 on 4 cpus\nrun 6/11: load 5.0 on 4 cpus\nrun 7/11: load 5.8 on 4 cpus\nrun 8/11: load 5.6 on 4 cpus\nrun 9/11: load 5.3 on 4 cpus\nrun 10/11: load 5.2 on 4 cpus\nrun 11/11: load 5.2 on 4 cpus\ncold_start_ms              median    38.530  range 35.811..149.048  ok\nping_p95_ms                median     0.150  range 0.132..0.192  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.341  range 0.273..0.442  ok\nrail_tree_40_p95_ms        median     1.136  range 0.786..1.436  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.602  range 2.215..2.660  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.527  range 0.367..0.759  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.655  range 0.477..1.857  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [4.99, 4.99, 5.39, 5.12, 5.03, 5.03, 5.75, 5.6, 5.32, 5.21, 5.21] -> /tmp/rail-evidence/paired-5-repaired-1.json\n","qualification":"clean under R13"}
{"pair":6,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":1.1475,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-6-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[5.43,5.24,5.24,4.9,4.9,4.59,4.59,4.59,4.38,4.38,4.11],"metrics":{"cold_start_ms":18.393742,"ping_p95_ms":0.082074,"rail_tree_10_p95_ms":0.230287,"rail_tree_40_p95_ms":0.50719,"rss_extra_mb":2.50390625,"terminal_write_p95_ms":0.13611600000000001,"write_to_output_p95_ms":0.299983},"per_run":{"cold_start_ms":[17.698539999999998,16.358577999999998,18.393742,20.844831000000003,15.621022,18.515532,20.405736,18.561346999999998,17.022586,17.510322,22.529124],"ping_p95_ms":[0.109035,0.065022,0.101881,0.071124,0.065593,0.097313,0.082074,0.135835,0.100879,0.06917999999999999,0.081753],"rail_tree_10_p95_ms":[0.775328,0.215251,0.236895,0.192392,0.19218100000000002,0.215275,0.313188,0.364956,0.284112,0.230287,0.227217],"rail_tree_40_p95_ms":[1.0097669999999999,0.6842140000000001,0.504845,0.450987,0.348325,0.50567,0.508746,0.900292,0.456996,0.50719,0.529024],"rss_extra_mb":[2.50390625,2.56640625,2.48046875,2.5,2.5078125,2.484375,2.484375,2.50390625,2.50390625,2.48046875,2.50390625],"terminal_write_p95_ms":[0.13611600000000001,0.15845700000000001,0.194164,0.15964,0.118724,0.38500300000000004,0.20176999999999998,0.114255,0.11793100000000001,0.113535,0.122731],"write_to_output_p95_ms":[1.250931,0.855546,0.6500199999999999,0.459414,0.20519,0.238729,0.299983,0.214962,0.236443,0.210514,0.48514100000000004]}},"log":"run 1/11: load 5.4 on 4 cpus\nrun 2/11: load 5.2 on 4 cpus\nrun 3/11: load 5.2 on 4 cpus\nrun 4/11: load 4.9 on 4 cpus\nrun 5/11: load 4.9 on 4 cpus\nrun 6/11: load 4.6 on 4 cpus\nrun 7/11: load 4.6 on 4 cpus\nrun 8/11: load 4.6 on 4 cpus\nrun 9/11: load 4.4 on 4 cpus\nrun 10/11: load 4.4 on 4 cpus\nrun 11/11: load 4.1 on 4 cpus\ncold_start_ms              median    18.394  range 15.621..22.529  ok\nping_p95_ms                median     0.082  range 0.065..0.136  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.230  range 0.192..0.775  ok\nrail_tree_40_p95_ms        median     0.507  range 0.348..1.010  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.504  range 2.480..2.566  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.136  range 0.114..0.385  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.300  range 0.205..1.251  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [5.43, 5.24, 5.24, 4.9, 4.9, 4.59, 4.59, 4.59, 4.38, 4.38, 4.11] -> /tmp/rail-evidence/paired-6-historical-1.json\n","qualification":"clean under R13"}
{"pair":6,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":2.5725,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-6-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[4.11,5.54,9.02,10.28,10.82,11.56,11.51,10.99,11.23,10.29,10.03],"metrics":{"cold_start_ms":68.931941,"ping_p95_ms":0.297778,"rail_tree_10_p95_ms":1.085437,"rail_tree_40_p95_ms":3.4389149999999997,"rss_extra_mb":2.1015625,"terminal_write_p95_ms":1.625769,"write_to_output_p95_ms":2.111023},"per_run":{"cold_start_ms":[32.947418,43.455571,189.69888500000002,50.495883,68.931941,84.163434,75.96143599999999,73.60513300000001,54.493621,82.789686,59.267367],"ping_p95_ms":[2.50125,1.185547,1.941492,0.170761,0.245141,0.260529,0.297778,0.198252,0.166582,0.463298,0.575869],"rail_tree_10_p95_ms":[0.39525299999999997,0.439915,5.9268979999999996,2.633279,0.856629,0.968489,1.194763,1.085437,0.421211,3.5078,1.222564],"rail_tree_40_p95_ms":[1.834671,3.009242,8.004258,4.152836,3.344309,2.6668439999999998,3.4389149999999997,3.456027,2.876563,5.142329999999999,3.777403],"rss_extra_mb":[2.58984375,2.1640625,1.9765625,2.02734375,1.96484375,2.0859375,2.1015625,2.109375,2.1015625,1.96484375,2.1015625],"terminal_write_p95_ms":[0.583063,4.957755000000001,1.625769,1.434368,1.543639,1.462103,2.1334359999999997,1.6769479999999999,1.174262,1.957513,2.318057],"write_to_output_p95_ms":[2.019065,3.031824,2.426522,2.1665669999999997,2.111023,2.012496,1.353444,1.5231489999999999,1.7601719999999998,4.514524,3.102758]}},"log":"run 1/11: load 4.1 on 4 cpus\nrun 2/11: load 5.5 on 4 cpus\nrun 3/11: load 9.0 on 4 cpus\nrun 4/11: load 10.3 on 4 cpus\nrun 5/11: load 10.8 on 4 cpus\nrun 6/11: load 11.6 on 4 cpus\nrun 7/11: load 11.5 on 4 cpus\nrun 8/11: load 11.0 on 4 cpus\nrun 9/11: load 11.2 on 4 cpus\nrun 10/11: load 10.3 on 4 cpus\nrun 11/11: load 10.0 on 4 cpus\ncold_start_ms              median    68.932  range 32.947..189.699  ok\nping_p95_ms                median     0.298  range 0.167..2.501  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     1.085  range 0.395..5.927  ok\nrail_tree_40_p95_ms        median     3.439  range 1.835..8.004  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.102  range 1.965..2.590  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     1.626  range 0.583..4.958  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     2.111  range 1.353..4.515  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [4.11, 5.54, 9.02, 10.28, 10.82, 11.56, 11.51, 10.99, 11.23, 10.29, 10.03] -> /tmp/rail-evidence/paired-6-repaired-1.json\n","qualification":"busy: median load 2.5725 per CPU exceeds 2.0; not counted"}
{"pair":6,"reference":"repaired","attempt":2,"exit":1,"median_load_per_cpu":3.0525,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-6-repaired-2.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[10.5,11.64,11.75,12.97,12.21,11.87,12.51,12.31,12.21,12.59,12.3],"metrics":{"cold_start_ms":89.19256200000001,"ping_p95_ms":0.203181,"rail_tree_10_p95_ms":1.469906,"rail_tree_40_p95_ms":4.007095,"rss_extra_mb":1.9765625,"terminal_write_p95_ms":2.215704,"write_to_output_p95_ms":2.6716930000000003},"per_run":{"cold_start_ms":[70.14800699999999,84.90585,78.236599,102.61970199999999,96.647499,90.244479,133.550012,89.19256200000001,84.110608,66.23509700000001,102.92477099999999],"ping_p95_ms":[0.939793,1.5173940000000001,0.155582,0.158557,0.156714,0.903534,0.231323,0.16250499999999998,0.16606100000000001,3.012081,0.203181],"rail_tree_10_p95_ms":[2.2834589999999997,2.545142,0.425036,1.4344189999999999,1.469906,3.046277,2.9484749999999997,1.607631,1.338588,0.528089,0.761477],"rail_tree_40_p95_ms":[4.761673999999999,3.074112,4.007095,3.374419,3.772172,6.076541000000001,4.668211,3.652967,2.6863439999999996,5.251685,4.164035],"rss_extra_mb":[1.984375,1.98046875,2.01171875,2.28125,1.9609375,1.97265625,1.97265625,2.08203125,1.96484375,1.9765625,1.9765625],"terminal_write_p95_ms":[2.215704,1.5391160000000002,1.94093,2.26943,3.228799,3.4537410000000004,2.927032,1.775448,2.0501009999999997,4.006879,1.722077],"write_to_output_p95_ms":[5.817792,2.546864,2.2970669999999997,3.381712,2.923508,4.606982,2.878546,2.5139720000000003,2.420264,1.179028,2.6716930000000003]}},"log":"run 1/11: load 10.5 on 4 cpus\nrun 2/11: load 11.6 on 4 cpus\nrun 3/11: load 11.8 on 4 cpus\nrun 4/11: load 13.0 on 4 cpus\nrun 5/11: load 12.2 on 4 cpus\nrun 6/11: load 11.9 on 4 cpus\nrun 7/11: load 12.5 on 4 cpus\nrun 8/11: load 12.3 on 4 cpus\nrun 9/11: load 12.2 on 4 cpus\nrun 10/11: load 12.6 on 4 cpus\nrun 11/11: load 12.3 on 4 cpus\ncold_start_ms              median    89.193  range 66.235..133.550  ok\nping_p95_ms                median     0.203  range 0.156..3.012  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     1.470  range 0.425..3.046  ok\nrail_tree_40_p95_ms        median     4.007  range 2.686..6.077  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     1.977  range 1.961..2.281  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     2.216  range 1.539..4.007  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     2.672  range 1.179..5.818  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [10.5, 11.64, 11.75, 12.97, 12.21, 11.87, 12.51, 12.31, 12.21, 12.59, 12.3] -> /tmp/rail-evidence/paired-6-repaired-2.json\n","qualification":"busy: median load 3.0525 per CPU exceeds 2.0; not counted"}
{"pair":6,"reference":"repaired","attempt":3,"exit":1,"median_load_per_cpu":2.925,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-6-repaired-3.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[12.08,11.46,11.83,12.35,12.24,12.46,11.01,10.93,11.5,11.7,11.4],"metrics":{"cold_start_ms":73.53801299999999,"ping_p95_ms":0.336941,"rail_tree_10_p95_ms":1.1915300000000002,"rail_tree_40_p95_ms":3.84183,"rss_extra_mb":1.9765625,"terminal_write_p95_ms":1.817064,"write_to_output_p95_ms":2.084363},"per_run":{"cold_start_ms":[67.033798,80.041224,79.195903,95.40832300000001,81.88894300000001,72.158731,43.808262,73.53801299999999,58.213415,57.740536,103.11615],"ping_p95_ms":[2.015447,0.254597,4.4168,0.5415030000000001,0.336941,0.176561,0.49290300000000004,0.247453,0.185398,0.157775,3.62597],"rail_tree_10_p95_ms":[2.564331,0.490279,4.155204,1.146522,1.9736570000000002,1.849563,0.44500300000000004,1.1915300000000002,0.444052,0.847367,5.312411],"rail_tree_40_p95_ms":[4.009746,3.2629629999999996,9.566122,4.181050000000001,3.3766640000000003,4.424466,3.365853,3.84183,3.131683,3.689438,4.134006],"rss_extra_mb":[2.09375,1.95703125,1.96875,2.01953125,2.09375,1.96484375,2.015625,1.96484375,1.9765625,1.96484375,2.13671875],"terminal_write_p95_ms":[1.5196669999999999,2.2908619999999997,1.817064,2.0163770000000003,2.4636139999999997,1.283403,1.837631,1.320109,1.723918,0.7350460000000001,3.1258890000000004],"write_to_output_p95_ms":[3.092755,4.280397,3.4208979999999998,1.9713119999999997,1.5166,2.084363,2.7986809999999998,1.914903,2.0068479999999997,1.43188,5.504467]}},"log":"run 1/11: load 12.1 on 4 cpus\nrun 2/11: load 11.5 on 4 cpus\nrun 3/11: load 11.8 on 4 cpus\nrun 4/11: load 12.3 on 4 cpus\nrun 5/11: load 12.2 on 4 cpus\nrun 6/11: load 12.5 on 4 cpus\nrun 7/11: load 11.0 on 4 cpus\nrun 8/11: load 10.9 on 4 cpus\nrun 9/11: load 11.5 on 4 cpus\nrun 10/11: load 11.7 on 4 cpus\nrun 11/11: load 11.4 on 4 cpus\ncold_start_ms              median    73.538  range 43.808..103.116  ok\nping_p95_ms                median     0.337  range 0.158..4.417  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     1.192  range 0.444..5.312  ok\nrail_tree_40_p95_ms        median     3.842  range 3.132..9.566  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     1.977  range 1.957..2.137  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     1.817  range 0.735..3.126  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     2.084  range 1.432..5.504  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [12.08, 11.46, 11.83, 12.35, 12.24, 12.46, 11.01, 10.93, 11.5, 11.7, 11.4] -> /tmp/rail-evidence/paired-6-repaired-3.json\n","qualification":"busy: median load 2.925 per CPU exceeds 2.0; not counted"}
{"pair":6,"reference":"repaired","attempt":4,"exit":1,"median_load_per_cpu":0.5575,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-6-repaired-4.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[1.26,1.26,1.16,1.14,1.14,2.33,2.23,2.23,3.49,3.21,3.21],"metrics":{"cold_start_ms":32.731569,"ping_p95_ms":0.135133,"rail_tree_10_p95_ms":0.292106,"rail_tree_40_p95_ms":0.80264,"rss_extra_mb":2.6015625,"terminal_write_p95_ms":0.36528299999999997,"write_to_output_p95_ms":0.477293},"per_run":{"cold_start_ms":[31.864699,32.731569,31.93083,31.729833999999997,33.586051999999995,32.989809,32.817547000000005,33.567251999999996,35.228655999999994,31.399875,30.023494000000003],"ping_p95_ms":[0.11267100000000001,0.111108,0.135133,0.137386,0.114414,0.135413,0.13374,0.136916,0.136315,0.135924,0.12782900000000003],"rail_tree_10_p95_ms":[0.250859,0.29553199999999996,0.26670900000000003,0.29309799999999997,0.26188,0.296655,0.290794,0.280384,0.333423,0.292106,0.29590299999999997],"rail_tree_40_p95_ms":[0.73327,0.818079,0.80264,0.834762,0.804234,0.845932,0.8003669999999999,0.773266,0.7724439999999999,0.80281,0.773836],"rss_extra_mb":[2.6640625,2.6015625,2.6484375,2.6015625,2.62890625,2.58203125,2.59375,2.59375,2.5859375,2.5859375,2.6640625],"terminal_write_p95_ms":[0.360945,0.366335,0.36343,0.36488299999999996,0.362959,0.361045,0.3744,0.366365,0.36528299999999997,0.367006,0.384668],"write_to_output_p95_ms":[0.472901,0.47613700000000003,0.470553,0.481298,0.478157,0.47127600000000003,0.477748,0.477293,0.471631,0.48724100000000004,0.49009300000000006]}},"log":"run 1/11: load 1.3 on 4 cpus\nrun 2/11: load 1.3 on 4 cpus\nrun 3/11: load 1.2 on 4 cpus\nrun 4/11: load 1.1 on 4 cpus\nrun 5/11: load 1.1 on 4 cpus\nrun 6/11: load 2.3 on 4 cpus\nrun 7/11: load 2.2 on 4 cpus\nrun 8/11: load 2.2 on 4 cpus\nrun 9/11: load 3.5 on 4 cpus\nrun 10/11: load 3.2 on 4 cpus\nrun 11/11: load 3.2 on 4 cpus\ncold_start_ms              median    32.732  range 30.023..35.229  ok\nping_p95_ms                median     0.135  range 0.111..0.137  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.292  range 0.251..0.333  ok\nrail_tree_40_p95_ms        median     0.803  range 0.733..0.846  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.602  range 2.582..2.664  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.365  range 0.361..0.385  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.477  range 0.471..0.490  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [1.26, 1.26, 1.16, 1.14, 1.14, 2.33, 2.23, 2.23, 3.49, 3.21, 3.21] -> /tmp/rail-evidence/paired-6-repaired-4.json\n","qualification":"clean under R13"}
{"pair":7,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":0.9175,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-7-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[4.0,4.0,3.67,3.67,3.38,3.38,3.11,3.11,3.11,4.06,4.06],"metrics":{"cold_start_ms":14.504662,"ping_p95_ms":0.06439,"rail_tree_10_p95_ms":0.17947500000000002,"rail_tree_40_p95_ms":0.34622400000000003,"rss_extra_mb":2.50390625,"terminal_write_p95_ms":0.103984,"write_to_output_p95_ms":0.206916},"per_run":{"cold_start_ms":[11.223299,14.172495,17.856943,14.28477,14.504662,12.698606,15.119955,13.014152,17.889022,16.361383,16.04073],"ping_p95_ms":[0.07130399999999999,0.06675400000000001,0.06439,0.064049,0.067496,0.06289800000000001,0.073517,0.063027,0.063399,0.066804,0.061675999999999995],"rail_tree_10_p95_ms":[0.18285200000000001,0.183613,0.184635,0.143889,0.177642,0.177301,0.17947500000000002,0.17702,0.181078,0.192497,0.178072],"rail_tree_40_p95_ms":[0.350896,0.35314999999999996,0.354763,0.337591,0.340817,0.345535,0.350265,0.34622400000000003,0.394006,0.322252,0.31074999999999997],"rss_extra_mb":[2.5546875,2.5546875,2.4921875,2.56640625,2.4921875,2.50390625,2.50390625,2.5078125,2.5546875,2.49609375,2.4921875],"terminal_write_p95_ms":[0.106289,0.09991599999999999,0.105357,0.09395600000000001,0.105698,0.105317,0.103984,0.097162,0.089086,0.104836,0.103133],"write_to_output_p95_ms":[0.21644200000000002,0.205473,0.21200400000000003,0.21692,0.202586,0.209983,0.217477,0.19301400000000002,0.202826,0.206916,0.202138]}},"log":"run 1/11: load 4.0 on 4 cpus\nrun 2/11: load 4.0 on 4 cpus\nrun 3/11: load 3.7 on 4 cpus\nrun 4/11: load 3.7 on 4 cpus\nrun 5/11: load 3.4 on 4 cpus\nrun 6/11: load 3.4 on 4 cpus\nrun 7/11: load 3.1 on 4 cpus\nrun 8/11: load 3.1 on 4 cpus\nrun 9/11: load 3.1 on 4 cpus\nrun 10/11: load 4.1 on 4 cpus\nrun 11/11: load 4.1 on 4 cpus\ncold_start_ms              median    14.505  range 11.223..17.889  ok\nping_p95_ms                median     0.064  range 0.062..0.074  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.179  range 0.144..0.192  ok\nrail_tree_40_p95_ms        median     0.346  range 0.311..0.394  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.504  range 2.492..2.566  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.104  range 0.089..0.106  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.207  range 0.193..0.217  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [4.0, 4.0, 3.67, 3.67, 3.38, 3.38, 3.11, 3.11, 3.11, 4.06, 4.06] -> /tmp/rail-evidence/paired-7-historical-1.json\n","qualification":"clean under R13"}
{"pair":7,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":0.7975,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-7-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[3.82,3.82,3.59,3.38,3.38,3.19,3.02,3.02,2.85,2.71,2.71],"metrics":{"cold_start_ms":33.949172,"ping_p95_ms":0.134963,"rail_tree_10_p95_ms":0.26779000000000003,"rail_tree_40_p95_ms":0.7903279999999999,"rss_extra_mb":2.58984375,"terminal_write_p95_ms":0.363903,"write_to_output_p95_ms":0.47440699999999997},"per_run":{"cold_start_ms":[30.290938999999998,37.801561,33.621707,34.603447,33.949172,32.783158,33.911042,34.146404,37.285168,31.962577,34.083562],"ping_p95_ms":[0.12153699999999999,0.134632,0.114294,0.140643,0.13688599999999998,0.13514199999999998,0.144139,0.135683,0.134963,0.11282099999999999,0.11110700000000001],"rail_tree_10_p95_ms":[0.287615,0.28991100000000003,0.25263199999999997,0.28367000000000003,0.26205,0.262191,0.26779000000000003,0.26410399999999995,0.26732900000000004,0.31002599999999997,0.28762699999999997],"rail_tree_40_p95_ms":[0.733923,0.766042,0.7721629999999999,0.782483,0.795958,0.7903279999999999,0.799815,0.800977,0.798161,0.791369,0.781619],"rss_extra_mb":[2.66796875,2.58984375,2.58203125,2.58203125,2.5859375,2.5859375,2.5859375,2.59765625,2.59765625,2.58984375,2.59765625],"terminal_write_p95_ms":[0.364381,0.36432800000000004,0.362057,0.36610400000000004,0.360058,0.364922,0.363166,0.364681,0.362412,0.363903,0.36367],"write_to_output_p95_ms":[0.48161200000000004,0.464886,0.47300400000000004,0.47440699999999997,0.46632999999999997,0.47511899999999996,0.580806,0.475899,0.48562,0.472893,0.473482]}},"log":"run 1/11: load 3.8 on 4 cpus\nrun 2/11: load 3.8 on 4 cpus\nrun 3/11: load 3.6 on 4 cpus\nrun 4/11: load 3.4 on 4 cpus\nrun 5/11: load 3.4 on 4 cpus\nrun 6/11: load 3.2 on 4 cpus\nrun 7/11: load 3.0 on 4 cpus\nrun 8/11: load 3.0 on 4 cpus\nrun 9/11: load 2.9 on 4 cpus\nrun 10/11: load 2.7 on 4 cpus\nrun 11/11: load 2.7 on 4 cpus\ncold_start_ms              median    33.949  range 30.291..37.802  ok\nping_p95_ms                median     0.135  range 0.111..0.144  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.268  range 0.253..0.310  ok\nrail_tree_40_p95_ms        median     0.790  range 0.734..0.801  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.590  range 2.582..2.668  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.364  range 0.360..0.366  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.474  range 0.465..0.581  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [3.82, 3.82, 3.59, 3.38, 3.38, 3.19, 3.02, 3.02, 2.85, 2.71, 2.71] -> /tmp/rail-evidence/paired-7-repaired-1.json\n","qualification":"clean under R13"}
{"pair":8,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":0.7225,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-8-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[2.49,2.49,3.33,3.33,3.14,3.14,3.14,2.89,2.89,2.66,2.66],"metrics":{"cold_start_ms":15.152274,"ping_p95_ms":0.06322799999999999,"rail_tree_10_p95_ms":0.177271,"rail_tree_40_p95_ms":0.339254,"rss_extra_mb":2.5078125,"terminal_write_p95_ms":0.10397400000000001,"write_to_output_p95_ms":0.20763800000000002},"per_run":{"cold_start_ms":[11.206804,18.378865,15.719786999999998,15.07532,14.080339,16.317827,14.138454999999999,15.364842,15.152274,15.138087,17.099666],"ping_p95_ms":[0.06228600000000001,0.06968099999999999,0.062207,0.06322799999999999,0.071744,0.06162499999999999,0.062587,0.062788,0.068979,0.06333899999999999,0.06704500000000001],"rail_tree_10_p95_ms":[0.175258,0.181459,0.18460500000000002,0.177481,0.148417,0.177271,0.17687,0.173333,0.181118,0.153156,0.178975],"rail_tree_40_p95_ms":[0.345686,0.30762500000000004,0.339254,0.345295,0.32134999999999997,0.312504,0.347779,0.341017,0.351086,0.337361,0.321762],"rss_extra_mb":[2.5703125,2.5078125,2.4921875,2.5546875,2.546875,2.56640625,2.50390625,2.484375,2.4921875,2.50390625,2.5078125],"terminal_write_p95_ms":[0.095468,0.105798,0.106228,0.105066,0.085299,0.10397400000000001,0.086872,0.10347300000000001,0.107361,0.107471,0.102321],"write_to_output_p95_ms":[0.20904699999999998,0.214809,0.207809,0.199502,0.20746499999999998,0.205334,0.206486,0.20763800000000002,0.221103,0.211535,0.202188]}},"log":"run 1/11: load 2.5 on 4 cpus\nrun 2/11: load 2.5 on 4 cpus\nrun 3/11: load 3.3 on 4 cpus\nrun 4/11: load 3.3 on 4 cpus\nrun 5/11: load 3.1 on 4 cpus\nrun 6/11: load 3.1 on 4 cpus\nrun 7/11: load 3.1 on 4 cpus\nrun 8/11: load 2.9 on 4 cpus\nrun 9/11: load 2.9 on 4 cpus\nrun 10/11: load 2.7 on 4 cpus\nrun 11/11: load 2.7 on 4 cpus\ncold_start_ms              median    15.152  range 11.207..18.379  ok\nping_p95_ms                median     0.063  range 0.062..0.072  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.177  range 0.148..0.185  ok\nrail_tree_40_p95_ms        median     0.339  range 0.308..0.351  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.508  range 2.484..2.570  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.104  range 0.085..0.107  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.208  range 0.200..0.221  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [2.49, 2.49, 3.33, 3.33, 3.14, 3.14, 3.14, 2.89, 2.89, 2.66, 2.66] -> /tmp/rail-evidence/paired-8-historical-1.json\n","qualification":"clean under R13"}
{"pair":8,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":0.5325,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-8-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[2.45,2.45,2.33,2.22,2.22,2.13,2.04,2.04,1.95,1.95,1.96],"metrics":{"cold_start_ms":34.271202,"ping_p95_ms":0.135433,"rail_tree_10_p95_ms":0.279011,"rail_tree_40_p95_ms":0.772273,"rss_extra_mb":2.6015625,"terminal_write_p95_ms":0.364825,"write_to_output_p95_ms":0.476826},"per_run":{"cold_start_ms":[30.348594,31.752824999999998,34.257911,34.271202,37.061943,34.762232,35.947364,34.422199,32.721731,34.441272000000005,30.624658],"ping_p95_ms":[0.13076400000000002,0.143458,0.136625,0.108092,0.140523,0.135322,0.110677,0.135523,0.139581,0.130774,0.135433],"rail_tree_10_p95_ms":[0.279011,0.27466300000000005,0.286144,0.28903,0.26798099999999997,0.270816,0.28647500000000004,0.28216800000000003,0.275084,0.280374,0.273691],"rail_tree_40_p95_ms":[0.772273,0.788654,0.797901,0.741125,0.7605310000000001,0.799935,0.74887,0.763717,0.796187,0.766632,0.787923],"rss_extra_mb":[2.65234375,2.59765625,2.5859375,2.58984375,2.6015625,2.66015625,2.6015625,2.66796875,2.5859375,2.65234375,2.66796875],"terminal_write_p95_ms":[0.365223,0.367246,0.364474,0.364825,0.368629,0.361054,0.35920599999999997,0.359461,0.362758,0.367226,0.36716899999999997],"write_to_output_p95_ms":[0.478234,0.48065599999999997,0.478471,0.474066,0.47920599999999997,0.475168,0.476826,0.468332,0.47088,0.48625799999999997,0.475517]}},"log":"run 1/11: load 2.5 on 4 cpus\nrun 2/11: load 2.5 on 4 cpus\nrun 3/11: load 2.3 on 4 cpus\nrun 4/11: load 2.2 on 4 cpus\nrun 5/11: load 2.2 on 4 cpus\nrun 6/11: load 2.1 on 4 cpus\nrun 7/11: load 2.0 on 4 cpus\nrun 8/11: load 2.0 on 4 cpus\nrun 9/11: load 1.9 on 4 cpus\nrun 10/11: load 1.9 on 4 cpus\nrun 11/11: load 2.0 on 4 cpus\ncold_start_ms              median    34.271  range 30.349..37.062  ok\nping_p95_ms                median     0.135  range 0.108..0.143  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.279  range 0.268..0.289  ok\nrail_tree_40_p95_ms        median     0.772  range 0.741..0.800  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.602  range 2.586..2.668  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.365  range 0.359..0.369  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.477  range 0.468..0.486  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [2.45, 2.45, 2.33, 2.22, 2.22, 2.13, 2.04, 2.04, 1.95, 1.95, 1.96] -> /tmp/rail-evidence/paired-8-repaired-1.json\n","qualification":"clean under R13"}
{"pair":9,"reference":"historical","attempt":1,"exit":1,"median_load_per_cpu":0.415,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-historical/target/release/rupd","--out","/tmp/rail-evidence/paired-9-historical-1.json"],"cwd":"/tmp/rail-historical","protocol":null},"report":{"os":"linux","cpus":4,"runs":11,"loads":[1.88,1.88,1.81,1.81,1.81,1.66,1.66,1.53,1.53,1.41,1.41],"metrics":{"cold_start_ms":14.701001,"ping_p95_ms":0.0645,"rail_tree_10_p95_ms":0.17647,"rail_tree_40_p95_ms":0.340065,"rss_extra_mb":2.50390625,"terminal_write_p95_ms":0.102291,"write_to_output_p95_ms":0.20927099999999998},"per_run":{"cold_start_ms":[13.372382,15.037062,11.602291000000001,16.011115,14.972783999999999,15.326111,14.02105,13.330445,14.701001,15.686832,14.004661],"ping_p95_ms":[0.087964,0.069189,0.064249,0.060524,0.065854,0.063358,0.062537,0.0645,0.066324,0.062677,0.069821],"rail_tree_10_p95_ms":[0.145963,0.176319,0.192858,0.17647,0.16486800000000001,0.172171,0.14143399999999998,0.17785199999999998,0.19447,0.180368,0.181509],"rail_tree_40_p95_ms":[0.335035,0.350976,0.33858299999999997,0.34606699999999996,0.349844,0.340577,0.340065,0.32956599999999997,0.324647,0.355635,0.31736299999999995],"rss_extra_mb":[2.48046875,2.4921875,2.5546875,2.48046875,2.5546875,2.50390625,2.5078125,2.4921875,2.5546875,2.4921875,2.546875],"terminal_write_p95_ms":[0.092653,0.108903,0.105316,0.098304,0.086391,0.099598,0.10812200000000001,0.102291,0.102552,0.099871,0.105093],"write_to_output_p95_ms":[0.211862,0.210233,0.20927099999999998,0.209826,0.20824900000000002,0.20081600000000002,0.210223,0.207208,0.206937,0.19534300000000002,0.214248]}},"log":"run 1/11: load 1.9 on 4 cpus\nrun 2/11: load 1.9 on 4 cpus\nrun 3/11: load 1.8 on 4 cpus\nrun 4/11: load 1.8 on 4 cpus\nrun 5/11: load 1.8 on 4 cpus\nrun 6/11: load 1.7 on 4 cpus\nrun 7/11: load 1.7 on 4 cpus\nrun 8/11: load 1.5 on 4 cpus\nrun 9/11: load 1.5 on 4 cpus\nrun 10/11: load 1.4 on 4 cpus\nrun 11/11: load 1.4 on 4 cpus\ncold_start_ms              median    14.701  range 11.602..16.011  ok\nping_p95_ms                median     0.065  range 0.061..0.088  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.176  range 0.141..0.194  ok\nrail_tree_40_p95_ms        median     0.340  range 0.317..0.356  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.504  range 2.480..2.555  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.102  range 0.086..0.109  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.209  range 0.195..0.214  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [1.88, 1.88, 1.81, 1.81, 1.81, 1.66, 1.66, 1.53, 1.53, 1.41, 1.41] -> /tmp/rail-evidence/paired-9-historical-1.json\n","qualification":"clean under R13"}
{"pair":9,"reference":"repaired","attempt":1,"exit":1,"median_load_per_cpu":0.625,"command":{"cmd":["/tmp/rail-historical/target/release/perf","--runs","11","--calls","1000","--rupd","/tmp/rail-evidence/rupd-repaired","--out","/tmp/rail-evidence/paired-9-repaired-1.json"],"cwd":"/tmp/rail-historical","protocol":"1"},"report":{"os":"linux","cpus":4,"runs":11,"loads":[1.41,2.18,2.0,2.0,2.72,2.5,2.5,3.27,3.0,3.0,3.64],"metrics":{"cold_start_ms":34.398407999999996,"ping_p95_ms":0.126195,"rail_tree_10_p95_ms":0.271267,"rail_tree_40_p95_ms":0.784576,"rss_extra_mb":2.61328125,"terminal_write_p95_ms":0.36572299999999996,"write_to_output_p95_ms":0.47399600000000003},"per_run":{"cold_start_ms":[31.434321,34.398407999999996,40.464672,33.422126000000006,37.008462,33.276561,34.486507,36.699498,35.053419000000005,34.057655,32.812203999999994],"ping_p95_ms":[0.13476100000000002,0.13384000000000001,0.132879,0.121978,0.126195,0.132588,0.109795,0.119233,0.134461,0.126015,0.108943],"rail_tree_10_p95_ms":[0.257581,0.253835,0.291435,0.276306,0.272189,0.267951,0.284181,0.27073499999999995,0.283329,0.271267,0.25364400000000004],"rail_tree_40_p95_ms":[0.8125279999999999,0.746385,0.754793,0.797801,0.7776029999999999,0.784576,0.790246,0.798542,0.7817320000000001,0.802069,0.771311],"rss_extra_mb":[2.61328125,2.59765625,2.59765625,2.59765625,2.6640625,2.6328125,2.5859375,2.66015625,2.62890625,2.6015625,2.671875],"terminal_write_p95_ms":[0.36239699999999997,0.35876,0.365634,0.365744,0.36605699999999997,0.356226,0.361576,0.370726,0.36572299999999996,0.367459,0.37052199999999996],"write_to_output_p95_ms":[0.470709,0.471491,0.470756,0.479576,0.470853,0.473459,0.47399600000000003,0.480802,0.47663,0.486075,0.479101]}},"log":"run 1/11: load 1.4 on 4 cpus\nrun 2/11: load 2.2 on 4 cpus\nrun 3/11: load 2.0 on 4 cpus\nrun 4/11: load 2.0 on 4 cpus\nrun 5/11: load 2.7 on 4 cpus\nrun 6/11: load 2.5 on 4 cpus\nrun 7/11: load 2.5 on 4 cpus\nrun 8/11: load 3.3 on 4 cpus\nrun 9/11: load 3.0 on 4 cpus\nrun 10/11: load 3.0 on 4 cpus\nrun 11/11: load 3.6 on 4 cpus\ncold_start_ms              median    34.398  range 31.434..40.465  ok\nping_p95_ms                median     0.126  range 0.109..0.135  FAIL regressed from 0.025 (ceiling 0.029)\nrail_tree_10_p95_ms        median     0.271  range 0.254..0.291  ok\nrail_tree_40_p95_ms        median     0.785  range 0.746..0.813  FAIL regressed from 0.265 (ceiling 0.293)\nrss_extra_mb               median     2.613  range 2.586..2.672  FAIL regressed from 1.6 (ceiling 1.810)\nterminal_write_p95_ms      median     0.366  range 0.356..0.371  FAIL regressed from 0.055 (ceiling 0.062)\nwrite_to_output_p95_ms     median     0.474  range 0.471..0.486  FAIL regressed from 0.066 (ceiling 0.074)\nos linux cpus 4 runs 11 load [1.41, 2.18, 2.0, 2.0, 2.72, 2.5, 2.5, 3.27, 3.0, 3.0, 3.64] -> /tmp/rail-evidence/paired-9-repaired-1.json\n","qualification":"clean under R13"}
```
