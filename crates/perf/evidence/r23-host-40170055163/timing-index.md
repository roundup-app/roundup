# R23 timing collection index

These are collected invocation medians, not #3760's attribution or completion
verdict. Each JSON retains eleven per-Daemon samples, loads and exact host class.
All six have median load per CPU <= 2.0 and no skipped comparison. All exit 1
against the explicitly diagnostic scratch ceilings; stdout names every miss.
No report is discarded and no committed baseline or limit was changed.

| Invocation (in execution order) | Median load/CPU | terminal_write_p95_ms | write_to_output_p95_ms | Exit |
|---|---|---|---|---|
| [historical-1](historical-1.json) | 1.3150 | 0.054052 | 0.112005 | 1 |
| [candidate-1](candidate-1.json) | 1.1325 | 0.055794 | 0.110897 | 1 |
| [historical-2](historical-2.json) | 0.8300 | 0.053530 | 0.110526 | 1 |
| [candidate-2](candidate-2.json) | 0.6325 | 0.056035 | 0.111509 | 1 |
| [historical-3](historical-3.json) | 1.0675 | 0.054162 | 0.110957 | 1 |
| [candidate-3](candidate-3.json) | 0.9200 | 0.053080 | 0.111127 | 1 |

Each basename also has `.command`, `.stdout`, `.stderr` and `.exit` records,
plus eleven `.startup-N.log` files. `collect.py.txt` specifies the execution
order and diagnostic configuration construction; `binaries.sha256` identifies
the identical compatible probe and the unmodified reference executables.

The scratch probe preserves ten login-shell Terminals, 100 warmups, 1000 calls,
raw `cat`, R15's one-unread-write pacing and eleven fresh Daemons. It adapts only
the historical Rail spelling and output envelope outside the measured request
code. Both references use the same patched probe bytes. The historical output
Event is translated to the existing output receiver; the candidate's native
output path stays intact. #3760 must review any translation cost when attributing
the difference. No production Client, contract or Daemon source is edited here.

H15's hook loop runs after the two write measurements and is omitted for both
references because the historical reference lacks that protocol. Its diagnostic
budget entry is omitted too; this targeted R23 collection is not a full perf pass.
All other diagnostic entries retain the candidate's existing values and limits;
five linux-boxd entries are copied under linux-9v45 solely to permit report
collection before calibration. Their DIAGNOSTIC provenance is explicit in every
report. They supply no Builder baseline or R16 acceptance.
