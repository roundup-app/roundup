# Principles

Every design and UX choice serves these. A PR body names the ids it serves; the Reviewer answers each gate from the diff, and every answer must be "no" (a goal's gate is advisory).

New capabilities in P11–P13 remain goals until their behavioral observers pass. Their gates apply to changed paths; an unrelated existing gap is not a new regression. A policy merge alone delivers none of these features.

## P1 Single front door

The Workstream organizes the work; its Door is the default Agent the user speaks to, and the Thread is that conversation, not another container. The Door breaks objectives down, routes work, absorbs Agent chatter and gives one summary when the work settles; these remain goals until their observers pass. It is the default, never the only way in: the user can always type into any Agent, and a Message to an Agent never writes to its Terminal, so the user's typing is never interleaved with one.

- Gate: does a path make the user address an Agent instead of the Thread to start, route or read work; make an Agent reachable only through the Thread; or let a Message write to an Agent's Terminal?
- Observer: work started, routed and finished through the Thread alone; a Message to an Agent reaches the Claude inbox with zero Terminal writes, and stays pending until the transcript receipt (B3563c).

## P2 Worktree isolation (goal)

Concurrent Agents never share a working directory: each commits in its own worktree and lands only when done. The Project default is still off (`docs/wireframes.md`, decision 12).

- Gate: can two `working` Agents share one cwd?
- Observer: spawn two Agents, compare cwds.

## P3 Cards over chatter

Agents run in the background until they cannot continue; the only interruption is a native request (a question or permission prompt), or a State alert the owner turned on for a state (`scenarios/ui-state-alerts.md`; off by default), shown in the requesting Agent's own Terminal, and answering it there resumes the Agent. A native request makes its Agent `needs-you`; roundup keeps no record of it and draws no answer form. Every `needs-you` Agent's attention entry opens that Agent's Terminal.

- Gate: does anything but a native request or an owner-enabled State alert interrupt the user (a bell, an OS alert with its choice off, Ink on a routine Kind), can native attention fail to lead to the requesting Terminal and its continuation, or does routine progress yield `needs-you`?
- Observer: replay `spikes/hooks-state/*.jsonl`: routine transitions raise no attention, each `needs-you` raises one attention entry that opens its Agent's Terminal (A3564a, A3564e).

## P4 Black-box harness

A vendor tool is an opaque PTY process, run with the login and gateway the user configured. roundup never supplies, removes or hides the user's credentials. It extends the user's settings and environment with its own hooks, tools and rules; A15's nested-run markers and LC2's named lean-profile exclusions are the only implicit exclusions. An Adapter has three seams: spawn in a worktree and PTY; fold Observations into a Kind; inject input and reap the exit.

- Gate: does code outside `crates/agents/<vendor>/` read a vendor string, environment variable or API; does a launch replace the user's setup, discard an unnamed setting or environment variable, or change credentials; or does `AgentAdapter` gain a fourth seam?
- Observer: the trait diff; a `loop/rules.sh` check beside `vocab`; A3507a's launch-fixture guard and A3507e's gateway observation (`scenarios/agents.md`).

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

An Agent's turns use the user's configured login and gateway (P4), and its prompt cache saves most of what each turn costs. roundup starts an Agent only on the user's action or an Agent's tool call. It types a prompt into an Agent only to carry one of four things: the Agent's first prompt (H12); a Steer from the user or from the Agent that started it (H11); a Message (B2), which reaches the Claude inbox and is not typed; or a Work order the user or that Agent set (O4). During one session it never changes what the vendor program caches: the Model, the Effort, the Brief's file, the settings file or the tool list `rup mcp` returns. The one exception is a change the user confirmed under P8, which resumes the Agent. It never types a vendor command into an Agent (for Claude Code: `/model`, `/effort`, `/compact`, `/clear`); `/model` would also overwrite the user's own default. Data that changes during a session, such as the Models a Door may pick (P8), reaches the Agent only in a tool result.

- Gate: does a path start an Agent without the user's action or an Agent's tool call; type a prompt that carries none of the four; change an Agent's Model, Effort, Brief's file, settings file or tool list during its session, other than a confirmed P8 change; type a vendor command into an Agent; or put data that changes during a session into the Brief's file or a tool's description?
- Observer: `Agents::prompt` (H11) is the one function that types a prompt, and each of its callers passes one of the four; the Brief's file, the settings file and the `tools/list` reply of one session are the same bytes at its start and its end; `Agents::open` starts no program (A8).

## P10 The same work takes fewer turns (goal)

Messages pending for an Agent when it becomes `idle` are written to its inbox as one batch, so ten Messages cost one turn, not ten. The Brief's file (E1) is the same bytes for every Agent of one role, and what differs per Agent (its id, its Home, its peers) reaches it only in the Brief's start text (E3), so Agents started side by side in one folder can read one cache.

- Gate: does a path type a second prompt to an Agent where one prompt could carry both, or put per-Agent text into the Brief's file?
- Observer: with the fake `claude`, B22's burst types at most one prompt per `idle` of the Door; the Brief's files of two Doors are equal bytes; on the Mac, with `CLAUDE_CODE_ENABLE_TELEMETRY=1`, the second of two Doors started in one Project reads the cache on its first request (`claude_code.token.usage` of type `cacheRead` above zero, for the main conversation's Model).

## P11 Unfinished input (goal)

For every roundup-owned editable surface, routine navigation, Project/Agent switches, reload, incoming events, external edits and a rejected or failed submit preserve the exact unsubmitted work and its original Project, object and recipient. An external edit keeps the user draft and exposes the conflict; replacement of a question never authorizes delivery to the replacement. A failed older submit cannot overwrite a newer draft; both remain recoverable. A successful acknowledged submit consumes only its submitted revision; an explicit user discard consumes only the selected draft. A draft is never sent merely because it was restored. Declared credential fields retain their existing secret-handling policy rather than gaining automatic disk persistence. Live vendor Terminal input is never written by a Message (B3563c); roundup does not reconstruct a vendor editor after its process dies. A save/restore failure states what could not be retained while preserving the recoverable in-memory work.

- Gate: does the changed path lose or alter unsubmitted work or its original Project/object/recipient; overwrite a newer draft with an older failure; consume a revision other than the acknowledged submission or selected discard; send on restore; add credential persistence; write a Message to a live Terminal or reconstruct a dead vendor editor; deliver to a replaced question; hide an external-edit conflict; or hide a retention failure or destroy recoverable memory?
- Observer: For each changed editable surface, run the unfinished-input probes in `scenarios/product-continuity.md`: compare exact text and identities, submitted call counts and recoverable revisions before and after each action. Use the existing App seam for navigation/reload and real Daemon/public MCP or CLI seams for delivery and identity refusal.

## P12 What they made (goal)

Every published user-facing deliverable has a stable Project-scoped record identifying its maker, Home, title and the exact file/object revision or external target it names. It remains discoverable when its maker stops or its Worktree is cleaned up. Opening or sending it uses that recorded identity and its existing access rules; a mutable current link is explicitly distinguished from a published revision. An unavailable target is shown as unavailable with its cause, never silently replaced with another file, newer contents or another Agent's work. Explicit user removal and access revocation remain effective. User-facing deliverables enter this contract when deliberately published through a declared output capability; Terminal streams, tool scratch files, every source edit and every Todo state do not automatically become deliverables. Existing Pads, links, files and PRs compose into one discovery surface rather than duplicate authoring/storage systems or a custom Agent conversation UI.

- Gate: does a declared publication lack stable Project/maker/Home/title/target identity; disappear with its maker or Worktree; open/send a substituted target or revision; conflate a mutable current link with a published revision; hide unavailability or its cause; override removal, revocation or a user Home move; publish undeclared scratch work; or duplicate an existing authoring/storage system or introduce a custom Agent conversation UI?
- Observer: Publish distinct same-titled targets in two Projects, stop their makers and remove source Worktrees, then discover/open/send by recorded identity. Apply the deliverable probes in `scenarios/product-continuity.md`, checking exact revision or explicit unavailability, permissions, user moves/removal and no publication from scratch files.

## P13 Named reactions (goal)

A named reaction records its authorizer, Project, target identity, instruction, declared observed-event condition or explicit time condition, and finite firing/expiry bound. It can be inspected, stopped and explicitly run within the same authority. Event conditions use authoritative observed facts and source revisions/cursors; unknown or stale facts are not a successful match, and an unsupported event source fails visibly. The condition itself spends no Model turn. Each accepted match/firing identity creates one durable Message through existing delivery, batching, inbox, Attempt, Reach and permission rules; replay, duplicate notifications, an unchanged true condition and overlapping checks do not create another firing of that identity. A stopped reaction accepts no later firing; already accepted or delivered work is reported honestly and is not promised to be undone. Repeat firings require a declared re-arm rule and bound. A restart starts no program by itself; a retired or replaced target is not silently substituted. This guarantees reaction-to-Message identity, not exactly-once external side effects. A time condition declares its missed-time policy; waking applies it once without an unbounded catch-up backlog. Time is another declared trigger, not a reason to poll Agents for conditions already available as Events.

- Gate: does a reaction omit its recorded authority, Project, target, instruction, declared trigger or finite bound; prevent inspection/stop/authorized explicit run; match stale/unknown facts or hide an unsupported source; spend a Model turn evaluating conditions; leave an accepted firing without its one durable Message; duplicate a firing Message on replay or overlapping checks; accept a firing after stop or promise to undo accepted work; repeat without bounded re-arm or create an unbounded missed-time backlog; omit or ignore the declared missed-time policy; start a program on restart; substitute a target; bypass normal Message guards; or poll Agents for facts already available as Events?
- Observer: Use authoritative source fixtures through the real Daemon and public MCP/CLI seams, counting durable Messages by accepted firing identity and fake-vendor prompts. Run the reaction probes in `scenarios/product-continuity.md`, including crash/replay, stale revisions, simultaneous clauses, cancellation races, sleep/missed time and guarded delivery. No fixture may use a Model to decide a condition.

## P14 roundup computes and shows no cost, price or token counts

The Time and Timeline views and measurement machinery are removed (`scenarios/remove-time-timeline.md`, U4454a–d). roundup reads, sums, prices, stores, sends and shows no token count, money amount, rate, price estimate or plan-limit percentage; Claude Code's own `/cost` and `/usage` already cover them. This is a non-goal, not a backlog: an Issue that asks for cost, price, tokens or a usage meter is answered with this principle and is not built.

- Gate: does a path parse a vendor record's usage or money, hold a rate or price, store or send a token or money value, or show one in the App, a Card, the CLI or a tool reply?
- Observer: `u3016l_no_cost_or_token_names_remain` finds no cost or token name in the App, crates or contracts, and `u3016l_vendor_usage_and_cost_fields_are_dropped_at_the_adapter` reads a fixture that carries usage and gets time only.
