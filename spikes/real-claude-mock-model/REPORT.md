# Spike: the real Claude Code on a fake model

Question: can roundup's end-to-end tests drop the hand-written fake `claude`
(`crates/rup/tests/e2e/fake_claude.py`) and run the real Claude Code, with no
model calls?

Answer: yes. The real `claude` 2.1.300 ran every path roundup observes against
a local fake of the Anthropic Messages API: hooks, the MCP server, permission
decisions, API errors, the interactive TUI, `--resume` and roundup's flags.
No request left the machine. Evidence: `FINDINGS.md` (live runs, 2026-10-14,
macOS) and `PEERS.md` (how 15 other projects test).

## Why the fake costs

| measure | value |
|---|---|
| size | 463 lines, 32 `FAKE_CLAUDE_*` settings |
| churn | 30 commits since 2026-10-01 |
| reach | 12 Rust test files; most journey evidence in `docs/` |
| blind spot | it replays what Claude Code did once; a Claude Code change goes unseen |
| loop cost | "a logged-in real `claude`" checks go to the user's Mac (`.agents/screen.md`) |

## The guide

1. Run the real `claude` in every end-to-end test. Pin its version; a bump is
   its own PR that reruns the suite.
2. Fake only the model: a local server that answers `POST /v1/messages` from
   a script each test writes (turn 1 → a `tool_use`, turn 2 → text).
3. Route claude to it only through `CLAUDE_CONFIG_DIR`, which roundup passes
   through. Roundup's A30 strip list stays as it is: the config dir is the
   user's own configuration, which A30 leaves alone.
