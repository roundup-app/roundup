# roundup

roundup supervises coding Agents in each open Project from a macOS App. Names use these terms (`AGENTS.md` rule 6); _Avoid_ words are allowed only under `crates/agents/src/claude_code/`, where Claude Code's own terms live.

## Language

### Project and its nodes

**Project**:
A folder roundup is opened on; it owns its Workstreams, Agents, Terminals, Todos, Pads and Routes.

**Project data**:
The databases, launch files and Pad files roundup keeps for a Project, in `<app data>/projects/<key>/` and never in the Project folder (N1); only Worktrees go in the Project's `.roundup/` (G2).

**Agent**:
One supervised identity, with a Status, on the Rail under its Workstream or, for a Scribe, at the root only while its Kind is `error` or `needs-you`; each launch of its program is an Attempt, and at most one runs at a time.
_Avoid_: session, bot, worker

**Terminal**:
A shell or program roundup started, with a screen the user can watch; no Status beyond running or exited. Never a Rail row and never stored: it ends with the Daemon, with its owner's removal or when the user closes it. An Agent's own Terminal is its pane; any other is shown as a Bubble.
_Avoid_: process, console

**Bubble**:
How the App shows a Terminal that is not an Agent's pane: a panel floating over the centre pane that the user moves, resizes, minimises to a chip and makes more or less transparent. It ends with its Terminal.
_Avoid_: overlay, popup

**Run**:
A Terminal an Agent started (`agent.run`), shown as a Bubble while that Agent is selected; it ends with its Agent's removal, never with its Status.

**Snapshot**:
A bounded copy of a Terminal's screen and output byte offset that restores its pane after a webview reload.

**Workstream**:
The persistent place for one body of work, named for the work, with exactly one Door and its Agents, Terminals, Todos and Sketches. Stopping its Door neither removes the Workstream nor moves its contents. Workstreams are flat: one never sits under another. Its Agents nest under the Door and under each other (Subagent). Cross-Workstream dependencies are open.
_Avoid_: room, folder

**Home**:
Where an item sits: a Workstream, or the Project root. Each item has one Home the user can change. A Todo's Home changes with `todo.move`, a Pad's with `pad.move`. The Shelf shows a selected Workstream's own items until the user asks for all (U347).

**Door**:
The coordinating Agent role of one Workstream, with a system prompt tuned to that role. Its Rail id is the Workstream id; its program may be starting, running or stopped without changing the Workstream. Direct access to any Agent remains (P1).
_Avoid_: meta-agent, parent agent, lead

**Subagent**:
An Agent that another Agent, the Door or a Subagent, started. The Rail shows it nested under the Agent that started it, to any depth, within that Agent's Workstream. Claude Code's own in-process subagents are not on the Rail and are not Subagents.
_Avoid_: child agent, sub-agent, meta-agent, parent agent

**Digest**:
A Door's fixed-size envelope about one direct child, `{name, kind, last, todos, pads}`, asked for with `agent.digest`, or pushed to the Door as a Message when the child's Kind, Pads or open Todos change (B21), and never read from Terminal output (B19, B20).

**Checkpoint**:
A short card of facts a Door writes when its Workstream's work reaches a point worth marking, `{id, workstream, at, title, blocks}` (M10). Not a Message: it has no Route, status or delivery. Written with `checkpoint.write`, listed with `checkpoint.list`.

**Block**:
One part of a Checkpoint that the Door chooses: `rows` (label and value), `table`, `diagram` (Mermaid source) or `text`, each with an optional title (M10).

**Full log**:
The closed fold of a Door's Thread that lists every Message of its Workstream, notes to children, copies, `held` and `dropped` included, under a count; the Checkpoints and what needs the user sit above it (U355).

**Rollup**:
The one Message that stands for the pushed Digests a window's cap held back (B22), or the merge of the oldest two when more than 20 are open. Each pushed Digest has a weight, the number of changes it stands for, so no cap loses a count.

**Attempt**:
One launch of an Agent's program, numbered per Agent from `1` in launch order (A20). It travels in the hook command, `SignalParams`, `StatusEvent` and `RailNode.attempt` as a canonical positive decimal string within SQLite's signed 64-bit range; a client may compare two of one Agent and reads nothing else from it. Never a Rail identity or a vendor conversation id; the last one survives stop, failure and reopen.

