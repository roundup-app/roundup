# Spike: rupd drives herdr-core on a boxd machine

Ran 2026-11-07. herdr-core 0.1.18 (protocol generation 1) on a temporary boxd machine `herdr-spike` (Ubuntu 24.04, 2 vCPU, 8 GB, delete-after 3 h), installed with herdr's official installer. rupd's side is a Rust client (`src/lib.rs`) that runs `ssh herdr-spike.boxd herdr-core connect` and speaks the framed protocol. `src/bin/spike/` holds one proof per question; raw output is in `raw/`. A fake agent, `fsignal`, `fshim`, `fqueue` and `corebench` ran on the machine (`remote/`). `bridge` and `fake-rupd` ran on the Mac.

Sleep was simulated by killing or pausing the ssh process (`kill`, `kill -STOP`). The Mac was never slept, and cargo ran under `nice -n 15 -j 4`. No real `claude` ran. The user's Herdr (machines list, config, app, local server) was not touched, and no other boxd machine was touched. Nothing was pushed. The machine was removed at the end; `raw/removal.txt` holds the `boxd list --json` before and after (`herdr-spike` gone, the three other machines unchanged).

```
cargo build --release --bins          # in spikes/herdr-core-client; remote/ builds on the machine
target/release/spike q1|q2|q3|q4|q5|q6|q7|q8|q9|q10|q11|q12|q13
```

Verdict: **herdr-core works as the machine layer over ssh for everything except the back channel.** boxd's ssh gateway does not realise `ssh -R`. The Mac must dial in instead (Q11). With that, 100 reports sent while away arrive exactly once (Q12).

