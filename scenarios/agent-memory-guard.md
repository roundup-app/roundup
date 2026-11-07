# The Daemon ends the largest Agent process when Agents hold too much memory (AMG)

Module: `crates/agents` (reader, decision, note), `crates/rupd` (starts the sampler). Ids: AMG1–AMG4. Work order: #6759. Adds no RPC method and no public type beyond the guard's own (policy).

On 2026-11-07 one Agent started 87 `python3.13` processes at once; they held 160 GB on a 64 GB Mac, and the Mac panicked twice. macOS refuses `setrlimit` memory limits (`ulimit -v` fails with EINVAL), Claude Code has no memory control, and an instruction capped by count failed. The Daemon starts every Agent and runs all the time, so the guard lives there (policy).

## Checks on main

1. `crates/agents/src/claude_code/launch/seam.rs`, the launch command: sets `ROUNDUP_AGENT` to the Agent's id, and every child inherits it.
2. `crates/agents/src/peer.rs`, `agent_above`: finds an Agent by walking parents from a pid to a `claude` pid; a `( … ) &` subshell reparented to launchd escapes it.
3. `crates/agents/Cargo.toml`: depends on `libproc` (`pidrusage`). `crates/perf/Cargo.toml`: depends on `sysinfo` with the `system` feature.

**AMG1 the environment marks a process as an Agent's.** Given a fake Agent N whose shell runs `( setsid sleep 30 & ) &` with `ROUNDUP_AGENT=N`, when the reader lists processes, then the reparented `sleep` is Agent N's, though its parent is not `claude` and its session differs. A process with no marker, or another Agent's marker, is not N's. The reader reads a process's environment once per pid and start time: a second reading of the same pid does not read the environment again, and a reused pid with a new start time is read again. Test: `amg1_reparented_child_is_marked_by_its_environment` (`crates/agents/tests/`), which kills the `sleep` at its end and runs under 5 s; `amg1_environment_is_read_once_per_pid_and_start_time` (`crates/agents/src/`) counts reads through the reader's seam, with no process.

**AMG2 the budget ends the largest Agent process.** Given readings of (pid, Agent, memory, name) and a pressure level, the decision is a pure function that returns the pids to end:
(a) when the sum over every Agent's processes passes half the machine's RAM, it returns the largest process, then the next largest, until the remaining sum is at or under half; at or under half it returns nothing;
(b) when the pressure level is critical (4), it returns the largest process even under the budget; at any lower level it returns nothing under the budget;
(c) it never returns an Agent's own `claude`, the Daemon, the App or a process with no marker, whatever their size, and it counts none of them in the sum;
(d) memory is `phys_footprint` from `pidrusage` on macOS and RSS from `/proc` on Linux. Once a second the sampler reads, decides and sends SIGKILL, never SIGSTOP, and reads again at the next tick; it neither resumes nor reruns anything after an end or a restart (policy; DCR1 stays as it is).
Tests: `amg2_replays_the_panic_logs_at_64_gb` (`crates/agents/src/`) replays the 87 and 28 `python3.13` sizes (5–22 GB each, 160 GB and 171 GB in all) at 64 GB: it asserts the returned pids are the largest first, the rest sum under 32 GB, and no `claude` or unmarked pid appears; `amg2_critical_pressure_ends_the_largest_under_budget` and `amg2_budget_boundary_ends_nothing` (same file). All three run on Linux CI and allocate no real memory.

**AMG3 the Agent and its Door are told why.** Given a fake Agent's `sleep` ended by the guard under a test budget, then the Agent and its Door each get one note: the process name, its memory, the reason and the fix, as in "roundup ended dfam_tool.py (22 GB): Agents held over half of this Mac's memory; run fewer at once" (the critical-pressure reason says the Mac's memory ran critical). Each end sends one note to each of the two, never two. The Agent's `claude` keeps running, and the ended process's command fails. Test: `amg3_an_end_notes_the_agent_and_its_door` (`crates/rupd/tests/`) uses a fake Agent, a `sleep` and a test budget, asserts both inboxes and the note's four parts, and runs under 5 s.

**AMG4 the sampler can act while the Mac thrashes.** Given the Daemon started, then the sampler runs on its own thread, locks its memory with `mlockall` (or an equivalent where the platform lacks it), and between readings does no allocation and no I/O beyond reading the process list, environments (AMG1) and memory, and sending the signal. It reads the full process list once a second, never more often. Test: `amg4_sampler_reads_once_a_second_on_its_own_thread` (`crates/agents/src/`), which drives the sampler with a fake clock and a counting reader and asserts one reading per tick, on a thread other than the caller's; the memory lock and the absence of allocation are policy, held by review of the sampler loop, since no CI test can reproduce a thrashing Mac.

## Observer and regression policy

No test allocates gigabytes, starts a CPU or memory load, or runs over 5 s. A guard end of anything that is not marked as an Agent's, including the user's apps, Chrome or Blender, or of an Agent's own `claude`, is a defect (policy). Reuse (policy): `sysinfo` for the process list and environments, `libproc` for `pidrusage`; `setrlimit` and launchd limits are rejected because macOS refuses them and they cap one process, not a sum; earlyoom and systemd-oomd are rejected because they run only on Linux.

Scope (policy): `crates/agents`, `crates/rupd` and this file. No App surface changes; no visual Check or native Mac observation moves.
