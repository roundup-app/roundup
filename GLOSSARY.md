# roundup

roundup supervises coding Agents in each open Project from a macOS App. Each row names one term: the Code term identifiers, types and RPC methods use (with its code spellings), the User label the App's own words use (`same` = the term itself, `none` = code only) and the Avoid words that no public name may contain outside `crates/agents/src/claude_code/` (`AGENTS.md` rule 6; `—` = none). Definitions live in the scenario that introduces each term; `docs/adr/` holds decisions.

### Code terms and user labels

| Code term | User label | Avoid |
|---|---|---|
| Wall clock (`provenance::now_ms`) | none | — |
| Code term | same | — |
| User label | same | — |
| App copy catalogue (`copy`) | same | — |
| Start Door | Start | — |
| Retry Door | Retry | — |

### Project and its nodes

| Code term | User label | Avoid |
|---|---|---|
| Project | same | — |
| Project name base (`base`, `ProjectsState.base`) | same | — |
| Project data | same | — |
| Engine (`engine`, `ModelList.engines`) | same | — |
| Permission mode (`PermissionMode`, `permissionMode` on launch calls) | same | — |
| Agent | same | bot, worker; and session for an Agent. |
| Terminal | same | process, console |
| Terminal preparation (`TerminalPreparation`, `prepareTerminal`, `prepare`, `bind`) | none | — |
| Terminal dimensions (`cols`, `rows`, `terminal::window`) | same | — |
| Keystroke sample (`KeystrokeSample`) | keystroke sample | — |
| Keystroke measurement (`MeasureParams`, `Measurement`, `terminal.measure`) | keystroke measurement | — |
| Original Terminal program (`TerminalInfo.program_pid`, `Terminals::program_pid`) | none | — |
| Terminal incarnation (`TerminalInfo.incarnation`) | same | — |
| Shell mark | same | shell integration (as a name; it is the means) |
| Turn | command | — |
| ReservedLine | none | — |
| Terminal owner (`terminal::TerminalOwner`, `Terminals::serve_owner`, `Terminals::attach_owner`, `Terminals::with_terminal_owner`, `Terminals::terminal_owners`) | same | — |
| Cached rows (`Connection::with_cached_rows`) | same | — |
| Bubble | same | overlay, popup |
| Bubble focus (`closeFocused`) | none | — |
| Pull | same | summon, fling |
| Run | same | — |
| Show request (`terminal.show`, event `terminal.shown`) | same | — |
| Terminal catch-up (`CatchUpParams`, `CatchUp`, `terminal.catchUp`, `Terminals::catch_up`) | same | — |
| Snapshot | same | — |
| Workstream | same | room, folder |
| Mode | same | — |
| Make a Workstream (`agent.makeWorkstream`, `Agents::make_workstream`) | Make a Workstream | — |
| Save as Mode (`agent.saveAsMode`, `SaveAsModeParams`, `Agents::save_as_mode`) | Save as Mode… | — |
| Auto (`auto`, `AutoParams`, `workstream.setAuto`) | same | — |
| Start choice | same | — |
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
| Digest | same | — |
| Wake request (`agent.wake`) | same | — |
| GitHub tool (`github.prGet`, `github.issueGet`, `github.prSetBody`, `github.prReady`, `github.prAutoMerge`; the Door's tools `github_pr_get`, `github_issue_get`, `github_pr_set_body`, `github_pr_ready`, `github_pr_auto_merge`) | same | — |
| Quiet Digest (`is_quiet_digest`) | same | — |
| Reaction (`reaction.create`, `.list`, `.get`, `.stop`, `.run`; authenticated maker in `actor`, required one-line `reason`) | Reaction | — |
| Reaction observation identity (`ObservationCause`, `ObservationGap`, `ObservationRecovery`, `ObservationHealth`) | same | — |
| Preview (`reaction.preview`) | Time preview | — |
| Firing (a Reaction's `firings`) | same | — |
| Observation (a Reaction's `observation`; `reaction_watch`, `project.db` migration 0010) | same | — |
| Rewind (`workstream.rewind`, `RewindTurn`; the provider's own rewind, M5159b) | same | roll back |
| Block | same | — |
| Rollup | same | — |
| Attempt | same | — |
| Status revision | same | — |
| Finish count (`Status.finished`, `finished`) | same | — |
| Unseen (`unseen`, `UnseenState`) | Unread result | — |
| Resume (`ResumeParams`, `ResumeMode`) | same | — |
| YOLO (`yolo`) | same | — |
| Conversation overview (`ConversationOverview`, `RailNode.overview`) | same | — |
| Conversion offer (`RailNode.can_make_workstream`, `RailNode.can_save_as_mode`) | same | — |
| Import (`project.importDiscover`, `project.importCommit`, `ImportPeriod`, `ImportCandidate`, `ImportSelection`, `ImportResult`) | same | — |
| Vendor listing sidecar (`import.list`, `ImportList`, `ImportListed`, `ImportLive`) | same | — |
| Conversation card (`ConversationCard`, `ConversationOverview.card`) | same | — |
| Worktree | same | — |
| Prepared directory | same | — |
| Worktree state | same | — |
| Changed file | same | — |
| File comparison (`agent.compareFile`, `CompareFileParams`, `FileComparison`, `FileContent`) | same | — |
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
| Window bar | same | — |
| Project tab | same | — |
| Tab mark | same | — |
| Rail (`Rail::name`, `Rail::last_id`, `Agents::rail_name`, `Agents::rail_last_id`, `rail.tree`) | same | — |
| Rail deletion redo (`RedoParams`, `rail.redo`, `Deletion.restoration`, `Agents::redo_reversible_with`, `Agents::acknowledge_restoration_in`, `Todos::redo_workstream_in`, `Pads::redo_workstream_in`) | Redo | — |
| Rail removal operation (`agent::RemoveParams`, `agent::Deletion`, `agent::DeletionParams`, `Removal.deletion`, `rail.remove`, `rail.deletion`, `rail.restore`, `Agents::rail_deletion`, `Agents::remove_reversible_with`, `Agents::restore_reversible_with`, `Agents::restore_reversible_in`) | same | — |
| Remove this (`agent::RemoveScope::This`) | Remove this | — |
| Remove all (`agent::RemoveScope::All`) | Remove all | — |
| Hint line | same | — |
| Shelf | Bench | — |
| Scrim | same | — |
| Resize edge | same | — |
| Inbox | same | — |
| Drawer | same | — |
| Switcher | same | — |
| Help | same | — |
| Todo | same | task, ticket |
| Reopen (`todo.reopen`, `todo_reopen`) | same | — |
| Owner (`owner`, Todos only; Pads use Home) | same | assignee |
| Priority (`Priority`, `priority`) | Priority | — |
| Updated at (`updated_at`) | a Todo's last-change time | — |
| Delegate Board | same | — |
| Busy until | "free now", "busy until <HH:MM>" | — |
| Comment (`todo.comment`, `todo_comment`) | same | — |
| Ref (`todo.addRef`, `todo.removeRef`, `todo.refs`, `refs`) | same | — |
| Sketch | same | — |
| Drawing | same | — |
| Pad source (`PadSource`, `source`) | same | — |
| Pad incarnation (`incarnation`, `expectedIncarnation`, `expected_incarnation`) | same | — |
| Pad rename (`pad.rename`, `RenameParams`, `new_name`, `newName`, `PadRenamed`, `previous_name`) | same | — |
| Pad source state (`PadSourceState`, `source_state`) | same | — |
| Pad deletion (`PadDeletion`) | same | — |
| Pad | same | scratchpad |
| Shortcut file (`ShortcutFileExport`, `shortcuts.export`) | Save to file… | — |
| Editor | same | — |
| Clipboard write (`writeClipboardText`) | same | — |
| Pasted image | same | upload, temp image |
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

**Program status.** What a program in a Terminal reports about itself with OSC 7501 (`scenarios/terminal-program-status.md`): records of a state, a message and a title that the Daemon folds into the Terminal's Status. `blocked` in a report is Kind `needs-you`; Kind `blocked` stays the Daemon's.

**Glyph.** The one ring-fill mark a row shows for its most urgent Kind: `⊗ ◉ ⊖ ◔ ○ ✓`.

### Agents at work

| Code term | User label | Avoid |
|---|---|---|
| Adapter | same | — |
| Signal | same | notification |
| Steer (`PromptError`) | same | inject, nudge |
| First Steer completion (`FirstSteerCompletion`, `Agents::first_steer_completion`) | same | — |
| Interrupt | same | cancel, abort |
| Toast | same | — |
| Alert level (`AlertLevel`, `RailNode.alert_level`, `SetAlertLevelParams`, `rail.setAlertLevel`, `Rail::set_alert_level`) | Alerts: Default, All, Quiet | — |
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
| Skill setup (`Install`, `Plan`, `ItemState`, `Outcome`, `skill.status`, `skill.setup`, `skill.remove`) | teach other sessions | — |
| Brief | same | — |
| Context | same | — |
| Channel | same | — |
| Session restart (`RestartParams`, `SessionRestart`, `workstream.restart`, `Agents::opening_prompt`, `session_restart`, `set_session_restart`) | Restart session | — |
| Mode first prompt (`OpeningPromptParams`, `opening_prompt`, `workstream.setOpeningPrompt`) | First prompt | — |
| Claude inbox (`CoordinationSink`, `with_coordination`, `coordinate`) | same | — |
| Mcp | same | — |
| Tool call | same | — |
| Stray | same | — |
| Shim | same | — |
| Model | same | — |
| Effort | same | — |
| Role | same | — |
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
| Reason | same | — |
| Card | same | popup |
| Markdown | same | — |
| Owner selector (`Owner`) | owner | — |
| Actor | same | — |
| Output stream (`Output`, `OutputStream`, `Terminals::subscribe_output`, `terminal.output`, `terminal.outputStop`, `OutputStarted`, `OutputEvent`, `OutputGap`, `terminal.gap`) | same | — |
| Terminal scheme (`terminal.scheme`, `SchemeParams`, `Scheme`) | same | — |
| RPC output intake (`Client::take_output`, `OutputFrame`) | same | — |
| Event log | same | — |
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
| Daemon | same | — |
| Naming settings (`NamingSettings`, `daemon.getNaming`, `daemon.setNaming`, `automatic_renaming`, `with_automatic_renaming`, `with_naming_guide`, `naming_guide`, `naming_settled`, `naming_settings`) | Automatic renaming, Naming guide | — |
| Link (`link.read`) | same | — |
| Context menu (`show_context_menu`, `MenuItem`, `MenuEntry`, `Item`, `project_kind`, `context_menu`) | same | — |
| openTarget | none | — |
| open_in_editor | none | — |
| Extension | same | — |
| Hook | same | — |
| User action (`UserAction`, `action.userList`, `action.userChanged`) | action | — |
| Extension host (`crates/rupd` `src/extensions/`, `extension.problem`) | none | — |

### Design system

| Code term | User label | Avoid |
|---|---|---|
| Token (`--button-accent-fill`, `--button-key-ink`, `--doodle-line`, `--doodle-patch`, `--doodle-offset`, `--doodle-blend`) | same | — |
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
| Placement call (`PlacementCall`, `Agents::placement_call`) | same | — |
| Deliverable | Made | — |
| Publication target (`PublicationTarget`) | same | — |
| Published target (`PublishedTarget`, `ExternalAvailability`) | same | — |
| Resolution (`Resolution`, `UnavailableCause`) | same | — |
| Result report (`ResultReport`, `ReportParams`, `message.report`) | same | — |
| Result acceptance (`ResultAcceptance`, `AcceptResultParams`, `message.acceptResult`) | same | — |
| Result check (`ResultCheck`, `ResultObservation`, `message.verifyResult`) | same | — |
| Continuation (`ContinuationAction`, `ContinuationChoice`, `Reconciliation`, `ResumeWorkParams`, `message.reconcileWork`, `message.resumeWork`) | same | — |
| Result resolution (`ResultResolution`, `ResultOutcome`, `ResolveResultParams`, `message.resolveResult`) | same | — |
| Progress (`Progress`, `ProgressParams`, `ResultProgress`, `message.progress`) | same | — |
| Collapsible | same | — |
| Project menu (`MenuHints`, `ProjectMenu`, `projectMenu`, `select_project_menu`, `selectProjectMenu`, `onProjectPage`, `projectPageSchema`, `project_menu_hints`) | same | — |
| Exit button (`ExitButton`) | same | — |
| Native question (`NativeQuestion`, `App.ask`, `NativeAlert`, `RemovalQuestion`, `RemovalAnswer`, `App.askRemoval`, `ask_removal`, `removal_alert`) | same | — |
| Shared floating surface (`Dialog`, `--surface`, `--button-neutral`, `--button-accent-ink`, `--radius-pill`) | same | — |
| Import exclusion cause (`ImportExclusionCause`, `ImportExclusion.cause`) | same | — |
| Import failure (`ImportFailure`, `ImportOutcome.error`) | same | — |
| Import disposition (`ImportDisposition`, `outcome`) | same | — |
| Final text (`FinalText`, `FinalTextKind`, `final_text`) | none | — |
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

| Undo refusal (`RpcErrorData::UndoParent`, `UndoIdentity`, `UndoPadName`, `RpcError::undo_parent`, `undo_identity`, `undo_pad_name`) | same | — |

### Pad formatting

| Code term | User label | Avoid |
|---|---|---|
| Pad colour (`padColour`, `padColours`) | Text colour | — |
| Pad highlight (`padHighlight`) | Highlight | — |
| Pad callout (`padCallout`, `calloutKinds`) | Callouts | — |
| Pad format Markdown (`padFormatMarkdown`) | none | — |
| Code colours (`codeColours`, `languages`) | none | — |
| Pad colour Tokens (`--pad-blue`, `--pad-green`, `--pad-purple`, `--pad-highlight`, `--pad-highlight-ink`) | none | — |
