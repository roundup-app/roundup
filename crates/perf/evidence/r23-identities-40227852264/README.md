# R23 native task and producer identities (#4120)

Identity recovery succeeds for both pinned Daemons. Exact enqueue/publication
attribution remains incomplete under [#4031](https://github.com/roundup-app/roundup/issues/4031),
[#3760](https://github.com/roundup-app/roundup/issues/3760) and
[#3720](https://github.com/roundup-app/roundup/issues/3720).

```text
archived Daemons → exact-offset uprobes → native task ID ↔ TaskMeta
physical PTY ordinal → candidate Chunk offset/byte → send entry … return
                     scheduling/publication linearization: still unknown
```

## Execution and fixed inputs

Hosted job [40227852264](https://github.com/roundup-app/roundup/actions/runs/40227852264),
Ubuntu 24.04, AMD EPYC 9V45, four available CPUs, unrestricted affinity 0–3.
`lifetime.json`, host/jobs snapshots and before/after boot records identify this
one lifetime. Both control sets share boot `68dded13-0933-4699-a377-6711491f84d6`.
Both pins restore all ten executable members from
[the producer archive](../r23-producer-40214115988/README.md); no executable is rebuilt.
Historical `2029ed2c4ee606d26e73c858c4d7c93130df36e0`; candidate
`50e546c1a3ce74689738b08a3dfe273895f9ae31`.
Hashes before/after match #4110. Per-pin notes retain build IDs; symbols retain
exact mangled names. The archive manifest and SHA-256 are verified before extraction.
Debug=1, strip=none, tokio_unstable, supported hooks and logger remain those of
#4082. Configuration, hooks and logging remain confounded with each other.

Inputs also include [#4110's controls](../r23-overhead-40221022276/README.md)
and PR #4121's capability evidence at head
`93a72b87ebf9794d9f7e5e12baba8bb7f0055d52` (fetch `refs/pull/4121/head`).
That input remains a separate lifetime, not this host's comparison base.

## Verified locations and arguments

| Pin / method | File offset | Symbol VMA | V2 marked recording entry / return hits |
|---|---:|---:|---:|
| Historical `Handle::schedule_local` | `0x3c1750` | `0x3c2750` | 13316 / 13316 |
| Historical `Handle::push_remote_task` | `0x3c1af0` | `0x3c2af0` | 2204 / 2204 |
| Candidate `Handle::schedule_local` | `0x170e000` | `0x170f000` | 19137 / 19137 |
| Candidate `Handle::push_remote_task` | `0x170e3a0` | `0x170f3a0` | 2245 / 2245 |
| Candidate `broadcast::Sender<terminal::Chunk>::send` | `0x1432c90` | `0x1433c90` | 2211 / 2211 |

The broad send pattern's other address is `0x1432d69`, send+217, an inlined
location inside the function. It is excluded. Native tracefs definitions use the
true file offset once; entry and return are independent events. All definitions,
evlists, recorder/header/decoder outputs, original recordings and statuses remain.
No reported LOST line or unmatched entry appears in the two assessed recordings;
this is no universal loss-free guarantee. Other controls retain their own traces.

Named `perf probe --vars` queries expose no arguments, including exact mangled
symbol queries. The broad send query fails with 254. Matching published Tokio
1.53.1 crate bytes match both lock checksums; `tokio-1.53.1.crate` retains the
source. This is the dependency actually compiled, not a current API substitute.

Disassembly and that source establish:

* Local scheduling owns `Notified` in RDX: it is saved in R15 and placed in the
  LIFO slot or local run queue. RSI is the worker core; ECX controls yield.
* Remote push owns `Notified` in RSI, saved in R15 before lock/inject processing.
  `schedule_task` chooses this path outside the current worker/core; local queue
  overflow can also reach it. A remote-push hit alone does not distinguish those
  callers. RDI is the scheduler handle in both functions.
* `Header` is repr(C); its vtable is at +16. Emitted `OwnedTasks::bind_inner`
  loads vtable+72 for `id_offset`, then reads `Header + id_offset`, exactly as
  `Header::get_id` does. All 36902 scheduler samples in the two assessed V2 marked profiles report
  offset 40, and
  their fetched IDs occur in this recording's TaskMeta hook records. This is
  machine-code validation plus an independent runtime join, never TID inference.
* Send's caller constructs the Chunk at RDX (stack +0x40): Arc allocation pointer
  at +0, length at +8, stream offset at +16. It initializes the Arc counters,
  copies the physical read bytes at allocation+16, then calls send. RSI points
  to Sender; RDI is the hidden Result storage, not Sender. Send copies these
  fields into a slot under locks. Entry/return bounds the call, not a single
  byte-publication point. The returned Rust Result is not decoded by this set;
  matched output receipt independently establishes delivery for the joined bytes.

`native-assessment/identity-assessment.json.gz`, native event rows and joins retain
all identities/timestamps. `physical-assessment/` reuses #4082's unchanged
extract/endpoints/assessment logic with this recording's inputs. Its old-looking
`instrumented-v3-marked-low` filenames are assessor aliases for **V2 marked
repeat 1 on**, never copied old samples. Each pin joins 2200 request/dispatch
identities to physical one-byte writes and reads. Historical ordinal 0 is request
3353/task 7/PID 64342, reader/writer TIDs 65437/65438. Candidate ordinal 0 is
request 3355/task 3461/PID 77754, reader/writer 78856/78857. Its send entry is
705098461949 ns, return 705098475840, stream offset 6, length 1, byte 97; physical
read exit is 705098459195 and forward receipt 705098502966. All 2200 candidate
joins have length 1, byte 97 and consecutive offsets 6–2205.

Notified's owned reference keeps the header alive at entry; ID reads happen
there, not after return. Pointers are scoped to PID and observed task ID.
Historical pointer 140168472304512 is reused by tasks 6 and 8; candidate has 36
reused pointer addresses. No raw address is treated as a durable Task identity.
The producer's stack Chunk and Arc allocations also repeat: join by recording,
reader TID, ordered physical ordinal and byte offset, never allocation address.
The physical reader is a blocking PTY thread, not a spawned async TaskMeta ID;
no Task identity is invented for it.

## Controls and limits

V1 omitted offset 40 from its fetched ID slots. All 24 invocations, raw samples
and misses remain; it cannot recover task IDs. V2 adds that slot and has its own
24 invocations: for each pin/common-or-marked observer, three alternating
recorder-off/on pairs. Each state uses the same archived instrumented executable,
hooks, logger and observer, one fresh Daemon, ten login shells, unchanged
warmups/calls, `--runs 1 --calls 1000`, R15 one-unread pacing, and the same process
monitor. On adds scheduler/syscall recording and the listed per-pin native
probes. Definitions alone never count as hits. Builds, lints, setup, compression
and offline analysis finish before each set; decoding/compression follow it.
The V2 change happens only after V1 decoding completes.

All 48 invocations are R13-qualified: loads 1.91–3.85 on four CPUs, no skips.
All exit 1 against the unchanged diagnostic scratch ceilings. V2 historical
marked repeat 1 on also misses 300 ms cold start at 1685.683182 ms. Every miss
is retained. [Ranges and paired ratios](native-assessment/table.md) show variation:
V2 request on/off ratios span 1.443–2.039 and echo ratios 1.355–1.729 across the
four pin/observer groups. These are aggregate recorder effects conditional on
the diagnostic configuration, neither universal nor per-stage overhead bounds.
No diagnostic interval or p95 difference is subtracted from a clean p95.

Local entry may precede LIFO placement, run-queue insertion, overflow and notify;
remote entry precedes locking/injection and may discard a task on a closed
queue. Neither entry is exact executor enqueue. Send encompasses slot mutation,
unlocking and wake work; entry/return is not exact publication. Selected-future
polls remain distinct from full runtime hooks; hooks include logger execution
and exclude root/blocking tasks. Thread CPU includes kernel/observer/other-task
work and is not useful-task CPU. Pending-read idle time is excluded from write
cost; overlapping reply/output branches are never summed. Input acceptance is
not physical PTY completion.

The original six clean observations remain separately labelled history. This
execution-only run supplies no new clean comparison, timing/calibration campaign,
R16 verdict, baseline increase or production repair. R8 pins, R13 ≤2.0 per CPU,
R15 pacing, R16 historical ceilings and rule 7 absolute limits stay unchanged.
Remaining observations for #4031/#3760/#3720: exact task queue insertion on each
path, exact producer publication boundary, and separation of build/hook/logger
execution from useful task work. Identity recovery does not supply those facts;
no forbidden runtime/terminal instrumentation is an implicit next step, and no
user or Mac decision is required.

## Replay

See `reproduce.txt`, retained scripts, command/status records and `failed-lookups.md`.
Gzip wraps original bytes; the raw manifest verifies decompressed content. Restore
the executable archive at `/tmp/r23-queue-bins` for perf decoding. Replay into
fresh output directories. No browser, App, production source, runtime fork,
contract, baseline or loop file is changed.
