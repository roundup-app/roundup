# Worktrees

Design for `scenarios/worktrees.md` (G1–G9 and G2542a–G2542e). G1–G9 describe legacy behavior; prepared-directory mode below is specified for separate implementation. Terms: Worktree, Base, Landing (`GLOSSARY.md`).

## Principles served

| Id | Gate and answer |
|---|---|
| P2 | Does a new path let two Agents with Kind `working` share one cwd? Yes while a Project's `worktrees` setting is off, which is the default and `docs/wireframes.md` decision 12. With it on, no: G2's test spawns two Agents, starts two Doors and compares their cwds; `agent.spawn` and `rail.startDoor` are the two paths that start an Agent. P2 stays a goal, as it says. |
| P4 | Does code outside `crates/agents/<vendor>/` read a vendor string, and does `AgentAdapter` gain a seam? No to both. Provisioning runs in `crates/agents` before the Agent's Terminal starts, and the Adapter trait gains nothing: the working directory it is given is the Worktree. |
| P5 | Does a path write the Base other than rebase, check, fast-forward? No: `agent.land` is the only writer. No gap: with the Project's `check` `null`, `agent.land` refuses (`check_missing`) instead of skipping, because P5 requires "check green" and nothing in it allows a skip. Isolation (G2) needs no check, so the setting may be on without one. Does a rejected Agent leave a worktree or branch? No: G5's test compares `git worktree list` and `git branch` before and after. |

P5 says "a dropped or rejected Agent leaves no worktree and no branch". The user's rule here is that removal never deletes unlanded or dirty work. Both hold: `rail.remove` refuses when work would be lost (`worktree_unlanded`), and `agent.discard` is the deliberate drop that deletes it. P5's "dropped" means `agent.discard`. The user confirmed this reading.

## Shape

- **Library.** The `git` command, run with `std::process::Command` and no shell, in `crates/agents/src/worktree.rs`. `git status --porcelain=v2 --branch` gives branch, ahead, behind and dirty in one call; `git worktree add`, `git rebase` and `git merge --ff-only` are the same operations a user runs, and the user's hooks and config apply. `git2` is rejected: a native dependency, and its rebase reports conflicts differently from git. The cost is `git` on `PATH`; a missing one is `worktree_failed`.
- **State.** The `nodes` table (`crates/agents/src/rail.rs`) gains `worktree_path`, `worktree_branch`, `worktree_base`, all null for a node with no Worktree, and `worktree_state` (`provisioning` from before `git worktree add` runs until the Worktree exists and just before the Agent's Terminal starts, then `ready`; no RPC returns it). A restart rolls back only a `provisioning` node, so it never deletes a Worktree an Agent has begun to use. Live status (ahead, behind, dirty) is never stored: `agent.worktreeState` asks git on each call, so `rail.tree` stays cheap with ten Agents.
- **Setting.** One row in a new `settings` table of `agents.db`, the file the Agents module opens in the Project's data folder (N1) (`worktrees` on/off, `check` command or null), written by `project.setWorktrees`, read by `project.get`. `docs/architecture.md` still says one `roundup.db`; each module has its own file, and this doc does not edit that line. The G1 to G3 row owns `agents.db`.
- **Home is logical, the path is not.** An Agent's Home (`GLOSSARY.md`: the Workstream it sits in, or the Project root, stored as the node's `parent` and `order`, a row in SQLite) and its Worktree's `worktree_path` (a directory chosen once, from the Agent's id) never derive from each other. A `rail.move` writes the first and never reads or writes the second, so a moved Agent keeps its working directory, its uncommitted edits and its `git diff` byte for byte (G7). Restart finds Worktrees by the stored path (G6), not by Rail position. A Worktree cannot change Project: a Rail belongs to one Project (one Daemon, one database), so a cross-Project `parent` is `NOT_FOUND`, and a repository is one Project's.
- **Where.** `<Project folder>/.roundup/worktrees/agent-<id>`, inside the Project folder because A4 pre-trusts only a working directory inside it. `.roundup/` holds only Worktrees (N2) and goes in `.git/info/exclude`, which is local, so the user's tracked files and `git status` do not change.
- **Landing.** In the Worktree: `git rebase <base>`; on conflict `git rebase --abort` and report the paths (`git diff --name-only --diff-filter=U`, read before the abort). Then the `check` command with `sh -c` in the Worktree. Then `git -C <Project folder> merge --ff-only <branch>`. Each step records the branch's starting commit, so a later failure resets it. The Daemon runs one `git` command at a time per Project (a mutex in `worktree.rs`), because `git worktree add`, `rebase` and `merge` take the repository's locks and two Agents spawning at once would otherwise fail on `index.lock`. A node is stored as `provisioning` before `git worktree add` runs and set to `ready` before the Terminal starts, so a Daemon killed in between is rolled back on the next start (G6).