**Status revision**:
The strictly increasing ordinal of published Status transitions within one Attempt, `1` at Starting. A canonical positive decimal string on the wire; absent after reopen. Never stands in for an Attempt or Terminal liveness.

**Resume**:
Starting an exited Agent's next Attempt in its saved conversation.

**Worktree**:
The git worktree roundup makes for one Agent when the Project's `worktrees` setting is on: its own directory, branch and working directory (`docs/worktrees.md`).

**Worktree state**:
How far an Agent's Worktree is from its Base: `ahead` and `behind` in commits, and `dirty` when it has changes outside `.roundup/` (`agent.worktreeState`).

**Base**:
The branch checked out in the Project when the Agent spawned; the Agent's branch starts there.

**Landing**:
Rebasing an Agent's branch onto its Base, running the Project's check, then fast-forwarding the Base (`agent.land`, which returns `Landed`: the Base's new commit).

**Discard**:
Deliberately dropping an Agent with its Worktree and branch whatever their state (`agent.discard`); `rail.remove` refuses instead when work would be lost.

### The App

**App**:
The macOS window; it starts a Daemon for each open Project and hosts the webview, a client of that Daemon like any other.

**App seam**:
The few Tauri commands and events between the App and its webview (`scenarios/app.md`); not a Daemon contract.

**File drop**:
The window's native drop of files, which the Tauri shell takes before the webview sees a DOM `drop`; the App seam reports it as `onFileDrop` and a Terminal pane pastes the dropped paths (U162); while one is dragged the Rail's rows and the Project tabs are its drop targets (U348).

**Project tab**:
One entry of the header strip for an open Project: its name (the folder's until the user renames it) and one Tab mark; closing it stops that Project's Daemon (`scenarios/project-tabs.md`).

**Tab mark**:
The one circle on a Project tab: `◉` in red for an Agent in Kind `error`, else `●` in amber for Kind `needs-you`, else none. Not a Glyph: the ring is the tab's own shape for error.

**Rail**:
The tree of Workstreams and Agents.

**Shelf**:
The Todo and Pad column. With a Workstream selected it shows that Workstream's own Todos and Pads until the user chooses `all`; otherwise it is Project-wide.

**Inbox**:
The time-ordered Drawer of Messages to the user.

**Drawer**:
A panel that slides in from the right over the terminal and the Shelf (a Todo, a Pad, later the Inbox); it never resizes the terminal.

**Switcher**:
The field `⌘K` opens over the centre pane, listing every Rail node by name to select one.

**Help**:
The panel `?` opens over the centre pane, listing each chord and what it does.

**Todo**:
An item with an optional blocker list of other Todos, with a Home, in one order, the user's.
_Avoid_: task, ticket

**Sketch**:
A Pad holding Mermaid or drawing blocks; the Pad contracts are unchanged. Workstream-scoped storage is still open.

**Drawing**:
A fenced ```excalidraw block in a Pad whose JSON body is a diagram the user edits in place and an Agent writes as text. It is Pad text, so the Pad contracts are unchanged.

**Pad**:
A markdown note owned by an Agent or the user, with a Home (P12). "Scratchpad" is the product word in prose only.
_Avoid_: scratchpad

**Scribe**:
The one Agent started for a single Pad by the user's first ask in its Drawer; it reads that Pad, answers the user and may rewrite that Pad, whoever owns it. It has no Rail row until its Kind is `error` or `needs-you`.

**Editor**:
A Pad's single formatted Markdown surface the user reads and types in.

**Attachment**:
An image pasted or dropped into the Thread's input, shown inline as its name and size with a hover preview; not a Chip.

**Paste placeholder**:
The short `[Pasted text #N +M lines]` the Thread's input shows for a long paste; the full text is what the Door receives.

**Quote**:
Selected text attached to the Thread's input as a block with its source.

### Status

**Status**:
`{kind, label, since}`.

**Kind**:
One of `error | needs-you | blocked | working | idle | done`, most urgent first; the Adapter decides all but `blocked`, which the Daemon decides from Todos and Routes. Hooks never change it.

**Glyph**:
The one mark a row shows for its most urgent Kind: `✕ ● ⏸ ○ · ✓`.

**Ink**:
Bold plus colour, used only for `error` (red) and `needs-you` (amber).

**Chip**:
An extra label after a name; it never changes the Glyph.

**Live line**:
The Status label and how long it has held, on a Rail row's own line.

### Agents at work

**Adapter**:
The code that turns one agent vendor's process into an Agent (`AgentAdapter`).

**Observation**:
One input an Adapter reads about its Agent: a terminal title, a Signal, an exit, a stop roundup asked for, or a clock tick.

**Signal**:
A structured event the Agent's own tooling pushes (for Claude Code, a hook payload).
_Avoid_: notification, alert

**Steer**:
Sending a prompt to a running Agent through the Adapter (`agent.prompt`), never through the user's keyboard.
_Avoid_: inject, nudge

**Interrupt**:
Ending the Agent's current turn through the Adapter (`agent.interrupt`); the Agent stays alive and becomes `idle`.
_Avoid_: cancel, abort

**Takeover**:
The user typing into an Agent directly; meanwhile no other Actor sends it anything.

**Work order**:
The ask an Agent works on and its limits, rules that each read on their own, such as "Change no file in the repo", held on the Agent's Rail node. Not a Work Issue.

**Clarification order**:
The open question an Agent holds instead of a Work order; the Agent finds the intent, elicits what is missing and shapes a Work order.

**Skill**:
A named instruction the vendor program can run when the user types `/<name>`: a folder or file the user, the Project or a plugin holds. `agent.skills` lists them; reading the vendor's folders is the Adapter's (P4). Not an Extension.

**Brief**:
The text roundup gives an Agent at start (`docs/awareness.md`), in two parts. Its file (E1) says roundup supervises the Agent and lists its tools; the file keeps the same bytes for the Agent's session (P9). Its start text (E3, `agent.brief`) gives the Agent's Context in words.

**Context**:
What `agent.context` returns for one Agent: its own Status, its parent, whom to ask (a Door's id, or the user's), its peers and its open Todos. The Brief's start text says the same in words.

**Channel**:
Whether one Agent's `roundup` MCP server (`rup mcp <id>`) has reported to the Daemon: `pending`, `up` or `missing`. Not the vendor's own channels feature.

**Stray**:
A process under a Door's Terminal whose program name is one an Adapter supplies and that the Daemon did not register, found by name (F5). `RailNode.stray` lists them and the event `agent.stray` announces a change; it only detects.

**Shim**:
The executable a Door's `PATH` finds first for each vendor program name; it prints that the Door starts an Agent with `agent_spawn` and exits 1 (F4). It stops a lookup by name and nothing else.

**Model**:
The vendor model an Agent runs on, which the user picks (P8). Outside its Adapter, which lists the Models it offers, a Model is an opaque id.

**Effort**:
How much an Agent's Model reasons per turn, picked with the Model (P8); an opaque id outside its Adapter.

**Usage**:
The share of the user's plan limits that an Agent's turns spend (P9, P10).

**Evaluator**:
A small model run inside the Daemon for a routine judgement at no frontier-model cost; a spike (B27), not yet built.

### Messages and Cards

**Thread**:
The conversation with a Workstream's Door about that Workstream's work, not a second container; today it is the Door's Terminal.
_Avoid_: chat, main agent

**Message**:
A typed envelope `{from, to, kind, body, replyTo}` between Actors, with a status of `pending`, `held`, `delivered` or `dropped`.

**Route**:
A sender→receiver pair with a delivery value: `auto | ask-first | drop`.

**Held**:
A Message waiting on an ask-first Route, the end of a Takeover, the submit or clear of unsent input, or the user's answer to an escalated question.

**Unsent input**:
The bytes the user wrote to an Agent's Terminal since the last submit or clear. While there are any, no Message is typed there (B32).

**Reason**:
The word on a held or dropped Message saying why: `ask-first`, `takeover` or `escalated` (held); `receiver gone`, `not accepted` or `passed` (dropped).

**Hop**:
One Message of a bubbling question: sent to an Agent, then to each Agent above it in its Workstream, nearest first, ending with the Door, each linked to the one before by `passedFrom`. A hop passes when its Agent answers nothing within 60 000 ms or calls `message.pass`; the chain ends at the Escalated question.

**Escalated question**:
The Message to the user that ends a bubbling question: `held` with the reason `escalated`, never `delivered` until the user answers it.

**Card**:
Anything the user sees in the app (a permission request, a question, an Inbox Message, a status, a summary); it has a kind.
_Avoid_: popup

**Decision**:
The kind of Card that blocks an Agent on a live hook or tool call; only the user answers it. An Agent's `ask_user` call is one, answered with one of its listed answers (outcome `answered`).

**Actor**:
The user, an Agent, an Extension or the Daemon (as `rupd`) making a call.

**Reach**:
The Rail nodes an Agent may act on through its MCP server: its descendants, and the Workstreams it created with theirs (`scenarios/mcp.md` M7); a call outside it is `FORBIDDEN`.

**Touch**:
One logged read or write of a Todo, a Pad or a Message by an Actor.

**Provenance**:
The append-only log of Touches.

### Daemon and Extensions

**Daemon**:
`rupd`, the local process everything else is a client of.

**Proof**:
The random secret the App gives its attached Daemon on stdin and the webview reads through `daemon_proof`; `decision.answer` needs it, so only the user can answer a Decision (H4, H18).

**Extension**:
A directory with a manifest and one module.

**Hook**:
One `($, e, next)` function an Extension registers.

### Design system

**Token**:
One named look value in `apps/desktop/src/tokens.css` (a colour, type step, space step, radius, shadow or duration); no other file holds such a literal.

**Signifier**:
What shows that something can be clicked: its hover surface, `pointer` cursor and focus ring.

**Button kind**:
One of five looks every button of the App takes, named by its `data-button`: `primary`, `quiet`, `add`, `row-action`, `icon`; each is defined once, from Tokens, in `apps/desktop/src/buttons.css` (`docs/design-system.md`, "Click targets"). A row is not a button.

**Check**:
One pass-or-fail rule of `docs/design-system.md` (`D1` to `D10`).

**Held-out screen**:
A screen the Design critic runs that no Builder's prompt lists.

### The loop

**Work Issue**:
An open GitHub Issue that the user or a loop App filed, holding a scoped outcome, acceptance references, immutable Key, priority and native dependencies, or a request without them that a build run specifies first. Who filed it authorizes execution; `flag:needs-user` or `flag:needs-mac` holds it; its delivery evidence determines completion (L34).

**Builder**:
The one kind of agent run that builds roundup and reviews it, each run fresh, from `.agents/builder.md`: a build run takes a GitHub work Issue, a fix run answers a reject or a failure, and a review run judges a PR's head, never its author's rationale (L23, L24).

**Screen**:
The Haiku run in a build or fix job that reads what the run asks the user, a build run's non-empty `ask` or a draft's `Stopped:` paragraph, against `.agents/screen.md` and sends it to the user (`flag:needs-user`), to an agent on the user's Mac (`flag:needs-mac`) or back to the loop: an `ask` as a strike, a draft as an `unfinished` fix run (L79, L81).

**Code PR**:
A PR touching `apps/`, `crates/`, `contracts/` or a Build file; it needs a `Scenarios:` line (L46).

**Ready PR**:
A Builder PR out of draft with auto-merge armed. Only `just ready` makes one, once the body holds the lines `.agents/data/pr.md` asks for (L100). An Issue's ready row (L34) is another thing.

**Build file**:
What `just check` runs and builds with: `justfile`, `Cargo.toml`, `Cargo.lock`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `rust-toolchain.toml`, `tsconfig.json`, `.oxlintrc.json`, `.fallowrc.json`, `.cargo/` and `tools/` (L46).

**Loop machinery**:
`loop/`, `.github/`, `.agents/`, `.claude/`, and every `AGENTS.md` or `CLAUDE.md`; review runs read `main`'s copy, never the PR's, and a review run rejects a change that lets a PR pass its own gate (L24, L46).

**Percy build**:
Percy's Chromium render of every harness seed for one PR head, made by the `percy` job when the PR touches `apps/desktop/src/` (L36); the ruleset requires that job on every PR (L46). Its images are not Snapshots.
_Avoid_: proof branch
