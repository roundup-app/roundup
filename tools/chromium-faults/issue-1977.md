U26 cold-start repair evidence (2026-10-15, Linux)

The [failed CI job](https://github.com/saadshahd/roundup/actions/runs/38776183603/job/116564305260) aborted both executable streams before `spawn`. The `node:internal/streams/add-abort-signal` stack maps to `createReadStream(... AbortSignal.timeout(replyMs))` in `openPage` at the logged commit `ed1b607b9e290a86253b8093f74b4d98250ca04f` (fetched and inspected). A DevTools timeout instead constructs an Error naming its method, pid and received bytes. This separates the observed executable-read timeout from launch, first-page work or a lost reply; it does not establish why CI's disk/scheduler stopped making progress.

| Original failure | Call | Elapsed ms | Command exit |
| --- | ---: | ---: | ---: |
| executable read, first rejection | 1 | 20028.413 | 1 |
| executable read, second rejection | 0 | 20030.645 | 1 |
| new held-start test on unmodified launcher, a65da852 | both | >21000 observation window; failure already recorded | 1 |

Readiness is the matching DevTools reply to [Target.createTarget](https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-createTarget), which carries the newly created page's target id. `openPage` then waits for attachment and Page/Runtime enable replies. Only those acknowledgements complete startup. The timer only rejects a stall; executable EOF cannot return a page. The existing CDP transport is reused.

```text
executable read → server listening → launch → target acknowledged → page attached → call → close
                    shared startup cap                           20 s reply cap
```

Only cold.mts opts into a 60000 ms harness startup cap. Existing callers default startupMs to replyMs, and post-startup replies retain 20000 ms. The original load baseline reached 19223 ms; the required controlled hold adds 21000 ms before real Chromium is released. Their combined 40223 ms leaves less than 20 s recovery margin inside 60000 ms. This is a harness stall cap, not a readiness delay or production deadline.

Measurement: `/opt/google/chrome/chrome`, fresh private profiles and Vite caches for each of two concurrent calls, no retry, no warmup and no explicit OS cache eviction. Pin both the command and one continuously busy Python process to CPU 0. Each pair starts a new Node process; terminate the busy process only after ten pairs. This tests CPU contention; the original CI executable-read stall did not recur here. Stage instrumentation is the only baseline launcher change.

```sh
taskset -c 0 python3 -c 'while True: pass' &
load_pid=$!
for pair in {0..9}; do
  taskset -c 0 node --experimental-strip-types tools/chromium-faults/cold.mts "/tmp/cold-$pair.jsonl"
  # Record this command's exit status, including failures; never retry a pair.
done
kill "$load_pid"
wait "$load_pid"
```

Before: 962dac2e4e789652b98a2525bcc03b7239b6c57f, 20000 ms startup/reply cap. After: 581a48af (full SHA recorded in each raw row), 60000 ms startup/20000 ms reply cap. All times below are cumulative milliseconds from each openPage call; answer/close include the call's outer timing. Values are the actual `() => 42` result. Exit is the pair command's exit status. Each pair has two rows, so no failure can be hidden in an aggregate.

| Version | Pair | Call | Read EOF | Server | Launch | Target ack | Page ready | Answer | Close | Value | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| before | 0 | 0 | 125.8 | 652.5 | 659.4 | 2229.6 | 2980.6 | 3138.0 | 3716.1 | 42 | 0 |
| before | 0 | 1 | 136.7 | 627.9 | 641.7 | 2180.6 | 2954.0 | 3082.7 | 3631.3 | 42 | 0 |
| before | 1 | 0 | 158.6 | 646.3 | 653.7 | 2194.6 | 2912.7 | 2992.6 | 3525.9 | 42 | 0 |
| before | 1 | 1 | 145.6 | 680.8 | 697.5 | 2321.7 | 3011.1 | 3542.1 | 3824.0 | 42 | 0 |
| before | 2 | 0 | 124.8 | 601.9 | 615.1 | 1986.2 | 3086.1 | 3121.1 | 3410.0 | 42 | 0 |
| before | 2 | 1 | 143.1 | 648.0 | 666.4 | 2206.9 | 3127.0 | 3168.7 | 3462.6 | 42 | 0 |
| before | 3 | 0 | 120.8 | 625.1 | 635.0 | 2136.8 | 2912.1 | 3017.1 | 3420.1 | 42 | 0 |
| before | 3 | 1 | 156.7 | 674.2 | 692.1 | 2301.1 | 3480.5 | 3507.9 | 4053.2 | 42 | 0 |
| before | 4 | 0 | 152.5 | 629.9 | 639.8 | 2121.7 | 2923.5 | 3005.1 | 3446.9 | 42 | 0 |
| before | 4 | 1 | 130.3 | 668.4 | 678.6 | 2311.6 | 3117.7 | 3208.8 | 3516.8 | 42 | 0 |
| before | 5 | 0 | 133.2 | 618.1 | 628.9 | 2063.3 | 2932.8 | 3059.4 | 3544.3 | 42 | 0 |
| before | 5 | 1 | 145.8 | 661.0 | 679.9 | 2336.2 | 3144.4 | 3280.2 | 4066.5 | 42 | 0 |
| before | 6 | 0 | 106.5 | 627.2 | 634.0 | 2170.1 | 3055.7 | 3140.8 | 3457.7 | 42 | 0 |
| before | 6 | 1 | 118.1 | 637.1 | 643.0 | 2128.2 | 3092.2 | 3142.8 | 3545.0 | 42 | 0 |
| before | 7 | 0 | 165.7 | 653.6 | 663.5 | 2330.2 | 3106.3 | 3241.2 | 3597.7 | 42 | 0 |
| before | 7 | 1 | 151.7 | 677.0 | 686.7 | 2242.3 | 3048.4 | 3135.0 | 3494.4 | 42 | 0 |
| before | 8 | 0 | 136.1 | 633.0 | 646.9 | 2040.2 | 2838.8 | 2952.7 | 3391.6 | 42 | 0 |
| before | 8 | 1 | 158.2 | 685.7 | 701.9 | 2298.2 | 3074.9 | 3169.4 | 3573.3 | 42 | 0 |
| before | 9 | 0 | 235.1 | 737.8 | 744.8 | 2104.2 | 2878.7 | 3020.2 | 3429.3 | 42 | 0 |
| before | 9 | 1 | 253.5 | 794.2 | 811.1 | 2461.4 | 3167.4 | 3429.2 | 4136.1 | 42 | 0 |
| after | 0 | 0 | 127.1 | 645.3 | 654.6 | 2254.7 | 2982.6 | 3113.9 | 3630.8 | 42 | 0 |
| after | 0 | 1 | 144.2 | 609.7 | 622.4 | 2016.9 | 2770.5 | 2929.2 | 3349.3 | 42 | 0 |
| after | 1 | 0 | 147.9 | 678.2 | 689.7 | 2223.3 | 3194.1 | 3264.1 | 3566.0 | 42 | 0 |
| after | 1 | 1 | 169.5 | 654.2 | 667.0 | 2162.9 | 3004.2 | 3115.3 | 3489.0 | 42 | 0 |
| after | 2 | 0 | 144.8 | 633.4 | 640.5 | 2144.0 | 2945.1 | 3117.9 | 3500.3 | 42 | 0 |
| after | 2 | 1 | 163.9 | 670.8 | 680.6 | 2422.4 | 3207.2 | 3499.7 | 3720.9 | 42 | 0 |
| after | 3 | 0 | 147.1 | 621.5 | 635.2 | 2113.1 | 2966.5 | 3103.2 | 3501.9 | 42 | 0 |
| after | 3 | 1 | 112.2 | 647.7 | 666.2 | 2294.0 | 3141.5 | 3282.5 | 3591.2 | 42 | 0 |
| after | 4 | 0 | 140.6 | 632.1 | 640.6 | 2042.2 | 2701.1 | 3049.2 | 3419.5 | 42 | 0 |
| after | 4 | 1 | 153.0 | 679.7 | 690.1 | 2299.8 | 3173.8 | 3194.0 | 3510.0 | 42 | 0 |
| after | 5 | 0 | 99.8 | 596.1 | 606.0 | 2132.3 | 2981.9 | 3032.1 | 3460.7 | 42 | 0 |
| after | 5 | 1 | 114.6 | 580.9 | 594.4 | 2108.6 | 2955.9 | 3012.4 | 3364.8 | 42 | 0 |
| after | 6 | 0 | 121.9 | 638.3 | 651.2 | 2209.5 | 2962.8 | 3049.7 | 3387.3 | 42 | 0 |
| after | 6 | 1 | 91.5 | 661.2 | 680.2 | 2209.1 | 3019.3 | 3112.6 | 3460.1 | 42 | 0 |
| after | 7 | 0 | 138.1 | 618.8 | 629.6 | 2139.7 | 2956.1 | 3128.4 | 3491.0 | 42 | 0 |
| after | 7 | 1 | 149.2 | 661.8 | 671.7 | 2669.9 | 3164.8 | 3264.5 | 3561.2 | 42 | 0 |
| after | 8 | 0 | 172.8 | 654.4 | 667.2 | 2183.6 | 3106.8 | 3299.7 | 3684.2 | 42 | 0 |
| after | 8 | 1 | 147.5 | 680.6 | 696.1 | 2364.3 | 3260.0 | 3386.5 | 3871.1 | 42 | 0 |
| after | 9 | 0 | 286.1 | 812.4 | 819.6 | 2253.2 | 3083.5 | 3214.9 | 3653.7 | 42 | 0 |
| after | 9 | 1 | 272.9 | 847.5 | 856.9 | 2515.1 | 3322.7 | 3421.1 | 3924.9 | 42 | 0 |

The raw observations lived in the producing CI artifact and also retained the ten initial, uninstrumented pairs (`measurement=before`), including the 19223 ms cold pair used in the startup-cap calculation. Those pairs likewise returned twenty 42 values and closed twenty pages with ten exit-0 commands. The instrumented baseline's maximum close was 4136 ms; the repaired maximum was 3925 ms. These runs establish repeated success under this CPU load, not reproduction of CI's disk stall.

The permanently held regression retained fault-history verification and confirmed both owned browser pids were gone while the locks remained held:

| Intentional held-start failure | Browser pid | Elapsed ms | Cold command exit |
| --- | ---: | ---: | ---: |
| last completed stage: launched; received: 0 bytes | 20814 | 60029.298 | 1 |
| last completed stage: launched; received: 0 bytes | 20815 | 60031.935 | 1 |

The unrelated-warmup regression still rejected the held cold call at its unchanged default 20000 ms deadline (observed 20037 ms), then completed warmup only after explicit lock release. It continues to prove that unrelated warmup is not cold-call readiness.

All four `cold.test.py` tests passed in 123.780 s. In the release-after-21-seconds case, call 0 reached page-ready at 23055.893 ms and closed at 23843.073 ms; call 1 reached page-ready at 22874.573 ms and closed at 23358.895 ms. Both returned 42, and neither browser pid survived close. The raw observations retain this controlled release as `measurement=released-hold`.