## Contract change (separate PR, rule 4)

| Method | Params | Result |
|---|---|---|
| `project.setWorktrees` | `{on, check}` | `null` |
| `project.get` | `null` | `{worktrees: {on, check}}` |
| `agent.worktreeState` | `{id}` | `{ahead, behind, dirty}` |
| `agent.changedFiles` | `{id}` | `{files: [{path, status, line, from?}]}` (U2539a) |
| `agent.land` | `{id}` | `{base}` |
| `agent.discard` | `{id}` | `null` |

`RailNode` gains `worktree: {path, branch, base} | null`; every caller of `RailNode` (the webview's `railFixture`, `seeds.ts`, the e2e tests) changes in that PR. `rail.remove` gains the error `worktree_unlanded` (A16 does not; it is G5's), and `agent.spawn` and `rail.startDoor` the codes of G2. The error codes are existing `rpc::code` constants with a lowercase prefix in the message (see `scenarios/worktrees.md`), so `crates/rpc` is untouched. `agent.worktreeState` returns `{ahead, behind, dirty}`, which is not a Status (`GLOSSARY.md`), so its name avoids that word. The Agents module owns the `project.*` methods (it adds `project` to its namespaces; the App's `project` command is a seam command, not RPC). No UI scenario is written here: a Rail badge for ahead, behind and dirty, and a Landing button, come after this lands.

## Open for the user

- `~/.claude.json` keeps a pre-trust entry (A4) for each Worktree path; discarding or removing a Worktree does not clean it, and legacy Worktree paths are never reused, so those entries are only clutter. Enrolled paths stay fixed across assignments.

- The `check` command runs with the user's shell and rights. It is only what the user typed into their own Project's setting.
- A Project nested in another repository uses the repository that `git rev-parse --show-toplevel` finds; G2 does not cover a Project that is a subfolder of a repository. Say if that must work.

## Legacy creation alternatives

| | A. Daemon, on for every git Project | B. Daemon, behind the setting (this design) | C. caller or helper provisions; the Daemon takes a cwd | D. the vendor's own worktree option |
|---|---|---|---|---|
| Isolation guarantee | Yes for every Agent | Yes when on; none when off (P2 stays a goal) | None the Daemon can check: P2's observer is a hope | Claude Code only |
| Crash between add and spawn | Rolled back on start (G6) | Same | A script's problem; orphans nobody owns | The vendor's, and invisible to roundup |
| Orphans, dirty removal | `rail.remove` refuses; `agent.discard` is explicit | Same | No rule; a helper may delete work | The vendor asks the user on exit, inside the Terminal |
| Disk per worktree (`node_modules`, `target`) | Every Project pays it | Only an opted-in Project | The caller's choice | Vendor symlink settings, by its docs |
| Restart recovery | Stored paths, G6 | Same | None | Guess the vendor's directory layout |
| Daemon complexity, perf (rule 7) | One module, git at spawn only | Same, plus one setting | None | A parser of vendor behaviour |
| Fit with `AgentAdapter` (P4) | Vendor-neutral | Vendor-neutral | Vendor-neutral | Breaks P4: each vendor has its own or none |
| Surprise to the user | Spawns slow down, disk grows, in a Project that never asked | Only when switched on | Whatever the helper does | An unrelated prompt when a Terminal closes |

Rule 7: cold start and idle RSS do not change in A, B or D, since `git` runs only at spawn, landing and status, never in `rail.tree`, and holds no memory between calls. Not measured: `git worktree add` time on a large repository, and disk per worktree. Neither is in the budget, but both are what A would make every user pay.

The legacy choice remains B: vendor-neutral provisioning behind the Project setting. The earlier blanket rejection of vendor worktree support is superseded by [ADR 0011](adr/0011-prepared-worktrees.md). Vendor tools can prepare a directory; roundup must still own assignment, Landing and recovery. Launching nested vendor worktree creation inside an assigned directory would defeat that ownership.

## Prepared directories (specified)

The opt-in mode keeps dependencies at their original paths between assignments. Existing Project commands and tools prepare directories once; roundup neither installs packages nor copies dependency roots. The primary checkout and paths outside A4's trusted cwd boundary cannot be enrolled. Only explicit local user configuration grants enrollment or command execution; discovery and repository configuration grant neither.

```text
Project setup → explicit enrollment → idle prepared directory
  → persist exclusive reservation → switch tracked source without force
  → Project readiness exits 0 → start Agent
  → stop all users → recheck clean and landed
  → detach at parked commit → delete Agent branch/node → available
```

The Project readiness command validates the environment on every assignment, including dependency/toolchain/setup changes. It has an explicitly configured positive timeout. Failure reports phase, path, available exit status and the last 20 lines (at most 16 KiB) of diagnostics; the Project command must redact secrets. Failure or cancellation leaves the path unavailable for explicit preparation. Cold setup and capacity exhaustion are preparation states; no fallback installs, copies or launches in the primary checkout. Capacity is bounded by enrolled paths.

`crates/agents` owns configuration, reservations and durable recovery through existing storage and git execution. The same assignment path serves `agent.spawn` and first `rail.startDoor`; vendor Adapters receive the resulting cwd. Configuration contracts and every caller change atomically in implementation, with names added to the glossary then; this specification introduces no RPC or public identifier. Readiness is distinct from G4's Landing check, which still gates writing the Base.

Before switching, canonical path, repository identity, git registration, branch ownership, clean/landed state and absence of an in-progress git operation must hold. A recorded Agent, running Terminal or preparation process reserves the path even if git is clean. Persist ownership before any branch mutation. Unknown crash state remains unavailable until reconciled; a restarted Door uses its recorded assignment without switching or readiness writes. Never reset, stash, clean or force-switch to make an assignment available.

Clean removal retains the enrolled directory and ignored files at the same path on a parked detached commit, deleting only the Agent branch and node after all users stop and a second clean/landed check passes. Dirty or ahead work remains attached to its stopped Agent. Explicit discard may discard Agent work but retains dependency roots; unenrollment does not delete the directory. G6's fresh-directory rollback deletion never applies to enrolled paths. G9 removal/rollback must likewise preserve enrolled directories and ignored files. Failed metadata restoration reports recovery instructions and retains the path.

No vendor-specific orchestration, automatic adoption, ecosystem detection, copy engine or background replenishment is included. Inspection/editor opening and Terminal integration belong to their own work orders. Shared writable dependency symlinks between active assignments are prohibited. Project commands supply ecosystem knowledge and validate/refresh retained `.env` without logging secrets.

### Reuse evidence and decision

Research checked 2026-10-17; release dates are evidence of maintenance, not tested compatibility guarantees.

- **Worktrunk — selected for existing lifecycle hooks and optional discovery.** [Hooks](https://worktrunk.dev/hook/) expose foreground execution; background completion alone cannot prove readiness. Use an explicitly approved foreground Project readiness command; do not reproduce its hook scheduler. [JSON discovery](https://worktrunk.dev/list/) has versioned output: integration must pin/probe the supported schema and reject unknown shapes. [v0.80.0, released 2026-09-27](https://github.com/max-sixty/worktrunk/releases/tag/v0.80.0) establishes active maintenance. Hooks and discovery do not establish roundup's durable exclusive Agent ownership, so thin assignment glue remains necessary. Worktrunk's copy-ignored recipe is not selected for the fast path: it materializes ignored files per new directory.
- **Claude Code — reuse its hooks when users already employ them; do not enable nested `--worktree` for an Agent already assigned a directory.** [WorktreeCreate/WorktreeRemove](https://code.claude.com/docs/en/hooks#worktreecreate) permit replacing creation and controlling cleanup; the create hook returns a path. They do not by themselves coordinate roundup's stored Agent ownership and Landing. [v2.1.302, released 2026-10-16](https://github.com/anthropics/claude-code/releases/tag/v2.1.302) establishes maintenance. A vendor-specific path can be explicitly enrolled only if its owner has relinquished it and it meets the same guards. Do not rewrite global vendor settings or let vendor exit cleanup delete a leased directory.
- **Codex — reuse long-lived environments and Project setup commands where applicable.** Official [worktrees documentation](https://developers.openai.com/codex/app/worktrees/) describes permanent worktrees and managed worktrees; permanent ones are not automatically deleted, while managed ones can be detached. [Local environments](https://developers.openai.com/codex/app/local-environments/) document creation-time setup in the desktop app, not a generic CLI warm-assignment API. These are not evidence that launching the CLI from roundup performs desktop setup. [rust-v0.163.0, released 2026-10-15](https://github.com/openai/codex/releases/tag/rust-v0.163.0) establishes maintenance. Reuse the Project command rather than parsing/reimplementing desktop configuration.
- **Orca/APFS — reference, not selected.** [Worktree model](https://github.com/stablyai/orca/blob/main/docs/site/content/docs/model/worktrees.mdx) documents APFS clone-copy or symlinks for shared paths, linked shared directories, and literal ignored-path copying through `.worktreeinclude`; the repository was unarchived and pushed 2026-10-17. Clones still create per-directory filesystem entries; no cited evidence establishes Defender's scan behavior. Shared writable links weaken isolation, and Python environments may embed absolute paths. Do not implement Orca's materialization engine or a new `.worktreeinclude` parser. Existing tools or an explicit Project setup command may prepare small local files before enrollment; never bulk-copy dependency roots at launch. Retained `.env` must be validated/refreshed by the Project command without logging secret contents.


### Delivery and observation

Implemented in `crates/agents` (`prepared.rs`, `worktree_prepared.rs`, `project.setPrepared`, `project.getPrepared`, `project.prepareDirectory`); the observer's procedure is `docs/prepared-observer.md`.

[G2542a–G2542e](../scenarios/worktrees.md#prepared-directories-specification-implementation-pending) name the planned tests and observer. Independent Node, Rust and Python fixtures must run real ecosystem smoke tests; Python includes an absolute-path environment executable. All retain ignored dependency and local configuration paths with identical device/inode and bytes across assignments.

After preparation and Daemon startup, use two directories with at least 10,000 ignored dependency files each for twenty sequential assignments and releases at the same target commit. Measure start request through the launched smoke process's first success; nearest-rank p95 (nineteenth sorted time) is at most 5,000 ms. Record every time, OS/filesystem/tools, counts and file identities. Observe processes and filesystem operations: installer calls and creates/writes/renames/unlinks under dependency roots are zero during each assignment. Inode comparison alone is insufficient. Run Node, Rust and Python smoke commands. The implementation must supply Linux automation and the same reproducible procedure on a managed Mac with Defender enabled.

Linux success establishes reuse, not managed-Mac latency. Record Mac results separately; missing evidence leaves the Defender claim unverified without blocking Linux delivery. Never claim clones bypass scanning or request exclusions or disabled protection.
