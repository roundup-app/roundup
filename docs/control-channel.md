# Control channel

Status: provisional until the user confirms the recommendation and the steering scenarios (H11 to H17) agree on the seam. Scenarios: `scenarios/control.md` (H11 to H17). Since #3564 roundup answers no question or permission prompt: the user answers in the requesting Agent's Terminal. Evidence: `spikes/hooks-permission/REPORT.md` (Claude Code 2.1.287, macOS).

## Seams today

| Direction | Seam | State |
|---|---|---|
| Agent to Daemon | per-Agent `roundup` MCP server (`rup mcp`, A11, M1), plus `rup signal` hooks | exists; B12 adds Messages, #162 adds `agent_context` |
| Daemon to Agent, a prompt | `Agents::prompt` in `crates/agents/src/lib.rs`: one bracketed paste and `\r` in one write, sent when the Agent is `idle` (H11) | the only prompt writer; no timed delay |
| Daemon to Agent, end a turn | none | missing |

## Options compared

| Option | Prompt in | Permission answer | Interrupt | Verdict |
|---|---|---|---|---|
| MCP only (`--permission-prompt-tool`) | no: an MCP server cannot push to a running Claude Code | no: the flag is called in print mode only, the interactive UI accepts and ignores it (finding 6) | no | cannot cover the interactive Agent |
| Hooks only | no | the hook's reply is the decision, in the interactive UI (finding 1); roundup does not use it | no: no hook event fires on Esc (finding 5) | covers state only |
| Hooks plus MCP plus the existing keystroke path | paste plus `\r` in one write, sent when a hook says ready (H11) | none: the user answers in the Terminal | Esc, acknowledged by the title (H13) | covers everything with the TUI kept |
| `claude -p` stream-json input | yes, structured | yes, `--permission-prompt-tool` works there | yes, a message | replaces the interactive UI, which is the product; out of scope without the user |
| Typed `y` or `n` into the dialog | | desync (the user can answer first, the hook is not signalled, findings 2, 4) | | rejected for permissions |

Recommendation: hooks plus the existing MCP server plus one keystroke path with an observable acknowledgement. An Agent asks the user with Claude Code's native `AskUserQuestion`, and the user answers in its Terminal (A3564a); a Steer and an Interrupt are the only two writes to a Terminal on behalf of the Daemon, each with an acknowledgement and a typed error (H11, H13, H16).

## Seam under `contracts/` (rule 4)

`agent.prompt {id, text}`, `agent.interrupt {id}`, the errors `BUSY`, `NOT_ACCEPTED`, `NOT_RUNNING`, `NOT_ACKED` (no question or permission store remains). architect-b's steering series builds on `agent.prompt` and the Route rules; it owns when a Steer is sent and by whom. This document owns how it is delivered.

## Fork cost

Measured in `docs/perf.md` (H15's hook cost). A long-lived transport (an `http` hook, an `mcp_tool` hook) works in the report (finding 7) but adds a second path into the Daemon and fails silently when the server is unreachable (the dialog appears with no message), so it is not chosen.

## Failure modes

- A lost `UserPromptSubmit`: `NOT_ACCEPTED`, text stays in the input line, no retry (H11, H16).
- A lost title: `NOT_ACKED`, Kind unchanged (H13).
- A hook that fails: Claude Code shows its own dialog without a message (finding 1); the failure is the stderr line of `rup signal`.
- Startup: `text` plus `\r` in one write failed to submit once right after startup; a bracketed paste plus `\r` submitted 8 of 8 times (finding 4). H11 uses the paste form and verifies.
- Identity: a process inside an Agent's Terminal can reach the Daemon's socket, so the Daemon knows a caller by its process ancestry, and an Agent's `terminal.write` is refused (`FORBIDDEN`) while the target Agent is `needs-you`; the user's writes always pass.

## Principles served

P1 (the user answers any prompt in its Terminal and no Agent answers another's; steering follows the Thread rules of the steering scenarios), P3 (a native request leads the user to the requesting Terminal, nothing else interrupts), P4 (the vendor strings, the paste markers and the Esc byte stay in `crates/agents/src/claude_code/`; `agent.prompt` and `agent.interrupt` are the existing inject seam with a result, not a fourth seam).

## Known limitation

The terminal title is the only acknowledgement of an Interrupt, because Claude Code fires no hook on Esc. It is the one screen read left. It fails loudly: `NOT_ACKED` after a bound, never a silent retry (H13, H17).

## Open

- Whether a Steer sent while the Agent is `working` is queued by Claude Code (not observed; H1b).
- `Takeover`: a Steer during a Takeover is held by the mailbox series; this series sends nothing then.