| Q | Answer | Proof (`raw/`) |
|---|---|---|
| Q1 Connect | **Works.** Plain mode is JSON-RPC 2.0, one message per line. `hello {framed:true}` switches to frames `[channel u32][kind u8][len u32][payload]`; channel 0 carries JSON-RPC. Hello returns generation 1, version 0.1.18, 32 methods. A request for generation 2 fails with `unsupported_generation`. Connect plus hello takes 0.39 s; one RPC round trip takes 32 ms (the ssh RTT). Errors carry `code`, `kind` and `hint`. **`herdr-core` is not on the non-interactive ssh PATH** after the official install; I symlinked it into `/usr/local/bin`. | `q1.txt` |
| Q2 Spawn | **`terminal.run` takes argv, cwd, env and size.** The program saw `argv`, `cwd`, `TERM`, `HC_TERMINAL_ID` and the 100×30 size. **The core inherits the environment of the ssh session that started it**, and every terminal gets it: `CLAUDECODE=1` and `CLAUDE_CODE_SESSION_ID` leaked in. An empty-string env value sets an empty variable, it does not remove it. `env -u NAME … prog` in the argv removes it; `env -i` also drops `HC_TERMINAL_ID`. A bad cwd or program fails with `spawn_failed`. | `q2.txt` |
| Q3 Stream | **Byte for byte.** A tap process attached to the stream and played it into roundup's unchanged `Terminals`: 5000 lines (379,671 B) gave the same log, `read`, `search` and `screen` as herdr-core's own `terminal.read`/`terminal.screen`. Exit code 3 reached `Terminals`. One frame ended in the middle of a UTF-8 character (frames up to 16 KiB), so the consumer must buffer bytes, not decode per frame. The first bytes are a repaint (`ESC [ ! p` …), not history. | `q3.txt` |
| Q4 Late join | **A late viewer gets a repaint, not a suffix of the history.** `history:0` gives the visible screen (4.5 KB); `history:1000` adds scrollback (33 KB, flood lines present). No tick was missing after the paint. Last 1500 B of a late stream equal the from-byte-0 stream. With history 1000, one repeat appeared at the seam. | `q4.txt` |
| Q5 Size | **The last active non-observer sets the size** (`stty` showed 60×20 when the second client attached). RESIZE from an `observe` viewer is ignored. A viewer takes the size back by sending RESIZE, FOCUS gained, or typing. `AUTOMATIC_INPUT` does not take the size. An attach with `resumed:true` sets the size only when it types. roundup keeps authority by re-sending RESIZE. | `q5.txt` |
| Q6 Input | **`terminal.send` is intact and ordered, and pipelining is safe**: 100/100 awaited (34 s, about 0.34 s each: paste, 200 ms pause, Enter) and 100/100 pipelined in order (20.7 s). DATA paste plus a separate `\r` frame: 100/100. **DATA paste plus a pipelined RPC `terminal.keys enter`: 0/100**, because `keys` waits out the quiet period and arrives late. Awaited `keys`: 20/20, but each call waits for the viewer's quiet period (`HC_QUIET_MS`, default 3 s; 62 s for 20). The echo is on the stream 1–3 ms after the `keys` reply (30/30). `send` with `if=working` on an idle terminal errors `status_mismatch` and types nothing. Without OSC 7501 status the first `send` stalls; with it, each `send` runs. | `q6.txt` |
| Q7 Exit, reattach | **The exit code arrives on the stream CLOSE (`exit_code 7`) and in `terminal.get`** (`state=finished`). `terminal.wait` returned `exit_code:null` right after exit; read `terminal.get` after a short delay. A kill gives `reason=killed signal=1`. **Reattach works after the ssh process is killed**: pid unchanged, state `live`, in all three runs. **Output during the outage is not replayed.** Outage 5 s at 100 lines/s with history 0: ticks 42–562 never delivered (521 lost). With history 5000 the repaint contained all of them, plus 40 already seen. There is no byte-offset resume token; the viewer must dedupe by content. | `q7.txt` |
| Q8 Status | **OSC 7501 passes through the stream exactly as printed**, and `events.subscribe` (a channel in framed mode) delivers a `status` event 43 ms after the program printed it. `foreground`, `title` and heartbeat events also arrive. `terminal.get` shows `status` and `reported`. | `q8.txt` |
| Q9 Delay | **herdr-core adds 0.15 ms at p50.** n=200, interleaved: `ssh cat` baseline p50 34.55 ms p95 51.4 ms; through the attach stream p50 34.71 ms p95 45.9 ms. Pairwise p50 difference 0.56 ms (p95 noise of 7 ms is ssh jitter). On the machine without ssh: core echo p50 0.089 ms against plain `cat` 0.009 ms. Target was under 1 ms: **met.** | `q9.txt` |
| Q10 Memory | **Within budget.** Ten fake agents, each attached and flooded: the remote herdr processes grew from 13.9 MB to 16.7 MB RSS (3 processes: serve 8.8, hold 4.5, connect 3.3). The Mac-side client grew 11 MB, almost all from the vt100 mirrors, and one ssh process grew 0.9 MB. The machine had 6.5 GB free. | `q10.txt` |
| Q11 Back channel | **`ssh -R` does not work on boxd.** The ssh server is `russh_0.64.1`. A Unix-socket `-R` fails with `remote port forwarding failed for listen path`, so `StreamLocalBindUnlink` never comes into play. A TCP `-R` reports success to the client, but no listener exists in the machine (`ss` shows 0, connect is refused). **Substitute that works: the Mac dials in.** `fqueue` on the machine owns `~/rupq.sock` for hooks and `~/rupq-relay.sock`; the Mac `bridge` runs `ssh host socat - UNIX-CONNECT:~/rupq-relay.sock` and relays to rupd's socket. Live JSON-RPC call (stdio shim, a `rup mcp` stand-in): p50 35 ms, p95 53 ms, which is one ssh RTT. A queued report (`rup signal` stand-in) is acked after fsync in 0.34 ms p50 (1.06 ms as a whole process). A live `fsignal direct` as a process: 35 ms. An agent started by `terminal.run` reached rupd: 5/5 receipts. With the bridge dead, a live call fails at once with `{"error":"away"}`, exit 1. `socat` was already on the machine. | `q11.txt` |
| Q12 Away | **0 lost, 0 doubled with the queue; 15 lost without it.** 100 numbered reports, 50 ms apart, link killed or paused for 4 s. See the table below. | `q12.txt` |
| Q13 Hibernate | **Survives.** `boxd machine hibernate` took 0.56 s. `ssh … herdr-core connect` woke it and returned hello in 0.77 s. Same `boot_id`, same terminal `t36`, same pid 6208, state `live`, same `serve` and `hold` processes. The program was frozen while hibernated and resumed on wake: tick 5 before, ticks 1–12 after wake (about 33 s of wall time passed; a running program would be near tick 38). The guest clock steps forward on wake (`uptime` +31 s), so heartbeats and timeouts inside the machine see a jump. delete-after stayed unchanged. | `q13.txt` |

