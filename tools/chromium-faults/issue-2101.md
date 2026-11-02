U26 default startup readiness (Linux, 2026-10-16)

The baseline default rejected the event-held startup before release: `test_u26_slow_concurrent_cold_waits_for_readiness` failed in 22.108 s, exit 1, because failure rows existed at the 21-second negative observation window. Only the explicit cold.mts startup override was removed on baseline 9fa2ee4a; the harness matched origin/main 3382266e. The repaired default is 60000 ms, the bound justified in issue-1977.md; explicit 5000 ms diagnostic budgets remain explicit. Post-readiness replies retain 20000 ms.

Readiness requires real Target.createTarget, Target.attachToTarget, Page.enable, Page.setLifecycleEventsEnabled and Runtime.enable replies (chromePage.ts), culminating in page-ready. Neither executable EOF nor a timer returns a page. A held Crashpad lock prevents those acknowledgements; release permits both actual 42 answers and closes. This distinguishes slow startup from treating a lost reply as success.

Measurements below use /opt/google/chrome/chrome, fresh profiles and Vite caches, two simultaneous calls per Node invocation. Both versions use one continuously busy Python process pinned to CPU 0, with each Node command also pinned to CPU 0. No retries, pre-pair warmup or explicit cache eviction. This reproduces the earlier CPU contention load; the separate regression exercises a private evicted executable at 100 read IOPS. Raw per-call stages, full commit, executable and every command exit lived in the producing CI artifact. Times are cumulative milliseconds from each call; answer/close include the outer call timing.

```sh
taskset -c 0 python3 -c 'while True: pass' &
load_pid=$!
for pair in {0..9}; do
  taskset -c 0 node --experimental-strip-types tools/chromium-faults/cold.mts "/tmp/cold-$pair.jsonl"
  # Record each exit without retrying.
done
kill "$load_pid"
wait "$load_pid"
```

