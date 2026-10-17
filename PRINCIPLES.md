# Principles

Every design and UX choice serves these. A PR body names the ids it serves; the Reviewer answers each gate from the diff, and every answer must be "no" (a goal's gate is advisory).

## P1 Single front door

The Workstream organizes the work; its Door is the default Agent the user speaks to, and the Thread is that conversation, not another container. The Door breaks objectives down, routes work, absorbs Agent chatter and gives one summary when the work settles; these remain goals until their observers pass. It is the default, never the only way in: the user can always type into any Agent, and during a Takeover the Door sends that Agent nothing (its Messages wait Held).

- Gate: does a path make the user address an Agent instead of the Thread to start, route or read work; make an Agent reachable only through the Thread; or let the Thread send to an Agent under Takeover?
- Observer: work started, routed and finished through the Thread alone; a Takeover whose Messages stay Held until it ends.

## P2 Worktree isolation (goal)

Concurrent Agents never share a working directory: each commits in its own worktree and lands only when done. The Project default is still off (`docs/wireframes.md`, decision 12).

- Gate: can two `working` Agents share one cwd?
- Observer: spawn two Agents, compare cwds.

## P3 Cards over chatter

Agents run in the background until they cannot continue; the only interruption is a Decision, and answering it resumes the Agent. A Decision is valid when its Agent is `needs-you`, it holds one question and the answers that unblock it, and it is that Agent's only open one (a repeat updates it). Every `needs-you` Agent has exactly one.

- Gate: does anything but a valid Decision interrupt the user (a bell, an OS alert, Ink on a routine Kind), or does routine progress yield `needs-you`?
- Observer: replay `spikes/hooks-state/*.jsonl`: routine transitions open no Decision, each `needs-you` opens one valid Decision.

## P4 Black-box harness

A vendor tool is an opaque PTY process, run on the user's subscription, never an API key. An Adapter has three seams: spawn in a worktree and PTY; fold Observations into a Kind; inject input and reap the exit.

- Gate: does code outside `crates/agents/<vendor>/` read a vendor string, environment variable or API, or does `AgentAdapter` gain a fourth seam?
- Observer: the trait diff; a `loop/rules.sh` check beside `vocab`.

## P5 Explicit landing

An Agent never pushes the shared branch: its changes rebase, pass `check` and fast-forward. A dropped or rejected Agent leaves no worktree and no branch.

- Gate: does a path write `main` other than rebase, green `check`, fast-forward; or does a rejected Agent leave an entry in `git worktree list` or `git branch`?
- Observer: both lists compared before spawn and after reject.

## P6 A Workstream holds its work

A Workstream holds its Door, Agents, Terminals, Todos, dependencies and Sketches, and survives its Door stopping. Each item has one Home the user can change at any time; the Door places the children it makes, and the user's move always wins. Workstream-scoped Todos and Sketches are required product work; the Project-wide Shelf does not satisfy this goal.

- Gate: does a new kind of item lack a Home the user can change, or does an Agent's placement override the user's?
- Observer: one item of each kind made in Home A, moved to B, found only in B, the move in Provenance.

## P7 A bound folds, never deletes (goal)

Every cap roundup puts on what a Door or the user reads shortens it by folding older Messages into one; it never makes them unreadable. A Message that stands for others names their ids, and each stays readable through `message.get` by whoever could read it before, so the reader can always open what a summary stands for.

- Gate: does a cap, merge or rollup make a Message unreadable to a reader that could read it, or replace Messages with one that does not name their ids?
- Observer: after B22's burst of 100 changes, every pushed digest is delivered or reachable from a delivered one through the ids merges name, and `message.get` opens each for its Door.

## P8 The user picks each Agent's Model (goal)

Every Agent roundup starts runs on the Model and Effort the user chose. For each Project the user sets a Model and an Effort for each Agent role roundup starts (the Door, a Subagent, and each role added later). The user can also set them for one Agent at its start, or while it runs. A Door picks a Subagent's Model from any the Adapter lists; an id it does not list is refused. A Model or Effort the user has not set is not passed, so the vendor's own default applies. A change to a running Agent applies at once, after one confirm that says the Agent re-reads its conversation on the new Model; the Agent then resumes the same conversation on it. The Adapter lists the Models and Efforts it offers; outside `crates/agents/<vendor>/` each is an opaque id (P4).

- Gate: does a path start or resume an Agent on a Model or Effort the user did not set and no Door's call picked from the Adapter's list; change a running Agent's Model or Effort without the confirm; or name a Model or Effort outside `crates/agents/<vendor>/`?
- Observer: for each Agent role, the Model and Effort the vendor program runs on (read from the program, since an environment variable outranks a flag) are the ones the user set, and the vendor's defaults when unset; a Door's `agent_spawn` with a Model off the list is refused; a confirmed change resumes the same conversation once, on the new Model.

## P9 roundup spends the user's usage only when asked

An Agent's turns spend the user's plan limits (P4), and its prompt cache saves most of what each turn costs. roundup starts an Agent only on the user's action or an Agent's tool call. It types a prompt into an Agent only to carry one of four things: the Agent's first prompt (H12); a Steer from the user or from the Agent that started it (H11); a Message (B2); or a Work order the user or that Agent set (O4). During one session it never changes what the vendor program caches: the Model, the Effort, the Brief's file, the settings file or the tool list `rup mcp` returns. The one exception is a change the user confirmed under P8, which resumes the Agent. It never types a vendor command into an Agent (for Claude Code: `/model`, `/effort`, `/compact`, `/clear`); `/model` would also overwrite the user's own default. Data that changes during a session, such as the Models a Door may pick (P8), reaches the Agent only in a tool result.

- Gate: does a path start an Agent without the user's action or an Agent's tool call; type a prompt that carries none of the four; change an Agent's Model, Effort, Brief's file, settings file or tool list during its session, other than a confirmed P8 change; type a vendor command into an Agent; or put data that changes during a session into the Brief's file or a tool's description?
- Observer: `Agents::prompt` (H11) is the one function that types a prompt, and each of its callers passes one of the four; the Brief's file, the settings file and the `tools/list` reply of one session are the same bytes at its start and its end; `Agents::open` starts no program (A8).

## P10 The same work takes fewer turns (goal)

Messages pending for an Agent when it becomes `idle` are typed as one prompt, so ten Messages cost one turn, not ten. The Brief's file (E1) is the same bytes for every Agent of one role, and what differs per Agent (its id, its Home, its peers) reaches it only in the Brief's start text (E3), so Agents started side by side in one folder can read one cache.

- Gate: does a path type a second prompt to an Agent where one prompt could carry both, or put per-Agent text into the Brief's file?
- Observer: with the fake `claude`, B22's burst types at most one prompt per `idle` of the Door; the Brief's files of two Doors are equal bytes; on the Mac, with `CLAUDE_CODE_ENABLE_TELEMETRY=1`, the second of two Doors started in one Project reads the cache on its first request (`claude_code.token.usage` of type `cacheRead` above zero, for the main conversation's Model).
