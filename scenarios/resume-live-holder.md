# Resume stops an outside process that holds the conversation (RLH)

Module: `crates/agents` (resume, launch). Ids: RLH1–RLH3. Work order: #7717. Adds no RPC method and no public type. Amends A5335b only by an added step before the launch. #7722 owns roundup's own surviving run: it attaches and is never stopped here.

## Checks on main

1. `crates/agents/src/resume.rs`, `Agents::resume_steps`: verifies the saved cwd, stops the replaced run, launches, then waits the acknowledgement bound.
2. `crates/agents/src/resume.rs`, `Agents::stop_replaced_run`: stops only the run this Daemon holds for the Agent.
3. `crates/agents/src/resume.rs`, `Agents::launch_resumed`: launches `claude --resume` with the Agent's settings file.
4. `scenarios/app.md`, S5981a: the App's own surviving program is reattached, never stopped (#7722).

**RLH1 resume stops an outside holder of the conversation.** Given an Agent with a saved conversation and a live process that is in none of the Daemon's Terminals and holds that conversation (a Claude Code background session whose job names the Agent's settings file), when `agent_resume` runs, then the Daemon stops that process before it launches the new run, the new run starts and acknowledges, and the conversation file is unchanged. A process of another Agent, or one that does not name this Agent's settings file, is left alone. A run in the Daemon's own Terminals is not an outside holder (#7722). Test: `rlh1_resume_stops_an_outside_holder_then_starts` (`crates/agents/tests/scenarios/resume.rs`), with a fake holder process and fake Claude; no sleep. It fails on `main`: resume launches beside the holder and waits out the bound. Observer: the owner's Mac resumes Agent 1 of Workstream 1 in transform-education with no process killed by hand (a real `claude` run only the user's Mac makes).

**RLH2 a launch never moves the Agent into Claude Code's background service.** Given Claude Code offers a switch (flag, setting or environment variable) that keeps a session out of its background service, when roundup launches or resumes an Agent, then the command or environment carries it. Given no such switch exists, the PR that implements this says so and RLH1 alone covers the class. Test: `rlh2_launch_keeps_the_agent_out_of_the_background_service` (`crates/agents/tests/scenarios/resume.rs`) asserts the launch's arguments and environment when the switch exists; otherwise the clause is policy and the PR records the search.

**RLH3 a failed resume names its cause and step.** Given a resume whose new run sends no start signal within the bound, or whose outside holder cannot be stopped, then the error names the step (`stop outside holder`, `launch` or `acknowledge`) and the cause, and no error reads only `no acknowledgement within <n>s`. The saved conversation and settings file remain. Test: `rlh3_resume_failure_names_the_step_and_cause` (`crates/agents/tests/scenarios/resume.rs`), with a fake holder that ignores its stop signal and a fake Claude that never acknowledges.

## Gates

Applies P4 (the Claude Code Adapter owns vendor detail: the holder lookup and the switch) and P9 (the conversation is on disk, so stopping the copy loses nothing). This specification changes no App surface, so no visual Check applies. Implementation is one work order: RLH1, RLH2, RLH3.