| Version | Pair | Call | Commit | Read EOF | Server | Launch | Target | Ready | Answer | Close | Value | Exit |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 0 | 0 | 9fa2ee4a | 1727.1 | 2473.7 | 2482.6 | 4518.4 | 5397.2 | 5460.5 | 5864.3 | 42 | 0 |
| before | 0 | 1 | 9fa2ee4a | 1685.3 | 2396.9 | 2409.5 | 4525.8 | 5300.8 | 5455.2 | 5943.6 | 42 | 0 |
| before | 1 | 0 | 9fa2ee4a | 359.8 | 1107.2 | 1113.4 | 3515.5 | 4161.3 | 4210.6 | 4525.4 | 42 | 0 |
| before | 1 | 1 | 9fa2ee4a | 375.3 | 1049.7 | 1059.6 | 2924.0 | 3933.5 | 3995.0 | 4405.5 | 42 | 0 |
| before | 2 | 0 | 9fa2ee4a | 323.5 | 1033.2 | 1044.1 | 3142.2 | 3859.7 | 4011.5 | 4469.2 | 42 | 0 |
| before | 2 | 1 | 9fa2ee4a | 337.9 | 1113.3 | 1130.3 | 3388.0 | 4250.4 | 4465.6 | 4689.2 | 42 | 0 |
| before | 3 | 0 | 9fa2ee4a | 317.4 | 1047.0 | 1056.1 | 2870.7 | 3816.1 | 3908.1 | 4406.2 | 42 | 0 |
| before | 3 | 1 | 9fa2ee4a | 356.7 | 1096.8 | 1107.8 | 3130.3 | 3974.9 | 4147.2 | 4511.1 | 42 | 0 |
| before | 4 | 0 | 9fa2ee4a | 307.8 | 1061.2 | 1073.2 | 3138.1 | 4225.7 | 4265.7 | 4643.5 | 42 | 0 |
| before | 4 | 1 | 9fa2ee4a | 265.1 | 979.7 | 990.7 | 2769.1 | 4180.1 | 4209.1 | 4558.7 | 42 | 0 |
| before | 5 | 0 | 9fa2ee4a | 390.8 | 1162.4 | 1171.4 | 3371.4 | 4462.0 | 4488.6 | 5117.3 | 42 | 0 |
| before | 5 | 1 | 9fa2ee4a | 306.5 | 1063.7 | 1072.4 | 2822.5 | 3851.8 | 3958.5 | 4427.8 | 42 | 0 |
| before | 6 | 0 | 9fa2ee4a | 271.8 | 1016.6 | 1031.0 | 2587.2 | 3325.9 | 3420.7 | 3915.5 | 42 | 0 |
| before | 6 | 1 | 9fa2ee4a | 398.3 | 1402.4 | 1406.1 | 3911.2 | 4395.7 | 4430.7 | 5630.6 | 42 | 0 |
| before | 7 | 0 | 9fa2ee4a | 311.2 | 1023.1 | 1031.7 | 3160.8 | 3820.2 | 3956.8 | 4409.5 | 42 | 0 |
| before | 7 | 1 | 9fa2ee4a | 367.5 | 1106.8 | 1118.0 | 3217.6 | 4155.6 | 4404.9 | 4612.1 | 42 | 0 |
| before | 8 | 0 | 9fa2ee4a | 376.1 | 1072.8 | 1085.8 | 2914.6 | 3845.1 | 4380.2 | 4765.8 | 42 | 0 |
| before | 8 | 1 | 9fa2ee4a | 430.9 | 1167.9 | 1173.7 | 3379.8 | 4475.7 | 4516.2 | 4859.5 | 42 | 0 |
| before | 9 | 0 | 9fa2ee4a | 288.9 | 1031.0 | 1039.3 | 3135.6 | 3895.9 | 3973.3 | 4444.8 | 42 | 0 |
| before | 9 | 1 | 9fa2ee4a | 355.0 | 1115.7 | 1130.1 | 3359.7 | 4464.1 | 4491.1 | 4691.9 | 42 | 0 |
| after | 0 | 0 | f38bda3d | 331.4 | 1043.7 | 1052.3 | 3105.9 | 4113.5 | 4228.6 | 4684.8 | 42 | 0 |
| after | 0 | 1 | f38bda3d | 350.0 | 1052.2 | 1061.0 | 3211.2 | 4246.2 | 4376.6 | 4768.3 | 42 | 0 |
| after | 1 | 0 | f38bda3d | 365.1 | 1141.2 | 1152.9 | 3347.3 | 4525.8 | 4548.1 | 4749.1 | 42 | 0 |
| after | 1 | 1 | f38bda3d | 332.9 | 1071.6 | 1084.1 | 2837.4 | 3813.7 | 3957.2 | 4521.5 | 42 | 0 |
| after | 2 | 0 | f38bda3d | 301.5 | 1017.9 | 1029.1 | 2984.0 | 3733.8 | 3828.9 | 4250.1 | 42 | 0 |
| after | 2 | 1 | f38bda3d | 336.0 | 1077.0 | 1085.9 | 3248.9 | 4272.1 | 4291.2 | 4525.0 | 42 | 0 |
| after | 3 | 0 | f38bda3d | 403.6 | 1105.6 | 1113.5 | 3387.1 | 4107.7 | 4185.1 | 4596.2 | 42 | 0 |
| after | 3 | 1 | f38bda3d | 370.7 | 1128.9 | 1139.7 | 3383.0 | 4060.7 | 4235.7 | 4695.5 | 42 | 0 |
| after | 4 | 0 | f38bda3d | 336.6 | 1008.1 | 1016.6 | 2725.6 | 3692.2 | 3828.3 | 4244.7 | 42 | 0 |
| after | 4 | 1 | f38bda3d | 351.0 | 1098.4 | 1108.1 | 3108.3 | 4023.4 | 4252.3 | 4778.5 | 42 | 0 |
| after | 5 | 0 | f38bda3d | 336.6 | 1118.4 | 1125.4 | 3182.0 | 4151.6 | 4410.8 | 4658.1 | 42 | 0 |
| after | 5 | 1 | f38bda3d | 371.3 | 1046.9 | 1057.9 | 2795.8 | 3980.0 | 3992.5 | 4404.3 | 42 | 0 |
| after | 6 | 0 | f38bda3d | 314.9 | 1036.5 | 1047.5 | 2945.0 | 4270.8 | 4289.9 | 4561.6 | 42 | 0 |
| after | 6 | 1 | f38bda3d | 328.6 | 1098.4 | 1105.2 | 3083.0 | 4272.0 | 4292.3 | 4648.6 | 42 | 0 |
| after | 7 | 0 | f38bda3d | 340.8 | 1090.0 | 1101.6 | 3600.3 | 4218.8 | 4446.5 | 4659.5 | 42 | 0 |
| after | 7 | 1 | f38bda3d | 313.9 | 1018.6 | 1030.0 | 2896.5 | 3923.5 | 3998.5 | 4424.7 | 42 | 0 |
| after | 8 | 0 | f38bda3d | 421.4 | 1236.9 | 1252.5 | 3383.3 | 4318.2 | 4355.7 | 5030.1 | 42 | 0 |
| after | 8 | 1 | f38bda3d | 315.4 | 1070.6 | 1081.9 | 2776.0 | 3737.5 | 3836.6 | 4223.3 | 42 | 0 |
| after | 9 | 0 | f38bda3d | 352.3 | 1014.4 | 1026.1 | 2988.4 | 3865.9 | 4418.3 | 4685.9 | 42 | 0 |
| after | 9 | 1 | f38bda3d | 303.9 | 1082.9 | 1091.9 | 3061.4 | 4413.2 | 4441.0 | 4760.3 | 42 | 0 |

| Command / observation | Exit | Result |
| --- | ---: | --- |
| Baseline default: `python3 tools/chromium-faults/cold.test.py ColdTest.test_u26_slow_concurrent_cold_waits_for_readiness` | 1 | Failure row before hold release; 22.108 s total |
| Repaired: `python3 tools/chromium-faults/cold.test.py` | 0 | All four tests passed, 125.161 s |
| Permanently held nested cold command through observe.py | 1 | Both calls rejected at 60003/60004 ms, last stage launched, zero received bytes; verified live fault state/history, command status preserved; both browser PIDs absent while locks still owned |
| Delayed release, default openPage | 0 | Page ready at 23400/23483 ms, actual 42/42, closed at 23666/23758 ms; no browser PIDs survived |
| Independent unrelated warmup | 0 | Explicit old 20000 ms cold limit rejected at 20069 ms; unrelated warmup remained pending until release |
| `pnpm --filter desktop exec vitest run src/testing/u26_chromePage.test.ts` | 0 | Seven passed; private evicted executable, 100 read IOPS, concurrent isolated pages, actual 42/42 and cleanup; read-IOPS test 22982 ms total |

Node v24.21.0 was used for every command above. Existing held-start assertions and issue-1977 fault evidence remain intact. No test was removed; the elapsed-startup assertion is retired in favour of the measured harness startup stall bound required by U26. The four explicit 5000 ms failure tests still exercise their own startup deadlines and diagnostics.

Final `just check origin/main` after merging main 5e9227e4: exit 0. Rust lint, proof/mutation checks, web lint/typecheck and full web suite passed: 374 files passed, two skipped; 2919 tests passed, 19 skipped. Web duration 1300.30 s. The earlier full-check invocation was intentionally terminated when main advanced, then replaced by this complete run; no cold pair was retried.
