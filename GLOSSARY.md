# roundup

roundup supervises coding Agents in each open Project from a macOS App. Each row names one term: the Code term identifiers, types and RPC methods use (with its code spellings), the User label the App's own words use (`same` = the term itself, `none` = code only) and the Avoid words that no public name may contain outside `crates/agents/src/claude_code/` (`AGENTS.md` rule 6; `—` = none). Definitions live in the scenario that introduces each term; `docs/adr/` holds decisions.

### Code terms and user labels

| Code term | User label | Avoid |
|---|---|---|
| Wall clock (`provenance::now_ms`) | none | — |
| Handler (`rpc::Handler`, the typed function `dispatch_methods!` calls) | none | — |
| With params (`rpc::WithParams`, marks a Handler that takes the decoded params) | none | — |
| Context only (`rpc::CtxOnly`, marks a Handler of a method with no params) | none | — |
| Declared result (`rpc::Declared`, a type a Handler may return for a declared result, so the wire bytes stay as the answerer sent them) | none | — |
| Code term | same | — |
| User label | same | — |
| App copy catalogue (`copy`) | same | — |
| Start Door | Start | — |
| Retry Door | Retry | — |

### Project and its nodes

| Code term | User label | Avoid |
|---|---|---|
| Project | same | — |
| Project start (`StartParams`, `StartKind`, `StartedRow`, `project.start`, `StartFailed`) | same | — |
| Opened Project (`Opened`, `project.open`, `openRequested`) | same | — |
| Project opening (`createProjectOpening`, `ProjectOpening`, `ProjectRequest`, `Confirmation`) | Open Project | — |
| App registration (`registration`, `action.closed`) | none | — |
| Project name base (`base`, `ProjectsState.base`) | same | — |
| Project data | same | — |
| Fork (`data.fork`, `ForkColour`, `ForkRefused`: a Project the Fork left out, with its refusal, `fork.json`) | same | — |
| Fork list (`fork_list`, `ForkListed`, `collides`: the App seam command and its row for each Fork under `$ROUNDUP_HOME/forks`, with the other App it collides with) | Forks | — |
| Fork rename, Fork recolour (`fork_rename`, `fork_recolour`: App seam commands that rewrite one Fork's `fork.json` and remake its `.app`) | Rename, Recolour | — |
| Channel identity (`contracts::identity`: `ChannelIdentity`, `CHANNELS`, `TakenFork`, the one comparison `same_name` and the refusal text of `data.fork`) | none | — |
| Channel (`Channel`: `Stable`, `Dev`, `Source`; the build an identifier names) | Stable, Dev | — |
| Engine (`engine`, `ModelList.engines`) | same | — |
| Permission mode (`PermissionMode`, `permissionMode` on launch calls) | same | — |
| Agent name (`agent_name`) | same | — |
| Agent | same | bot, worker; and session for an Agent. |
| Terminal | same | process, console |
| Terminal preparation (`TerminalPreparation`, `prepareTerminal`, `prepare`, `bind`) | none | — |
| Terminal labels (`terminal::reconcile::labels`, `Listed`, `Step`, `plan`, `reconcile`, `for_agent`, `Terminals::spawn_labelled`: the Project, Agent and Attempt a Terminal in the core carries, and the steps that make the core's live list match the Agents) | none | — |
| Project program (`ProjectProgram`, `ProgramRun`, `project.setProgram`, `project.clearProgram`, `project.startProgram`, `project.stopProgram`, `project.programRun`: the one outside program a Project names, its `argv`, its `dir` and its `adoptDir`, the folder in which it adopts worktrees with no pick in the App; started in a Terminal by the Daemon) | Program | — |
| Terminal dimensions (`cols`, `rows`, `terminal::window`) | same | — |
| Keystroke sample (`KeystrokeSample`) | keystroke sample | — |
| Keystroke measurement (`MeasureParams`, `Measurement`, `terminal.measure`) | keystroke measurement | — |
| Original Terminal program (`TerminalInfo.program_pid`, `Terminals::program_pid`) | none | — |
| Terminal incarnation (`TerminalInfo.incarnation`) | same | — |
| Shell mark | same | shell integration (as a name; it is the means) |
| Printed command (`PrintedCommands`, `agent.printedCommands`, `agent.runPrinted`, `Terminals::claim_free_shell`: a line of a `sh`, `bash`, `zsh` or `shell` block an Agent printed, read from its conversation record; a click runs one in a shell the Agent owns whose prompt is free) | command | — |
| Turn | command | — |
| FloatingLine (`ink/FloatingLine.tsx`) | none | — |
| Terminal owner (`terminal::TerminalOwner`, `Terminals::serve_owner`, `Terminals::attach_owner`, `Terminals::with_terminal_owner`, `Terminals::terminal_owners`) | same | — |
| Update exit (`exit_for_update`, `updater`, `Offered`) | Update available | — |
| Updates (`updates`, `install_update`, `update_core`, `check_updates`, event `updates-changed`, `Updates`, `core_update`, `roundup:updates-told`: the versions of roundup and herdr-core and which are ready) | Updates | — |
| Cached rows (`Connection::with_cached_rows`) | same | — |
| Bubble | same | overlay, popup |
| Bubble focus (`closeFocused`) | none | — |
| Pull | same | summon, fling |
| Run | same | — |
| Show request (`terminal.show`, event `terminal.shown`) | same | — |
| Terminal catch-up (`CatchUpParams`, `CatchUp`, `terminal.catchUp`, `Terminals::catch_up`) | same | — |
| Snapshot | same | — |
| Workstream | same | room, folder |
| Workstream state (`WorkstreamState`, `RailNode.workstream_state`; apart from the Door's own Status Kind) | same | — |
| Group (`NodeKind::Group`, `GroupParams`, `rail.group`, `Rail::group`) | same | — |
| Mode (`agent.createMode`, `agent.setModePrompt`, `agent.restartMode`, `RailNode.mode_prompt`, `CreateModeParams`, `ModePromptParams`, `ModeRestartParams`, `SpawnRole::Mode`: the `agent.spawn` role that starts a Mode beneath a root Agent) | same | — |
| Handoff (`agent.handoff`, `agent_handoff`, `HandoffParams`, `/handoff`, `Daemon::handoff`, `Agents::start_handoff`, `Agents::end_caller`) | Hand off | — |
| Make a Workstream (`agent.makeWorkstream`, `Agents::make_workstream`) | Make a Workstream | — |
| Save as Mode (`agent.saveAsMode`, `SaveAsModeParams`, `Agents::save_as_mode`) | Save as Mode… | — |
| Auto (`auto`, `AutoParams`, `workstream.setAuto`) | same | — |
| Start choice | same | — |
| Start settings (`SpawnParams.settings`, `start_settings`, `LaunchFacts.start_settings`, `Launcher::save_start_settings`, `Launcher::load_start_settings`: the Claude Code settings a starter sends with `agent.spawn`, kept with the Agent) | none | — |
| Queue | same | — |
| Workstream cap | same | — |
| Running | same | — |
| Home | same | — |
| Contract methods (`daemon.methods`) | same | — |
| Method description (`api.list`, `api.describe`) | same | — |
| Contract declaration (`declarations`, `Method`, `METHODS`, `owner_namespace`, `Metadata`, `metadata`, `McpChoice`, `PerfDisposition`) | same | — |
| Contract export (`export::generate`, `export::types`, `event_data_declaration`) | same | — |
| Contract fingerprint | same | — |
| Door | none | meta-agent, parent agent, lead |
| Subagent | same | child agent, sub-agent, meta-agent, parent agent |
| Job (`SpawnRole::Job`, wire `job`, `SpawnParams.role`, `Rail::role`) | same | — |
| Consult (`SpawnRole::Consult`, wire `consult`) | same | — |
| Open Job (`OpenJob`, `Agents::open_jobs`) | none | — |
| Job stop (`JobStop`, `Agents::idle_stop`) | none | — |
| Stalled | stalled | — |
| Settled note | none | — |
| Digest | same | — |
| Wake request (`agent.wake`) | same | — |
| GitHub tool (`github.prGet`, `github.issueGet`, `github.prSetBody`, `github.prReady`, `github.prAutoMerge`; the Door's tools `github_pr_get`, `github_issue_get`, `github_pr_set_body`, `github_pr_ready`, `github_pr_auto_merge`) | same | — |
| Quiet Digest (`is_quiet_digest`) | same | — |
| Rewind (`workstream.rewind`, `RewindTurn`; the provider's own rewind, M5159b) | same | roll back |
| Block | same | — |
| Rollup | same | — |
| Attempt | same | — |
| Status revision | same | — |
| Ordinal (`Ordinal`; an Attempt or Status revision on the wire: a canonical positive decimal string) | same | — |
| Finish count (`Status.finished`, `finished`) | same | — |
| Unseen (`unseen`, `UnseenState`) | Unread result | — |
| Resume (`ResumeParams`, `ResumeMode`) | same | — |
| Conversation fact (`RailNode.has_conversation`) | same | — |
| Turn resume (`ResumeWait`, `RailNode.resume`) | `resumes 14:05` | — |
| YOLO (`yolo`, `Permission::Bypass`) | same | — |
| Launch facts (`LaunchFacts`, `Permission`; `Request` to the Launcher; `Launch`, `Origin`, `Attach` to a start) | none | — |
| Conversation overview (`ConversationOverview`, `RailNode.overview`) | same | — |
| Conversion offer (`RailNode.can_make_workstream`, `RailNode.can_save_as_mode`) | same | — |
| Import (`project.importDiscover`, `project.importCommit`, `ImportPeriod`, `ImportCandidate`, `ImportSelection`, `ImportResult`) | same | — |
| Vendor listing sidecar (`import.list`, `ImportList`, `ImportListed`, `ImportLive`) | same | — |
| Conversation card (`ConversationCard`, `ConversationOverview.card`) | same | — |
| Worktree | same | — |
| Adopted Worktree (`agent.adopt`, `agent.adoptable`, `Worktree.adopted`) | same | — |
| Prepared directory | same | — |
| Worktree state | same | — |
| Changed file (`ChangedFile`, `ChangedFile.counts`, `ChangedFile.blob`, `LineCounts`) | same | — |
| Owned changes (`agent.ownedChanges`) | same | — |
| Owned group key (`OwnedGroupKey`, the `group` of `agent.compareFile`) | same | — |
| Item note (`ItemNote`, `Item`, `ItemTarget`; the Message entry's `Group:` key names the item) | Note on module, flow or file | — |
| Scan hit (`agent.repeatScan`, `ScanHits`, `ScanHit`, `ScanPlace`) | same | — |
| Moved code (`Moved`, the Changes view's moved and renamed lines; never "Mark", which is a report mark) | Moved from, Renamed | — |
| Compare target (`CompareTarget`, the `to` of `agent.changedFiles` and `agent.compareFile`) | same | — |
| File comparison (`agent.compareFile`, `CompareFileParams`, `FileComparison`, `FileContent`) | same | — |
| Remote main (`agent.remoteMain`, `RemoteMain`) | Remote main | — |
| Fetch (`agent.fetchRemoteMain`, `FetchedMain`) | Fetch | — |
| Base | same | — |
| Resource use | same | — |
| Landing | same | — |
| Discard | same | — |

### The App

| Code term | User label | Avoid |
|---|---|---|
| App | same | — |
| App seam | same | — |
| App Settings | same | — |
| File drop | same | — |
| Feedback report (`feedback.send`, `feedback.check`) | Send feedback… | — |
| Window bar | same | — |
| Project tab | same | — |
| Tab mark | same | — |
| Rail (`Rail::name`, `Rail::last_id`, `Agents::rail_name`, `Agents::rail_last_id`, `rail.tree`) | same | — |
| Rail deletion redo (`RedoParams`, `rail.redo`, `Deletion.restoration`, `Agents::redo_reversible_with`, `Agents::acknowledge_restoration_in`, `Todos::redo_workstream_in`, `Pads::redo_workstream_in`) | Redo | — |
| Rail selection removal (`RemoveSelectionParams`, `rail.removeSelection`, `Removal.selection`, `Todos::retain_workstream_in`) | Remove | — |
| Rail removal operation (`agent::RemoveParams`, `agent::Deletion`, `agent::DeletionParams`, `Removal.deletion`, `rail.remove`, `rail.deletion`, `rail.restore`, `Agents::rail_deletion`, `Agents::remove_reversible_with`, `Agents::restore_reversible_with`, `Agents::restore_reversible_in`) | same | — |
| Pending change (`PendingChange`, `pendingOf`, `keepAsked`; the Rail's layer of them: `Pending`, `shownOver`, `hide`, `draw`, `launch`) | none | — (Drawing is the Pad sketch term; Rail state never names one) |
| Rail strip (`RailStrip`, `Widths.collapsed`, `STRIP_WIDTH`, `--rail-strip-width`) | Collapse the Rail, Expand the Rail | — |
| Remove this (`agent::RemoveScope::This`) | Remove this | — |
| Remove all (`agent::RemoveScope::All`) | Remove all | — |
| Hint line | same | — |
| Shelf | Bench | — |
| Peek (`ShelfFrame.peek`, `ShelfFrame.unpeek`, `ShelfFrame.peeking`, `ShelfFrame.promote`, `createEdgePeek`, `createRailPeek`) | none | — |
| Scrim | same | — |
| Resize edge | same | — |
| Inbox | same | — |
| Drawer | same | — |
| Switcher | same | — |
| Search (`search.find`, `FindParams`, `Found`, `SearchHit`, `SearchKind`, `opens`) | Text matches | — |
| Help | same | — |
| Todo | same | task, ticket |
| Reopen (`todo.reopen`, `todo_reopen`) | same | — |
| Owner (`owner`, Todos only; Pads use Home) | same | assignee |
| Priority (`Priority`, `priority`) | Priority | — |
| Updated at (`updated_at`) | a Todo's last-change time | — |
| PR link (`Todo.pr`) | Pull request | — |
| PR check (`PrCheck`, `todo.checkPr`, `todo.checkPrs`, `todo.prChecked`) | same | — |
| Delegate Board | same | — |
| Busy until | "free now", "busy until <HH:MM>" | — |
| Comment (`todo.comment`, `todo_comment`) | same | — |
| Ref (`todo.addRef`, `todo.removeRef`, `todo.refs`, `refs`) | same | — |
| Sketch | same | — |
| Drawing | same | — |
| Pad visibility (`Pad.visibility`, `pad.setVisibility`, `pad_setVisibility`, `SetVisibilityParams` in `contracts::pad`; the value is a `RailVisibility`) | shown, internal | — |
| Pad source (`PadSource`, `source`) | same | — |
| Pad incarnation (`incarnation`, `expectedIncarnation`, `expected_incarnation`) | same | — |
| Pad rename (`pad.rename`, `RenameParams`, `new_name`, `newName`, `PadRenamed`, `previous_name`) | same | — |
| Pad source state (`PadSourceState`, `source_state`) | same | — |
| Pad deletion (`PadDeletion`) | same | — |
| Pad (`ExportParams.text`, `ExportParams.images`, `ExportImage`) | same | scratchpad |
| Shortcut file (`ShortcutFileExport`, `shortcuts.export`) | Save to file… | — |
| Editor | same | — |
| Clipboard write (`writeClipboardText`) | same | — |
| Pasted image (`savePastedImage`, `saveDroppedImage`) | same | upload, temp image |
| Paste placeholder | same | — |
| Quote | same | — |
| setWindowTitle | none | — |
| dragWindow | none | — |
| zoomWindow | none | — |
| windowOperations | none | — |
| windowTitleHandler | none | — |
| window-bar | none | — |

### Status

| Code term | User label | Avoid |
|---|---|---|
| Status | same | — |
| Kind | same | — |
| Glyph | same | — |
| Ink | same | — |
| Chip | same | — |
| Live line | same | — |
| Program status (`ProgramStatus`, `terminal.status`) | status | — |
| Call path (`CallPaths`, `agent.callPaths`) | Flow | — |
| Language server | — | — |
| Mark done (`markDone`) | — | — |

**Mark done.** The owner clears a `needs-you` Status from the attention lists by choice (`scenarios/mark-done.md`): the same dismissal as U5151c, keyed by Agent id, Attempt and Status revision, so the Agent's next `needs-you` shows again. It sends nothing to the Agent.

**Program status.** What a program in a Terminal reports about itself with OSC 7501 (`scenarios/terminal-program-status.md`): records of a state, a message and a title that the Daemon folds into the Terminal's Status. `blocked` in a report is Kind `needs-you`; Kind `blocked` stays the Daemon's.

**Call path.** The changed functions of an Agent's Worktree and the calls each one added, removed or changed against the remote's main, resolved to real symbols by the project's language server and never by name (`scenarios/call-paths.md`). Its user label is Flow.

**Language server.** The project's own LSP server for one language, started per trace and gone when it ends (`tsc --lsp -stdio` for TypeScript 7 or later); a language with none reads as no server.

**Glyph.** The one ring-fill mark a row shows for its most urgent Kind: `⊗ ◉ ⊖ ◔ ○ ✓`.

### Agents at work

| Code term | User label | Avoid |
|---|---|---|
| Adapter | same | — |
| Signal | same | notification |
| Report id (`report`, `<agent>:<seq>`, `seq::next`) | same | — |
| Mark (`report_marks`, `read_mark`, `write_mark`) | same | — |
| Steer (`PromptError`) | same | inject, nudge |
| First Steer completion (`FirstSteerCompletion`, `Agents::first_steer_completion`) | same | — |
| Interrupt | same | cancel, abort |
| Toast | same | — |
| Held alert (`createHeld`, `ConnectedProject.held`) | held | — |
| Waiting Message (`Message.waiting`, `failure::waiting_reason`) | same | — |
| Alert level (`alertLevel`, `AlertLevel`, `RailNode.alert_level`, `SetAlertLevelParams`, `rail.setAlertLevel`, `Rail::set_alert_level`) | Alerts: Default, All, Quiet | — |
| Project alert level (`ProjectAlerts`, `projectAlerts`, `mayRaise`) | Alerts: All, Needs you only, Off | — |
| State alert (`StateAlert`, `stateAlert`, `state_alert`, `state-alert-clicked`) | same | notification |
| Work order | same | — |
| Instruction (`Instruction`, `InstructionRevision`, `Instructions`, `agent.instructions`, `agent_instructions`) | same | — |
| Instruction delivery (`InstructionDelivery`, `InstructionState`) | same | — |
| Done condition | same | — |
| Captured Order (`CapturedOrder`, `SetOrderParams.captured`) | same | — |
| Order title | same | — |
| Spawn prompt | same | — |
| Clarification order | same | — |
| Skill | same | — |
| Brief | same | — |
| Context | same | — |
| Channel | same | — |
| Session restart (`ModeRestartParams`, `SessionRestart`, `agent.restartMode`, `Agents::mode_prompt`, `session_restart`, `set_session_restart`) | Restart session | — |
| Offshoot (`agent.offshoot`, `Agents::offshoot`, `Origin::Offshoot`, `Rail::place_after`, `Launcher::forking`: a new Agent that continues a stopped Agent's saved conversation under a new session id, placed right after it) | Fork | — |
| Mode first prompt (`ModePromptParams`, `RailNode.mode_prompt`, `agent.setModePrompt`) | First prompt | — |
| Claude inbox (`CoordinationSink`, `with_coordination`, `coordinate`) | same | — |
| Mcp | same | — |
| Tool call | same | — |
| Stray | same | — |
| Waiting count (`RailNode.waiting`, `Messages::waiting_counts`) | `Door stopped · N waiting` | — |
| Unreachable cause (`RailNode.unreachable`, `Messages::delivery_failure`) | `can't reach <Agent>: <cause>` | — |
| Shim | same | — |
| Model | same | — |
| Effort | same | — |
| Role (`Role::ALL`: `door`, `subagent`, `readback`; the kind of Agent roundup starts, which a Project's Model and Effort are set for) | same | — |
| Readback (`ReadbackCall`, `Launcher::readback_call`: one run of a fresh model that reads only what it is handed, with no tools, no session, no Terminal and no Rail row; `agent.readbackStart` starts one on the user's call, `agent.readback` reads its state; may be briefed by one Skill, `ReadbackStartParams::skill`, whose body the Adapter adds as a review lens) | same | — |
| Explanation (`Explanation`: what `agent.explain` answers when the user asks the Readback's reader to explain selected lines of the diff, in words or as a small diagram; the Daemon keeps none, the App keeps it for the session and never sends it to the Agent) | same | — |
| Finding (`Finding`: a defect `agent.findDefects` has the Readback's reader name at new-side lines of the diff, labelled `issue` or `nit`; the user keeps it as a note or drops it, the Daemon keeps none and the App never sends it to the Agent) | same | — |
| Line explanation (`LineExplanation`, `Account::explanations`: one or two sentences of a Readback about new-side lines of one file, with the `source` text they were written against so the App greys them when the file stops reading so; at most twelve, dropped when the diff does not hold them) | Explanation under a line | — |
| Hunk id (`Hunk::id`: `<path>#<n>`, `n` counting that path's hunks from 1 in diff order, as the changes view names them) | same | — |
| Gap (`Gap`: where the diff disagrees with the Agent's last message, with `path`, `quote` and the new-side `line`) | same | — |
| Unplaced (`Account::unplaced`: the hunk ids no flow of a Readback holds, computed by the Daemon) | Unplaced | — |
| Rank (`Rank`, `Account::ranks`: `core`, `forced` or `glue`, one per hunk id, in the model's answer) | Core, Forced, Glue | — |
| Risk (`Risk`, `Account::risks`: `high`, `medium` or `low` with a one-sentence reason, one per flow and per module) | High risk, Medium risk | — |
| Usage | same | — |
| Evaluator | same | — |

### Messages and Cards

| Code term | User label | Avoid |
|---|---|---|
| Thread | same | chat, main agent |
| Message | same | — |
| In-flight record (`message_flight`) | same | — |
| Restart reservation | same | — |
| Retirement reservation | same | — |
| Route | same | — |
| Browser data location (`webview_data_path`) | same | — |
| Saved work (`storedValue`, `storageSchema`, `initializeStorage`, `storageProblems`, `useBrowserStorage`, `storageCopy`) | same | — |
| Draft (`draftStorage`) | Unfinished work | — |
| Module (`changes/modules.ts`: a changed file's directory without trailing source and test segments, read from its path) | Modules | — |
| Lens (`changes/lens.ts`, `Lens`: what the Changes list shows: the flows, every module, the modules' logic only or their tests only) | Flows, Modules, Logic, Tests | — |
| Changes overview (`changes/Overview.tsx`, `OVERVIEW`: the first row and pane of every lens, the lens's modules with their counts; not the Rail's `ConversationOverview`) | Overview | — |
| Viewed mark (`changes/viewed.ts`, `Seen`: the blob a file had when the user marked it viewed, kept for the connection's session and for one comparison; a module is viewed when every file it lists holds its mark) | Viewed | — |
| Reason (`InboxRepeat`: equal to the last entry in the receiving inbox session) | same | — |
| Card | same | popup |
| Markdown | same | — |
| Owner selector (`Owner`) | owner | — |
| Actor | same | — |
| Start attribution (`StartAttribution`, `start_attribution`, `touch_creation`) | started by | — |
| Output stream (`Output`, `OutputStream`, `Terminals::subscribe_output`, `terminal.output`, `terminal.outputStop`, `OutputStarted`, `OutputEvent`, `OutputGap`, `terminal.gap`) | same | — |
| Terminal scheme (`terminal.scheme`, `SchemeParams`, `Scheme`) | same | — |
| RPC output intake (`Client::take_output`, `OutputFrame`) | same | — |
| Event log | same | — |
| Event handler record (`EventHandlers`, `handleEvent`; one handler per Event name) | none | — |
| Kept Events (`SubscribeParams.kept`) | same | — |
| Rail visibility (`RailVisibility`, `SetVisibilityParams`, `agent.setVisibility`, `agent_set_visibility`) | shown, internal | — |
| Rail rename (`rail.renamed`, `RailRenamed`) | same | — |
| Event number (`seq`) | same | — |
| Event head (`head`) | same | — |
| Output log | same | — |
| Read cursor (`reader`) | same | — |
| Reach (`Agents::guard_reach`) | same | — |
| project.requested | none | — |
| Touch | same | — |
| Provenance | same | — |

### Daemon and Extensions

| Code term | User label | Avoid |
|---|---|---|
| Machine (`Machine`, `machine.list`, `machine.add`, `machine.remove`, `machine.update`, `machine.sshHosts`, `MachineList`, a Machine's `outdated`, `project.setMachine`, a Project's, Agent's or Terminal's `machine`, a Machine's `reachable`) | same | — |
| Exec (`herdr::Conn::exec`, `worktree::Machines`) | same | — |
| Bridge (`Bridges`, `bridge::Link`) | same | tunnel |
| Spool (`rup`'s `spool`, `~/.rupq/spool`) | same | — |
| Away (a Machine's `away`) | away | — |
| Daemon | same | — |
| Naming settings (`NamingSettings`, `daemon.getNaming`, `daemon.setNaming`, `automatic_renaming`, `naming_guide`, `naming_settled`, `naming_settings`) | Automatic renaming, Naming guide | — |
| Link (`link.read`) | same | — |
| Walk (`walk` link kind, `Walk`, `walkSteps`) | walk | — |
| Link set (`links::LinkSet`, `LinkEntry`, `LinkKind`, `LinksEvent`, `agent.links`, the `agent.links` event, `LinksModel`, `claude_code::links`) | links (an Agent's header) | — |
| Links header (`LinksHeader`, `links/catalogue`, the fixed catalogue of icons `@json-render/core`'s spec names: `Editor`, `Terminal` and each `LinkKind`) | links (an Agent's header) | — |
| Made list (`links::MadeItem`, `MadeKind`, `MAX_MADE`, `agent.made`, the `agent.made` event, `Pad.creator`, `rupd::made`) | links (an Agent's header) | — |
| Context menu (`show_context_menu`, `MenuItem`, `MenuEntry`, `Item`, `project_kind`, `context_menu`) | same | — |
| openTarget | none | — |
| open_in_editor | none | — |
| Code editor (`codeEditor`, `list_editors`, `EditorChoice`) | Code editor | — |
| Extension | same | — |
| Hook | same | — |
| User action (`UserAction`, `action.userList`, `action.userChanged`) | action | — |
| Extension host (`crates/rupd` `src/extensions/`, `extension.problem`) | none | — |
| Config (`crates/rupd` `src/config.rs`, `config.read`, `config.changed`, `config.problem`, `ConfigState`) | none | — |
| Wiring (`agents::Wiring`, `Naming`, `Delivery`, `Quiet`) | none | — |

### Design system

| Code term | User label | Avoid |
|---|---|---|
| Token (`--button-accent-fill`, `--button-key-ink`, `--doodle-ground`) | same | — |
| Text selection Token (`--text-selection`, `--text-selection-ink`) | same | — |
| Section head | same | — |
| Signifier | same | — |
| Button kind | same | — |
| Check | same | — |
| Held-out screen | same | — |

### The loop

| Code term | User label | Avoid |
|---|---|---|
| Work Issue | same | — |
| Builder | same | — |
| Design critic | same | — |
| Screen | same | — |
| Code PR | same | — |
| Ready PR | same | — |
| Parked PR (`park`, `Parked:`) | same | — |
| Build file | same | — |
| Loop machinery | same | — |
| Capture | same | — |

### Todo history

| Code term | User label | Avoid |
|---|---|---|
| Todo deletion redo (`RedoParams`, `todo.redo`, `Deletion.restoration`) | Redo | — |
| History (`History`) | same | — |
| Get History (`todo.getHistory`) | same | — |
| Values (`Values`) | same | — |
| Captured Change (`expected_change`) | same | — |
| Change (`Change`) | same | — |
| Handed (`Handed`, `todo.listHanded`, `TodosState.handed`) | same | — |
| Hand-off (`todo.hand`, `HandParams`) | same | — |
| Read History (`todo.readHistory`, `ReadHistoryParams`) | same | — |
| Tick box (`TickBox`) | same | — |

### App component layer

| Code term | User label | Avoid |
|---|---|---|
| Dialog | same | — |
| AlertDialog | none | — |
| Menu | same | — |
| Tooltip | same | — |
| Tabs | same | — |
| IconButton | none | — |
| TreeView | none | — |
| Sortable | same | — |
| Sortable drop | same | — |

### Keyboard registration

| Code term | User label | Avoid |
|---|---|---|
| KeyScope (`KeyScope`, `historyRegion`) | none | — |
| registerKeys | none | — |
| chordsFor | none | — |
| Leader | same | — |

### Named actions

| Code term | User label | Avoid |
|---|---|---|
| Named action (`NamedAction`, `ActionName`, `ActionArg`, `runAction`) | action | — |
| Action list (`action.list`, `rup actions`) | actions | — |
| Action run (`action.run`, `rup do`) | do | — |
| Action answerer (`action.serve`) | none | — |
| App closed (`APP_CLOSED`) | none | — |

### Ask placement

| Code term | User label | Avoid |
|---|---|---|
| Ask (`ask::Ask`, `Asks`, `SendParams`, `PickParams`) | same | — |
| Ask submission (`AskSubmission`, `submission`) | same | — |
| Ask outcome (`AskOutcome`) | same | — |
| Ask part (`AskPart`, `ask::State`) | same | — |
| Ask acknowledgement (`AsksState.acknowledged`) | none | — |
| Placement (`Placement`, `Destination`, `Target`) | same | — |
| Placement request (`placement::Request`, `EarlierAsk`) | same | — |
| Placed part (`PlacedPart`, `PlaceParams`, `ProjectTree`, `ask.place`) | same | — |
| Placement call (`PlacementCall`, `Agents::placement_call`) | same | — |
| Deliverable | Made | — |
| Completion (`Completion`, `AgentCompleted`, `agent.completed`, `Agents::turn_identity`) | same | — |
| Publication fact (`DeliverablePublished`, `deliverable.published`) | same | — |
| Publication change (`DeliverableChanged`, `deliverable.changed`) | same | — |
| Publication target (`PublicationTarget`) | same | — |
| Published target (`PublishedTarget`, `ExternalAvailability`) | same | — |
| Resolution (`Resolution`, `UnavailableCause`) | same | — |
| Result report (`ResultReport`, `ReportParams`, `message.report`) | same | — |
| Result confidence (`ResultConfidence`, `ConfidenceLevel`) | same | — |
| Result acceptance (`ResultAcceptance`, `AcceptResultParams`, `message.acceptResult`) | same | — |
| Result check (`ResultCheck`, `ResultObservation`, `message.verifyResult`) | same | — |
| Continuation (`ContinuationAction`, `ContinuationChoice`, `Reconciliation`, `ResumeWorkParams`, `message.reconcileWork`, `message.resumeWork`) | same | — |
| Delivery retry (`message.retryDelivery`) | Retry | — |
| Result resolution (`ResultResolution`, `ResultOutcome`, `ResolveResultParams`, `message.resolveResult`) | same | — |
| Progress (`Progress`, `ProgressParams`, `ResultProgress`, `message.progress`) | same | — |
| Collapsible | same | — |
| Canonical Project path (`canonicalProjectPath`, `canonical_project_path`, `ProjectsState.opened`) | same | — |
| Project menu (`MenuHints`, `ProjectMenu`, `projectMenu`, `select_project_menu`, `selectProjectMenu`, `onProjectPage`, `projectPageSchema`, `project_menu_hints`) | same | — |
| Exit button (`ExitButton`) | same | — |
| Native question (`NativeQuestion`, `App.ask`, `NativeAlert`, `RemovalQuestion`, `RemovalAnswer`, `NativeAnswer`, `suppressible`, `App.askRemoval`, `ask_removal`, `removal_alert`, `ask_question`, `question_alert`) | same | — |
| Shared floating surface (`Dialog`, `--surface`, `--button-neutral`, `--button-accent-ink`, `--radius-pill`) | same | — |
| Import exclusion cause (`ImportExclusionCause`, `ImportExclusion.cause`) | same | — |
| Import failure (`ImportFailure`, `ImportOutcome.error`) | same | — |
| Import disposition (`ImportDisposition`, `outcome`) | same | — |
| Final text (`FinalText`, `FinalTextKind`, `final_text`) | none | — |
| Bounded text (`Text`, `OperationKey`) | same | — |
| Idle evidence (`record_idle_evidence`, `recordIdleEvidence`, `IdleEvidence`) | same | — |
| Daemon recovery (`DaemonExited.recovery`, `DaemonExit.recovery`) | same | — |
| Native integration (`native`, `Preferences`, `Missing`) | same | — |
| Todo deletion (`DeleteParams`, `Deletion`, `DeletionParams`, `DeletionState`, `todo.deletion`, `todo.restore`, `todo.restored`, `deleteTodos`, `Todos::delete_in`, `Todos::restore_with`) | same | — |
| RPC error data (`RpcErrorData`) | same | — |
| Thrown outcome (`outcomeOf`) | same | — |

### Pad restoration

| Code term | User label | Avoid |
|---|---|---|
| Storage recovery (`StorageRecovery`, `storageRecovery`, `retainedStorage`) | same | — |
| Project schema crate (`storage`, `storage::connect`, `storage::fixture`, `Word`, `Json`) | none | — |
| Capture panel (`CapturePanel`, `CapturePanelState`, `register_capture`) | same | — |
| Capture presentation (`CapturePort`, `CaptureState`, `CaptureAction`, `captureStateSchema`, `captureActionSchema`, `CapturePanel` in the App, `control` in the capture-panel plugin) | same | — |
| Native material (`Material`, `native_material`, `followMaterial`, `watch_transparency`, `--material-tint`) | same | — |
| Native open (`NativeOpen`, `nativeOpenSchema`, `onNativeOpen`, `nativeOpen`, `native_open`) | same | — |
| Pad deletion operation (`DeleteParams`, `Deletion`, `DeletionId`, `GetDeletionParams`, `pad.delete`, `pad.getDeletion`, `pad.restore`, `pads::retain`, `pads::restore`) | Delete, Undo | — (not a name: same-name recreation) |
| Pad deletion redo (`RedoDeleteParams`, `restoredOperation`, `restored_operation`, `expectedHome`, `expected_home`, `pad.redoDelete`) | Redo Delete Pad | — |
| Pad order (`pad.reorder`, `pad::ReorderParams`) | same | — |

### First-run facts

| Code term | User label | Avoid |
|---|---|---|
| Recent Projects (`recent_projects`, `recentProjects`) | Recent folders | — |
| Claude binary (`claude_binary`, `claudeBinary`, `ClaudeBinary`, `claudeBinarySchema`) | claude | — |
| Project task (`project_task`, `supervise`, `Supervisor`, `Command`, `Access`, `Attachment`, `Pump`) | none | — |
| Open cause (`OpenCause`, `User`, `Restore`) | none | — |

| Undo refusal (`RpcErrorData::UndoParent`, `UndoIdentity`, `UndoPadName`, `RpcError::undo_parent`, `undo_identity`, `undo_pad_name`) | same | — |
| Undo history (`createUndo`, `ProjectDrafts.undo`, `state/undo.ts`: the per-Project stack of removals the App can undo and redo) | Undo, Redo | — |

| Menu-bar mark (`MenuBar`, `MenuBarAction`, `menuBarActionSchema`, `setMenuBar`, `onMenuBarAction`, `watchMenuBar`, `showWindow`, `menu_bar`, `set_menu_bar`, `menu-bar-action`) | same | — |

| Dock menu (`DockMenu`) | same | — |

### Pad formatting

| Code term | User label | Avoid |
|---|---|---|
| Pad colour (`padColour`, `padColours`) | Text colour | — |
| Pad highlight (`padHighlight`) | Highlight | — |
| Pad callout (`padCallout`, `calloutKinds`) | Callouts | — |
| Pad format Markdown (`padFormatMarkdown`) | none | — |
| Code colours (`codeColours`, `languages`) | none | — |
| Pad colour Tokens (`--pad-blue`, `--pad-green`, `--pad-amber`, `--pad-purple`, `--pad-highlight`, `--pad-highlight-ink`) | none | — |
