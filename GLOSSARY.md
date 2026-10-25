# roundup terms

roundup supervises coding Agents in each open Project from a macOS App.

Names and App labels use this table (`AGENTS.md` rule 6). Avoid entries govern public names; the only vendor exemption is `crates/agents/src/claude_code/`. Definitions and behavior belong to the introducing scenarios.

| Code term | User label | Avoid |
| --- | --- | --- |
| Code term | Code term | — |
| User label | User label | — |
| App copy catalogue (`copy`) | App copy catalogue | — |
| Project | Project | — |
| Project name base (`base`, `ProjectsState.base`) | Project name base | — |
| Project data | Project data | — |
| Engine (`engine`, `ModelList.engines`) | Engine | — |
| Permission mode (`PermissionMode`, `permissionMode` on launch calls) | Permission mode | — |
| Agent | Agent | bot, worker; and _session_ for an Agent. |
| Terminal | Terminal | process, console |
| Terminal incarnation (`TerminalInfo.incarnation`) | Terminal incarnation | — |
| Shell mark | Shell mark | shell integration (as a name; it is the means) |
| Turn | command | — |
| ReservedLine | none | — |
| Terminal owner (`TerminalOwner`, `TerminalOwners`, `with_terminal_owner`, internal `terminal_owner`) | Terminal owner | — |
| Cached rows (`Connection::with_cached_rows`) | Cached rows | — |
| Bubble | Bubble | overlay, popup |
| Pull | Pull | summon, fling |
| Run | Run | — |
| Show request (`terminal.show`, event `terminal.shown`) | Show request | — |
| Snapshot | Snapshot | — |
| Workstream | Workstream | room, folder |
| Auto (`auto`, `AutoParams`, `workstream.setAuto`) | Auto | — |
| Start choice | Start choice | — |
| Queue | Queue | — |
| Workstream cap | Workstream cap | — |
| Running | Running | — |
| Clear | Clear | — |
| Handoff | summary | — |
| Iteration | Iteration | — |
| Home | Home | — |
| Contract methods (`daemon.methods`) | Contract methods | — |
| Contract fingerprint | Contract fingerprint | — |
| Door | supervisor | meta-agent, parent agent, lead |
| Subagent | Subagent | child agent, sub-agent, meta-agent, parent agent |
| Digest | Digest | — |
| Wake request (`agent.wake`) | Wake request | — |
| Reaction (`reaction.create`, `.list`, `.get`, `.stop`, `.run`) | Reaction | — |
| Preview (`reaction.preview`) | Time preview | — |
| Firing (a Reaction's `firings`) | Firing | — |
| Observation (Reaction) (a Reaction's `observation`; `reaction_watch`, `project.db` migration 0010) | Observation | — |
| Reaction observation identity (`ObservationCause`, `ObservationGap`, `ObservationRecovery`, `ObservationHealth`) | none | — |
| Mark | Mark | — |
| Rewind (`workstream.rewindPlan`, `workstream.rewind`, `workstream.rewound`, `workstream_rewindPlan`, `workstream_rewind`) | Rewind | roll back |
| Checkpoint | Checkpoint | — |
| Block | Block | — |
| Rollup | Rollup | — |
| Attempt | Attempt | — |
| Status revision | Status revision | — |
| Finish count (`Status.finished`); `finished` | Finish count | — |
| Unseen (`unseen`, `UnseenState`); `unseen`, user label: Unread result | Unread result | — |
| Resume (`ResumeParams`, `ResumeMode`) | Resume | — |
| YOLO (`yolo`) | YOLO | — |
| Conversation overview (`ConversationOverview`, `RailNode.overview`) | Conversation overview | — |
| Import (`project.importDiscover`, `project.importCommit`, `ImportPeriod`, `ImportCandidate`, `ImportSelection`, `ImportResult`) | Import | — |
| Vendor listing sidecar (`import.list`, `ImportList`, `ImportListed`, `ImportLive`) | Vendor listing sidecar | — |
| Conversation card (`ConversationCard`, `ConversationOverview.card`) | Conversation card | — |
| Worktree | Worktree | — |
| Prepared directory | Prepared directory | — |
| Worktree state | Worktree state | — |
| Changed file | Changed file | — |
| File comparison (`agent.compareFile`, `CompareFileParams`, `FileComparison`, `FileContent`) | File comparison | — |
| Base | Base | — |
| Resource use | Resource use | — |
| Landing | Landing | — |
| Discard | Discard | — |
| App | App | — |
| App seam | App seam | — |
| App Settings | App Settings | — |
| File drop | File drop | — |
| Message image | Message image | — |
| Window bar | Window bar | — |
| Project tab | Project tab | — |
| Tab mark | Tab mark | — |
| Rail (`Rail::name`, `Agents::rail_name`, `rail.tree`, `rail.list`) | Rail | — |
| Hint line | Hint line | — |
| Shelf | work items | — |
| Scrim | Scrim | — |
| Resize edge | Resize edge | — |
| Inbox | Inbox | — |
| Drawer | Drawer | — |
| Switcher | Switcher | — |
| Help | Help | — |
| Todo | Todo | task, ticket |
| Reopen (`todo.reopen`, `todo_reopen`) | Reopen | — |
| Owner (`owner`) | Owner | assignee |
| Estimate (`estimate_minutes`) | Estimate | — |
| Delegate Board | Delegate Board | — |
| Busy until | free now; busy until <HH:MM> | — |
| Comment (`todo.comment`, `todo_comment`) | Comment | — |
| Ref (`todo.addRef`, `todo.removeRef`, `todo.refs`, `refs`) | Ref | — |
| Sketch | Sketch | — |
| Drawing | Drawing | — |
| Pad source (`PadSource`, `source`) | Pad source | — |
| Pad incarnation (`incarnation`, `expectedIncarnation`, `expected_incarnation`) | Pad incarnation | — |
| Pad source state (`PadSourceState`, `source_state`) | Pad source state | — |
| Pad deletion (`PadDeletion`) | Pad deletion | — |
| Pad | Pad | scratchpad |
| Editor | Editor | — |
| Attachment | Attachment | — |
| Attachment file | Attachment file | upload, temp image |
| Clipboard write (`writeClipboardText`) | Clipboard write | — |
| Pasted image | Pasted image | — |
| Paste placeholder | Paste placeholder | — |
| Quote | Quote | — |
| setWindowTitle | setWindowTitle | — |
| dragWindow | dragWindow | — |
| zoomWindow | zoomWindow | — |
| windowOperations | windowOperations | — |
| windowTitleHandler | windowTitleHandler | — |
| window-bar | window-bar | — |
| Status | Status | — |
| Kind | Kind | — |
| Glyph | Glyph | — |
| Ink | Ink | — |
| Chip | Chip | — |
| Live line | Live line | — |
| Adapter | Adapter | — |
| Observation (Adapter) | Observation | — |
| Signal | Signal | notification |
| Steer (`PromptError`) | Steer | inject, nudge |
| First Steer completion (`FirstSteerCompletion`, `Agents::first_steer_completion`) | First Steer completion | — |
| Interrupt | Interrupt | cancel, abort |
| Toast | Toast | — |
| Work order | Work order | — |
| Instruction (`Instruction`, `InstructionRevision`, `Instructions`, `agent.instructions`, `agent_instructions`) | Instruction | — |
| Instruction delivery (`InstructionDelivery`, `InstructionState`) | Instruction delivery | — |
| Done condition | Done condition | — |
| Captured Order (`CapturedOrder`, `SetOrderParams.captured`) | Captured Order | — |
| Order title | Order title | — |
| Spawn prompt | Spawn prompt | — |
| Clarification order | Clarification order | — |
| Skill | Skill | — |
| Brief | Brief | — |
| Context | Context | — |
| Channel | Channel | — |
| Claude inbox | Claude inbox | — |
| Mcp | Mcp | — |
| Tool call | Tool call | — |
| Stray | Stray | — |
| Shim | Shim | — |
| Model | Model | — |
| Effort | Effort | — |
| Role | Role | — |
| Usage | Usage | — |
| Evaluator | Evaluator | — |
| Thread | Thread | chat, main agent |
| Message | Message | — |
| In-flight record (`message_flight`) | In-flight record | — |
| Restart reservation | Restart reservation | — |
| Retirement reservation | Retirement reservation | — |
| Route | Route | — |
| Draft (`draftStorage`) | Draft | — |
| Reason | Reason | — |
| Card | Card | popup |
| Markdown | Markdown | — |
| Actor | Actor | — |
| Output stream (`Output`, `OutputStream`, `Terminals::subscribe_output`, `terminal.output`, `terminal.outputStop`, `OutputStarted`, `OutputEvent`, `OutputGap`, `terminal.gap`) | Output stream | — |
| Terminal scheme (`terminal.scheme`, `SchemeParams`, `Scheme`) | Terminal scheme | — |
| RPC output intake (`Client::take_output`, `OutputFrame`) | RPC output intake | — |
| Event log | Event log | — |
| Rail rename (`rail.renamed`, `RailRenamed`) | Rail rename | — |
| Event number (`seq`) | Event number | — |
| Event head (`head`) | Event head | — |
| Output log | Output log | — |
| Read cursor (`reader`) | Read cursor | — |
| Reach (`Agents::guard_reach`) | Reach | — |
| project.requested | project.requested | — |
| Touch | Touch | — |
| Provenance | Provenance | — |
| Daemon | Daemon | — |
| Idle evidence (`record_idle_evidence`, `recordIdleEvidence`, `IdleEvidence`) | Idle evidence | — |
| Daemon recovery (`DaemonExited.recovery`, `DaemonExit.recovery`) | Daemon recovery | — |
| RPC error data (`RpcErrorData`) | none | — |
| Link (`link.read`) | Link | — |
| Context menu (`show_context_menu`) | Context menu | — |
| openTarget | openTarget | — |
| open_in_editor | open_in_editor | — |
| Extension | Extension | — |
| Hook | Hook | — |
| Token | Token | — |
| Text selection Token (`--text-selection`, `--text-selection-ink`) | Text selection Token | — |
| Section head | Section head | — |
| Signifier | Signifier | — |
| Button kind | Button kind | — |
| Check | Check | — |
| Held-out screen | Held-out screen | — |
| Work Issue | Work Issue | — |
| Builder | Builder | — |
| Design critic | Design critic | — |
| Screen | Screen | — |
| Code PR | Code PR | — |
| Ready PR | Ready PR | — |
| Build file | Build file | — |
| Loop machinery | Loop machinery | — |
| Capture | Capture | — |
| History (`History`) | History | — |
| Get History (`todo.getHistory`) | Get History | — |
| Values (`Values`) | Values | — |
| Captured Change (`expected_change`) | Captured Change | — |
| Change (`Change`) | Change | — |
| Handed (`Handed`, `todo.listHanded`, `TodosState.handed`) | Handed | — |
| Hand-off (`todo.hand`, `HandParams`) | Hand-off | — |
| Read History (`todo.readHistory`, `ReadHistoryParams`) | Read History | — |
| Tick box (`TickBox`) | Tick box | — |
| Dialog | Dialog | — |
| AlertDialog | AlertDialog | — |
| Menu | Menu | — |
| Tooltip | Tooltip | — |
| Tabs | Tabs | — |
| IconButton | IconButton | — |
| TreeView | TreeView | — |
| Sortable | Sortable | — |
| Sortable drop | Sortable drop | — |
| KeyScope | KeyScope | — |
| registerKeys | registerKeys | — |
| chordsFor | chordsFor | — |
| Leader | Leader | — |
| Ask (`ask::Ask`, `Asks`, `SendParams`, `PickParams`) | Ask | — |
| Ask submission (`AskSubmission`, `submission`) | Ask submission | — |
| Ask outcome (`AskOutcome`) | Ask outcome | — |
| Ask part (`AskPart`, `ask::State`) | Ask part | — |
| Placement (`Placement`, `Destination`, `Target`) | Placement | — |
| Placement request (`placement::Request`, `EarlierAsk`) | Placement request | — |
| Placement call (`PlacementCall`, `Agents::placement_call`) | Placement call | — |
| Deliverable | Made | — |
| Publication target (`PublicationTarget`) | Publication target | — |
| Published target (`PublishedTarget`, `ExternalAvailability`) | Published target | — |
| Resolution (`Resolution`, `UnavailableCause`) | Resolution | — |
| Measurement (`project.measurements`) | Measurement | — |
| Timed activity (`TimedActivity`) | Timed activity | — |
| Startup (`TimedActivity::Startup`) | Startup | — |
| Idle phase (`TimedActivity::Idle`) | Idle phase | — |
| Clock point (`ClockPoint`) | Clock point | — |
| Observed segment (`ObservedSegment`) | Observed segment | — |
| Time state (`TimeState`) | Time state | — |
| Measurement wait (`MeasurementWait`) | Measurement wait | — |
| Result report (`ResultReport`, `ReportParams`, `message.report`) | Result report | — |
| Result acceptance (`ResultAcceptance`, `AcceptResultParams`, `message.acceptResult`) | Result acceptance | — |
| Result check (`ResultCheck`, `ResultObservation`, `message.verifyResult`) | Result check | — |
| Continuation (`ContinuationAction`, `ContinuationChoice`, `Reconciliation`, `ResumeWorkParams`, `message.reconcileWork`, `message.resumeWork`) | Continuation | — |
| Result resolution (`ResultResolution`, `ResultOutcome`, `ResolveResultParams`, `message.resolveResult`) | Result resolution | — |
| Progress (`Progress`, `ProgressParams`, `ResultProgress`, `message.progress`) | Progress | — |
| Measurement summary (`MeasurementSummary`, `MeasurementSummaryParams`, `project.measurementSummary`) | Measurement summary | — |
| Measurement contributor (`MeasurementContributor`) | Measurement contributor | — |
| Measurement time (`MeasurementTime`) | Measurement time | — |
| Collapsible | Collapsible | — |
| Project menu (`ProjectMenu`, `projectMenu`, `select_project_menu`, `selectProjectMenu`, `onProjectPage`, `projectPageSchema`) | Project menu | — |
| Agent time rule (`Kind::counts_time`, generated `countsTime`) | Agent time rule | — |
| Exit button (`ExitButton`) | Exit button | — |
| Native question (`NativeQuestion`, `App.ask`, `NativeAlert`) | Native question | — |
| Shared floating surface (`Dialog`, `--surface`, `--button-neutral`, `--button-accent-ink`, `--radius-pill`) | Shared floating surface | — |
| Pad rename (`pad.rename`, `RenameParams`, `new_name`, `newName`, `PadRenamed`, `previous_name`) | Pad rename | — |