4. Fail loud: a request the script does not expect fails the test. Requests
   with no tools (the TUI's per-prompt title call) get a default text.
5. Assert on what claude sent (system prompt, model, effort, tools,
   `tool_result`) from the server's request log, not on fake reports.
6. No real model in CI. Anthropic's own repos that do so log in through
   GitHub OIDC, not a key (`PEERS.md`).

`$CLAUDE_CONFIG_DIR/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:<port>",
    "ANTHROPIC_API_KEY": "sk-mock-key-000000000000000000000001",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "DISABLE_AUTOUPDATER": "1",
    "CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL": "1",
    "CLAUDE_CODE_MAX_RETRIES": "0"
  },
  "permissions": { "defaultMode": "default" }
}
```

`$CLAUDE_CONFIG_DIR/.claude.json` needs seven keys for the TUI; `FINDINGS.md`
lists them. Without `defaultMode: default`, claude starts in `auto` mode and
sends unallowed tools to a classifier the fake cannot answer.

## Which fake server

| candidate | fit | evidence |
|---|---|---|
| `@copilotkit/aimock` | first choice: Anthropic wire built in, matches on turn and `tool_result`, records and replays, runs as one server | MIT, 1.45.1 released 2026-10-12; H21 passed 11 of 11 against `claude` |
| `wiremock` (Rust) | fallback: in the test process; codex uses it with its own SSE builders | 0.6.5, last release 2025-08-24 |
| `mock.py` (this spike) | proven against `claude`, but custom | 352 lines |

## What each fake setting becomes

| fake setting | replacement |
|---|---|
| `PAYLOADS`, `EVENTS` | the real hooks fire from real events |
| `TOOLS`, `ON_PROMPT`, `DOOR_TOOLS`, `AGENT_TOOLS` | scripted `tool_use` replies |
| `ON_PROMPT_ASK` | scripted Bash `tool_use`; the real PermissionRequest fires |
| `KINDS` | error: HTTP 500; working: hold the stream open; needs-you: a permission; idle: `end_turn` |
| `BRIEF_REPORT`, `LAUNCH_LOG` | assert on the recorded request |
| `GATE`, `HOLD_START` | the server holds a reply until the test releases it |
| `CHILD_PROCESS`, `STRAY` | scripted Bash `tool_use`; not tried |
| `SHIM_DELAY_MS` | none: claude starts the MCP server itself |

## Measured: H21's first Observer

`spike_h21_real_claude_a_door_allows_its_childs_permission_request` in
`crates/rup/tests/e2e.rs`, fixtures in `aimock/h21.json`, against
`h21_observer_a_door_allows_its_childs_permission_request_and_the_touch_names_it`
on the fake. macOS, debug build, claude 2.1.300, aimock 1.45.1.

| measure | fake claude | real claude + aimock |
|---|---|---|
| wall, quiet machine | 0.87–1.12 s | 3.29–3.74 s |
| wall, load average 30–60 | 1.6–4.4 s | 6.9–20.4 s |
| peak RSS, whole test | 60–72 MB | 838–916 MB |
| passed | 10 of 10 | 11 of 11 |
| model calls | 0 | 8–9, all to aimock |

On a real model the same run sends about 270 KB of requests, about 68k
tokens, and the model need not answer `d1` with `allow`.

Found only with the real claude:

- The Door's model reads the tool result `null`: `decision.answer` replies
  with unit.
- One failed model call left the Door in `Error` (`server_error`); the
  daemon then refused its Decision note with code -32003.

Run it: `npm install @copilotkit/aimock@1.45.1` in an empty directory, then
`AIMOCK_LLMOCK=<dir>/node_modules/.bin/llmock cargo test -p rup --test e2e
spike_h21 -- --ignored --nocapture`.

## Costs and gaps

- Memory: 220–306 MB per claude against 18 MB per fake; ten Agents take
  about 2.6 GB.
- Start: about 0.3 s to SessionStart against 0.06 s.
- StopFailure fires 11 of 11 times in the TUI, but rarely under `-p`, which
  exits first. Roundup runs the TUI.
- Not run on Linux or in GitHub Actions; CI must install the pinned claude.
- Keys typed right after SessionStart are lost; wait for the input box.
- The fake key reaches the MCP server and hooks through `env`, as a user's
  own settings do.

## CI impact

Measured 2026-10-14 on macOS; Linux numbers are estimates from these.

- Spawns of the fake in one full run: 628 by 195 Rust tests (333 in
  `rust 1`, 295 in `rust 2`), 107 by 26 web test files, 0 in `mac`.
- Extra CPU per spawn: 0.65 s to start and idle (TUI, trusted folder), up
  to 3.2 s for a busy Agent (H21: 7.09 s against 0.66 s, two claudes).
- `ubuntu-latest` on a public repo has 4 vCPUs and 16 GB, free of charge.
  Lanes are CPU-bound at `--test-threads 8`.

| lane | today | real claude + aimock |
|---|---|---|
| `rust 1` | 4.0 min | 4.9–8.4 min |
| `rust 2` | 5.2 min | 6.0–9.1 min |
| `web 1`–`web 6` | 2.9–6.5 min | +0.1–0.4 min each |
| `check`, slowest lane | about 6.5 min | 6.5–9.1 min |
| `linux` (push only, not gating) | about 30 min | +1.7–8.4 min |

- Memory per Rust shard: today under 1 GB of fakes. Real: about 6 GB typical;
  the worst eight tests at once hold 50 claudes, up to 19 GB, over the
  runner's 16 GB. Cap real-claude tests with a nextest test group of
  `max-threads = 4`.
- Setup: the pinned claude binary is 250 MB and aimock 15 MB; cache both.
- Money: $0. Standard runners are free on a public repo, and aimock makes no
  model calls.

## The cheapest split

Each start of the fake logged the `FAKE_CLAUDE_*` settings it saw (one full
run, 2026-10-14). A test is in the strongest group its settings need.

| group | tests (Rust + web) | starts |
|---|---|---|
| behaviour: Claude's acts (ON_PROMPT, TOOLS, KINDS…) | 61 + 20 | 241 + 87 |
| fault: held start, delays, strays | 8 + 0 | 18 |
| spy: logs what roundup sent | 28 + 0 | 64 |
| none: a process that starts and idles | 98 + 6 | 296 + 20 |

Only the behaviour group depends on what Claude does. Run it on real claude
+ aimock; keep a stub, the fake without its 15 behaviour settings, for the
rest. One launch check runs roundup's real argv (Agent, Door, `--resume`,
`--model`, `--effort`) on real claude.

| option | `check` on a full run (today 5–5.8 min) | fake left |
|---|---|---|
| every test real | +0.4–3.5 min; 19 GB worst | fault settings only |
| behaviour real | +0–1.3 min; about 7 GB worst, 4 at once | stub, 17 settings |
| about 12 seam checks real | +0–0.5 min; under 2 GB | all 493 lines |

- Of 25 recent PR runs, 9 ran no Rust tests, 14 ran part (1.2–2.2 min),
  2 ran all; only those 2 pay the full cost.
- 22 behaviour tests hold Claude's start (HOLD_START): a wrapper that waits
  for the file, then runs claude, does it. Not yet tried.
- 2 behaviour tests use GATE, a pause between permission events; aimock has
  no file wait. Unsolved.

## Re-run

`run.sh` and its helpers hard-code `/tmp/fake-claude-research/spike/`. Copy
this directory there, then run `bash run.sh` (about 70 s).
