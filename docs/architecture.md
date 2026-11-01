# Architecture

roundup is a local macOS workbench for Claude Code: Workstreams, Agents, Terminals, Todos and Pads. Terms are defined in `GLOSSARY.md`.

```text
Solid webview ── Tauri App ──┐
rup CLI ────────────────────┼── JSON-RPC over Unix socket ── rupd
Claude Code / extensions ── MCP (stdio, rup mcp) ───────────┘
```

The Daemon owns Project state and typed RPC methods and events. Clients use the contracts in `crates/contracts` and their TypeScript exports in `contracts/generated/`. The App also owns native window, dialog and file operations; its webview-facing seam is specified in `scenarios/app.md`.

## Layout

The Rust workspace's `crates/*` members are:

| Path | Contents |
|---|---|
| `crates/contracts` | RPC parameters, results and events; TypeScript export generation |
| `crates/rpc` | `Module`, `Ctx`, event `Bus`, `RpcError` and `Client` |
| `crates/provenance` | `Touches`, the append-only SQLite Touch log |
| `crates/terminal` | `Terminals`, PTYs through portable-pty, screen state and Output streams |
| `crates/agents` | Rail, Worktrees, Agent lifecycle and `AgentAdapter`; Claude Code integration in `src/claude_code/` |
| `crates/messages` | `Messages`, Routes, inbox delivery, Digests, reactions and result history |
| `crates/todos` | `Todos`, SQLite persistence and blocker graph |
| `crates/pads` | `Pads`, SQLite contents and index, optional Markdown files |
| `crates/rupd` | `Daemon`, socket server, Project storage, Event log and module wiring |
| `crates/rup` | `rup` CLI and MCP server (`src/mcp.rs`) |
| `crates/native` | Safe macOS integration for the App: WebKit preferences, menus, alerts and capture panel |
| `crates/perf` | Daemon and native App performance observers |
| `crates/desktop` | Tauri shell, Project Daemon lifecycle, native operations and webview calls/events |

| Path | Non-Rust sources |
|---|---|
| `apps/desktop` | Solid webview and xterm.js Terminal rendering |
| `contracts/generated` | Generated TypeScript contracts; regenerate from `crates/contracts` |
| `contracts/hooks.ts` | Extension Hook types |
| `site` | Published VitePress documentation and search index; `docs/` is unpublished |

## Agent adapter contract

`crates/agents/src/lib.rs` defines the classifier interface:

```rust
pub trait AgentAdapter {
    fn observe(&mut self, observation: Observation) -> Option<Status>;
    fn has_hook_signal(&self) -> bool;
}

pub enum Observation {
    Signal(serde_json::Value),
    Title(String),
    Tick,
    Stopped,
    Exit { code: Option<i32> },
    Program(Status),
}
```

`observe` folds one Observation into a Status; `None` means no change. `has_hook_signal` reports whether the Agent's tooling pushes Signals. The Claude Code implementation combines hook payloads, terminal titles and timed holds; it ignores Program observations when hooks are available. Program observations carry the Terminal program's reported Status for an adapter without hook Signals. Exit and Stopped observations settle lifecycle changes. The adapter emits glossary Kinds; the Daemon computes `blocked` from open Todo blockers through `crates/rupd/src/waits.rs` and `crates/agents/src/rail_view.rs`. See `crates/agents/src/claude_code/mod.rs` and `scenarios/terminal-program-status.md`.

Launching is separate from classification. In `crates/agents/src/spawn.rs`, `Agents::start` calls `Launcher::launch_on` (`crates/agents/src/claude_code/launch.rs`) to prepare the vendor command and environment. `Agents::spawn_behind` then calls `Terminals::spawn` to start the PTY program and attach it to the Rail node.

## Data

- The Daemon opens one Project database, `project.db`, in WAL mode. `crates/rupd/src/storage.rs` owns its migration sequence; `crates/rupd/src/open.rs` wires the stores to it. Rail/Agent metadata, Todos, Pads, Messages, Routes, Touches and the Event log share this database. Old per-store databases are not imported (`scenarios/project-store.md`).
- `crates/rupd/src/data.rs` resolves each Project's data folder beneath the supplied application data directory's `projects/` directory. Project state stays outside the user's source tree; Worktrees are the explicit exception (`scenarios/worktrees.md`).
- Pads store text in SQLite by default. File-backed storage writes `<name>.md` beneath the data folder's `pads/` directory; `crates/pads/src/operations.rs` and `crates/pads/src/files.rs` own storage changes and file access.
- `crates/provenance` records append-only Touches; `crates/rupd/src/event_log.rs` persists replayable Events.

## Message delivery

`crates/contracts/src/message.rs` defines `Message` with `id`, `from`, `to`, `kind`, `body`, `reply_to` (serialized as `replyTo`), `status`, `reason` and `at`. `from` is an authenticated `Actor`, never a send parameter. `MessageKind` is Note or Question; `MessageStatus` is Pending, Delivered or Dropped. A `Route` holds `from`, `to` and `delivery`; `Delivery` is Auto or Drop. Routes are persisted by `crates/messages/src/routes.rs`; an Agent cannot override a Route set by the user.

`crates/messages` stores Messages before delivery. At an eligible receiving Attempt (normally `idle`, plus the live-error case in B37), pending Messages with auto delivery enter its Claude inbox in id order. `crates/messages/src/inbox.rs` checks inbox readiness and writes entries with in-flight records; transcript receipts confirm delivery. A failed readiness check leaves Messages pending. No Message calls `Agents::prompt` or writes Terminal input. Messages to the user are marked delivered immediately and emit an event, without an inbox entry or Terminal write. See B2, B10, B30 and B3563c in `scenarios/messages.md` and the delivery account in `docs/messages.md`.

## Boundaries

The shipped App targets macOS. Linux and isolated Chromium observers cover Daemon and webview behavior; native observations have their own requirements in `docs/perf.md` and the applicable scenarios. Unattended Builders, Reviewers and QA run on GitHub Actions (`AGENTS.md`).