## Q12 detail

| Scenario | Queue | Fault | rupd | Lost | Applied twice |
|---|---|---|---|---|---|
| S0 | none (live call) | none | – | 0 | 0 |
| S1 | none | link killed | – | **15** (hooks failed loud, exit 1) | 0 |
| S2 | spool | link killed | no ids | 0 | 0 |
| S3 | spool | link paused | no ids | 0 | 0 |
| S4 | spool | link paused | dedup | 0 | 0 |
| S5 | spool | link killed | dedup | 0 | 0 |
| S6 | spool | none, every 7th ack lost | no ids | 0 | **14** |
| S7 | spool | link killed, every 7th ack lost | dedup | 0 | **0** (14 suppressed) |

S2 and S3 had no doubles by luck: no report was in flight when the link died. S6 shows the double that at-least-once delivery produces when an ack is lost. S7 is the full design: both faults, 0 and 0.

**Smallest queue design that gives 0 and 0** (three parts):

1. **Machine spool.** `fqueue` appends each report to a file, fsyncs, then acks the hook. A report is durable once the hook returns, and the spool is replayed on every relay connect.
2. **Delete after ack.** The Mac `bridge` forwards a report to rupd and sends `{"ack":id}` back only after rupd acks. `fqueue` removes the line then. A missing ack means resend (at-least-once).
3. **Idempotent receiver.** Each report carries `id = agent:seq`. rupd keeps one high-water mark per agent and acks but ignores any `seq` at or below it.

## Smallest rupd change

```text
rupd
├── machine adapter (new)   spawns `ssh <host> herdr-core connect`, framed hello, one Conn per machine
├── bridge (new)            `ssh <host> socat - UNIX-CONNECT:~/rupq-relay.sock`, reconnect loop,
│                           relay report -> rupd socket -> ack, relay rpc -> reply
└── report intake           accept `id = agent:seq`, ack always, apply only if seq > last_seq[agent]
machine
├── herdr-core              terminals; started from a clean environment (Q2)
└── fqueue                  ~/rupq.sock for `rup signal` / `rup mcp`; spool; relay socket
```

- rupd needs no change to its terminal code: the framed stream feeds `Terminals` through the same path as Q3.
- `rup signal` on the machine writes to `~/rupq.sock` instead of rupd's socket. Hooks return after fsync, whether the Mac is there or not.
- `rup mcp` is live-only: it works while the bridge is up and fails loud with `away` otherwise.
- Start `herdr-core serve` once from a scrubbed environment (`env -i`), or wrap each agent in `env -u`, so Mac-side or machine-side variables do not leak (Q2).
- Reattach asks for history (`history:N`) and dedupes the repaint by content (Q4, Q7).

## Still unsolved

- **Gateway-terminated ssh.** `-R` is impossible. If boxd later supports `-R` or a streamlocal forward, the bridge could go. Until then, the Mac must keep one ssh process open per machine; the bridge reconnects after 300 ms.
- **Output while away.** herdr-core does not replay bytes missed during an outage and has no resume token (Q7). Status and reports are covered by the queue; the terminal text is covered only if the viewer asks for `history` large enough to hold the gap.
- **`terminal.send` latency.** It takes about 0.34 s each, and `keys` waits out `HC_QUIET_MS` (3 s) after viewer input. rupd typing for a human-attached terminal will stall. I did not test lowering `HC_QUIET_MS`.
- **Quiet-period interaction with `observe`.** Not measured whether an `observe` viewer counts as viewer input for the quiet period.
- **rupd idempotency state.** The high-water mark must be persisted by rupd; I only tested it in memory in `fake-rupd`.
- **A report in flight during a kill** may or may not reach rupd; S7 covered the lost-ack case but not a random-timing sweep.
- **Not tested:** two Macs, ssh keepalive tuning, and spool growth over a long away period (the spool is one line per report, rewritten on each ack, which is O(n) per ack).
