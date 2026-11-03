# U5741 public endpoint census

Historical source and runtime: `e97b71b0cf59d0cab56543d192c9ecf148f56fa7` (`runtime-provenance.json` field in [catalogues/public-seams.json](catalogues/public-seams.json)). Both binaries were rebuilt here; no vendor Agent was started. A real isolated Daemon stored one unstarted Workstream to exercise the Door role. The non-Door id is classified by the production `is_door` lookup, not a fabricated role reply.

Correction from retained raw replies: this historical capture has 163 `api list` results, 85 non-Door tools and 92 Door tools. The original 169/91/98 headline was incorrect; the original replies remain in `catalogues/public-seams.json`. See the fresh [public command reconciliation](public-commands.md) for current counts and exact mappings. All captured methods match their declarations, with no unmatched method. Every declared CLI offer is present in observed `rup help`. Both real stdio `tools/list` replies, including exact input schemas and descriptions, are retained in `mcp-agent.json` and `mcp-door.json`.

| Offer | Count |
| --- | ---: |
| Non-Door Agent tools | 85 |
| Door tools | 92 |
| Both roles | 82 |

Door-only: `agent_digest`, `agent_extras`, `agent_extras_add`, `github_issue_get`, `github_pr_auto_merge`, `github_pr_get`, `github_pr_ready`, `github_pr_set_body`, `terminal_show`, `workstream_rewind`.

Non-Door-only: `agent_run`, `terminal_open`, `terminal_spawn`.

The Door omits Terminal-starting tools under M16. CLI includes them: CLI dispatch is not the Door MCP filter. `events.subscribe` is CLI-only streaming (`rup events`), deliberately absent from both tool lists. `—` means not offered in that column. Deliberately unoffered methods retain their exact reason in `rpc-declarations.json`; app-native commands are separately listed in `app-seam-commands.json` and M5's `NO_TOOL` table. This census is entry-point evidence, not a completed candidate assessment.

| Method | CLI command | Agent MCP tool | Door MCP tool | Input type |
| --- | --- | --- | --- | --- |
| `terminal.open` | `rup terminal open` | `terminal_open` | — | `contracts::terminal::OpenParams` |
| `agent.spawn` | `rup agent spawn` | `agent_spawn` | `agent_spawn` | `contracts::agent::SpawnParams` |
| `agent.extras` | `rup agent extras` | — | `agent_extras` | `()` |
| `agent.extras_add` | `rup agent extras-add` | — | `agent_extras_add` | `contracts::agent::ExtrasAddParams` |
| `agent.stop` | `rup agent stop` | `agent_stop` | `agent_stop` | `contracts::agent::NodeId` |
| `agent.prompt` | `rup agent prompt` | `agent_prompt` | `agent_prompt` | `contracts::agent::PromptParams` |
| `agent.interrupt` | `rup agent interrupt` | `agent_interrupt` | `agent_interrupt` | `contracts::agent::NodeId` |
| `agent.worktreeState` | `rup agent worktree-state` | `agent_worktreeState` | `agent_worktreeState` | `contracts::agent::NodeId` |
| `agent.changedFiles` | — | — | — | `contracts::agent::NodeId` |
| `agent.compareFile` | — | — | — | `contracts::agent::CompareFileParams` |
| `agent.land` | `rup agent land` | `agent_land` | `agent_land` | `contracts::agent::NodeId` |
| `agent.discard` | `rup agent discard` | `agent_discard` | `agent_discard` | `contracts::agent::NodeId` |
| `agent.spawnPrompt` | — | — | — | `contracts::agent::NodeId` |
| `agent.setOrder` | `rup agent set-order` | `agent_set_order` | `agent_set_order` | `contracts::agent::SetOrderParams` |
| `agent.instructions` | `rup agent instructions` | `agent_instructions` | `agent_instructions` | `contracts::agent::NodeId` |
| `agent.channelUp` | — | — | — | `contracts::agent::NodeId` |
| `agent.signal` | — | — | — | `contracts::agent::SignalParams` |
| `rail.tree` | `rup rail tree` | `rail_tree` | `rail_tree` | `()` |
| `workstream.setAuto` | — | — | — | `contracts::workstream::AutoParams` |
| `workstream.setOpeningPrompt` | — | — | — | `contracts::workstream::OpeningPromptParams` |
| `rail.createWorkstream` | `rup rail create-workstream` | `rail_createWorkstream` | `rail_createWorkstream` | `contracts::agent::CreateWorkstreamParams` |
| `rail.move` | `rup rail move` | `rail_move` | `rail_move` | `contracts::agent::MoveParams` |
| `rail.rename` | `rup rail rename` | `rail_rename` | `rail_rename` | `contracts::agent::RenameParams` |
| `rail.startDoor` | `rup rail start-door` | `rail_startDoor` | `rail_startDoor` | `contracts::agent::StartDoorParams` |
| `agent.run` | `rup agent run` | `agent_run` | — | `contracts::agent::RunParams` |
| `project.setWorktrees` | `rup project set-worktrees` | `project_setWorktrees` | `project_setWorktrees` | `contracts::project::Worktrees` |
| `project.setMcp` | — | — | — | `contracts::project::Mcp` |
| `project.setPrepared` | — | — | — | `contracts::project::Prepared` |
| `project.getPrepared` | — | — | — | `()` |
| `project.importDiscover` | — | — | — | `contracts::project::ImportDiscoverParams` |
| `import.list` | `rup import list` | `import_list` | `import_list` | `contracts::project::ImportListParams` |
| `project.importCommit` | — | — | — | `contracts::project::ImportCommitParams` |
| `project.prepareDirectory` | — | — | — | `contracts::project::PrepareParams` |
| `project.get` | `rup project get` | `project_get` | `project_get` | `()` |
| `project.setModels` | — | — | — | `contracts::project::ProjectModels` |
| `models.list` | — | — | — | `()` |
| `project.open` | `rup project open` | `project_open` | `project_open` | `contracts::project::OpenParams` |
| `project.rename` | `rup project rename` | `project_rename` | `project_rename` | `contracts::project::RenameParams` |
| `rail.remove` | `rup rail remove` | `rail_remove` | `rail_remove` | `contracts::agent::RemoveParams` |
| `agent.resume` | `rup agent resume` | `agent_resume` | `agent_resume` | `contracts::agent::ResumeParams` |
| `agent.makeWorkstream` | — | — | — | `contracts::agent::NodeId` |
| `agent.saveAsMode` | — | — | — | `contracts::agent::SaveAsModeParams` |
| `rail.setAlertLevel` | — | — | — | `contracts::agent::SetAlertLevelParams` |
| `agent.setModel` | — | — | — | `contracts::agent::SetModelParams` |
| `todo.create` | `rup todo create` | `todo_create` | `todo_create` | `contracts::todo::CreateParams` |
| `todo.get` | `rup todo get` | `todo_get` | `todo_get` | `contracts::todo::TodoId` |
| `todo.listHanded` | — | — | — | `()` |
| `todo.getHistory` | — | — | — | `contracts::todo::TodoId` |
| `todo.readHistory` | — | — | — | `contracts::todo::ReadHistoryParams` |
| `todo.list` | `rup todo list` | `todo_list` | `todo_list` | `()` |
| `todo.update` | `rup todo update` | `todo_update` | `todo_update` | `contracts::todo::UpdateParams` |
| `todo.complete` | `rup todo complete` | `todo_complete` | `todo_complete` | `contracts::todo::TodoId` |
| `todo.reopen` | `rup todo reopen` | `todo_reopen` | `todo_reopen` | `contracts::todo::TodoId` |
| `todo.setBlockers` | `rup todo set-blockers` | `todo_setBlockers` | `todo_setBlockers` | `contracts::todo::SetBlockersParams` |
| `todo.assign` | `rup todo assign` | `todo_assign` | `todo_assign` | `contracts::todo::AssignParams` |
| `todo.hand` | — | — | — | `contracts::todo::HandParams` |
| `todo.move` | `rup todo move` | `todo_move` | `todo_move` | `contracts::todo::MoveParams` |
| `todo.reorder` | `rup todo reorder` | `todo_reorder` | `todo_reorder` | `contracts::todo::ReorderParams` |
| `todo.delete` | `rup todo delete` | `todo_delete` | `todo_delete` | `contracts::todo::DeleteParams` |
| `todo.deletion` | — | — | — | `contracts::todo::DeletionParams` |
| `todo.redo` | — | — | — | `contracts::todo::RedoParams` |
| `todo.restore` | — | — | — | `contracts::todo::DeletionParams` |
| `todo.comment` | `rup todo comment` | `todo_comment` | `todo_comment` | `contracts::todo::CommentParams` |
| `todo.comments` | `rup todo comments` | `todo_comments` | `todo_comments` | `contracts::todo::TodoId` |
| `todo.unread` | — | — | — | `()` |
| `todo.markCommentsRead` | — | — | — | `contracts::todo::TodoId` |
| `todo.addRef` | `rup todo ref add` | `todo_addRef` | `todo_addRef` | `contracts::todo::RefParams` |
| `todo.removeRef` | `rup todo ref remove` | `todo_removeRef` | `todo_removeRef` | `contracts::todo::RefParams` |
| `pad.create` | `rup pad create` | `pad_create` | `pad_create` | `contracts::pad::CreateParams` |
| `pad.read` | `rup pad read` | `pad_read` | `pad_read` | `contracts::pad::PadName` |
| `pad.list` | `rup pad list` | `pad_list` | `pad_list` | `()` |
| `pad.rename` | `rup pad rename` | `pad_rename` | `pad_rename` | `contracts::pad::RenameParams` |
| `pad.write` | `rup pad write` | `pad_write` | `pad_write` | `contracts::pad::WriteParams` |
| `pad.append` | `rup pad append` | `pad_append` | `pad_append` | `contracts::pad::AppendParams` |
| `pad.appendSection` | `rup pad append-section` | `pad_appendSection` | `pad_appendSection` | `contracts::pad::AppendSectionParams` |
| `pad.reorder` | — | — | — | `contracts::pad::ReorderParams` |
| `pad.move` | `rup pad move` | `pad_move` | `pad_move` | `contracts::pad::MoveParams` |
| `pad.delete` | `rup pad delete` | `pad_delete` | `pad_delete` | `contracts::pad::DeleteParams` |
| `pad.redoDelete` | `rup pad redo-delete` | `pad_redoDelete` | `pad_redoDelete` | `contracts::pad::RedoDeleteParams` |
| `pad.getDeletion` | `rup pad get-deletion` | `pad_getDeletion` | `pad_getDeletion` | `contracts::pad::GetDeletionParams` |
| `pad.restore` | `rup pad restore` | `pad_restore` | `pad_restore` | `contracts::pad::DeletionId` |
| `pad.export` | `rup pad export` | `pad_export` | `pad_export` | `contracts::pad::ExportParams` |
| `pad.setStorage` | `rup pad set-storage` | `pad_setStorage` | `pad_setStorage` | `contracts::pad::SetStorageParams` |
| `message.send` | `rup message send` | `message_send` | `message_send` | `contracts::message::SendParams` |
| `message.get` | `rup message get` | `message_get` | `message_get` | `contracts::message::MessageId` |
| `message.list` | `rup message list` | `message_list` | `message_list` | `contracts::message::ListParams` |
| `message.drop` | — | — | — | `contracts::message::MessageId` |
| `route.set` | `rup route set` | `route_set` | `route_set` | `contracts::message::SetRouteParams` |
| `route.list` | `rup route list` | `route_list` | `route_list` | `()` |
| `terminal.spawn` | `rup terminal spawn` | `terminal_spawn` | — | `contracts::terminal::SpawnParams` |
| `terminal.close` | `rup terminal close` | `terminal_close` | `terminal_close` | `contracts::terminal::TerminalId` |
| `terminal.write` | `rup terminal write` | `terminal_write` | `terminal_write` | `contracts::terminal::WriteParams` |
| `terminal.resize` | `rup terminal resize` | `terminal_resize` | `terminal_resize` | `contracts::terminal::ResizeParams` |
| `terminal.kill` | `rup terminal kill` | `terminal_kill` | `terminal_kill` | `contracts::terminal::TerminalId` |
| `terminal.measure` | — | — | — | `contracts::terminal::MeasureParams` |
| `terminal.scheme` | — | — | — | `contracts::terminal::SchemeParams` |
| `terminal.show` | `rup terminal show` | — | `terminal_show` | `contracts::terminal::TerminalId` |
| `terminal.list` | — | — | — | `()` |
| `terminal.catchUp` | — | — | — | `contracts::terminal::CatchUpParams` |
| `terminal.snapshot` | — | — | — | `contracts::terminal::TerminalId` |
| `terminal.screen` | `rup terminal screen` | `terminal_screen` | `terminal_screen` | `contracts::terminal::TerminalId` |
| `terminal.read` | `rup terminal read` | `terminal_read` | `terminal_read` | `contracts::terminal::ReadParams` |
| `terminal.search` | `rup terminal search` | `terminal_search` | `terminal_search` | `contracts::terminal::SearchParams` |
| `ask.send` | — | — | — | `contracts::ask::SendParams` |
| `ask.list` | — | — | — | `()` |
| `ask.pick` | — | — | — | `contracts::ask::PickParams` |
| `daemon.getNaming` | — | — | — | `()` |
| `daemon.setNaming` | — | — | — | `contracts::project::NamingSettings` |
| `skill.status` | — | — | — | `()` |
| `skill.setup` | — | — | — | `()` |
| `skill.remove` | — | — | — | `()` |
| `rail.deletion` | — | — | — | `contracts::agent::DeletionParams` |
| `rail.redo` | — | — | — | `contracts::agent::RedoParams` |
| `rail.restore` | — | — | — | `contracts::agent::DeletionParams` |
| `deliverable.publish` | `rup deliverable publish` | `deliverable_publish` | `deliverable_publish` | `contracts::deliverable::PublishParams` |
| `deliverable.list` | `rup deliverable list` | `deliverable_list` | `deliverable_list` | `contracts::deliverable::ListParams` |
| `deliverable.get` | `rup deliverable get` | `deliverable_get` | `deliverable_get` | `contracts::deliverable::DeliverableId` |
| `deliverable.resolve` | `rup deliverable resolve` | `deliverable_resolve` | `deliverable_resolve` | `contracts::deliverable::DeliverableId` |
| `deliverable.move` | `rup deliverable move` | `deliverable_move` | `deliverable_move` | `contracts::deliverable::MoveParams` |
| `deliverable.remove` | `rup deliverable remove` | `deliverable_remove` | `deliverable_remove` | `contracts::deliverable::DeliverableId` |
| `github.prGet` | `rup github pr-get` | — | `github_pr_get` | `contracts::github::Number` |
| `github.issueGet` | `rup github issue-get` | — | `github_issue_get` | `contracts::github::Number` |
| `github.prSetBody` | `rup github pr-set-body` | — | `github_pr_set_body` | `contracts::github::SetBodyParams` |
| `github.prReady` | `rup github pr-ready` | — | `github_pr_ready` | `contracts::github::Number` |
| `github.prAutoMerge` | `rup github pr-auto-merge` | — | `github_pr_auto_merge` | `contracts::github::Number` |
| `action.serve` | — | — | — | `()` |
| `action.list` | — | — | — | `()` |
| `action.userList` | — | — | — | `()` |
| `action.run` | — | — | — | `contracts::action::RunParams` |
| `daemon.ping` | — | — | — | `()` |
| `daemon.methods` | — | — | — | `()` |
| `api.list` | `rup api list` | `api_list` | `api_list` | `()` |
| `api.describe` | `rup api describe` | `api_describe` | `api_describe` | `contracts::describe::DescribeParams` |
| `link.read` | `rup link read` | `link_read` | `link_read` | `contracts::link::LinkUrl` |
| `shortcuts.export` | — | — | — | `contracts::link::ShortcutFileExport` |
| `daemon.identify` | — | — | — | `contracts::common::IdentifyParams` |
| `events.subscribe` | `rup events` | — | — | `Option<contracts::common::SubscribeParams>` |
| `provenance.history` | `rup provenance history` | `provenance_history` | `provenance_history` | `contracts::common::HistoryParams` |
| `provenance.touched` | `rup provenance touched` | `provenance_touched` | `provenance_touched` | `contracts::common::TouchedParams` |
| `terminal.output` | — | — | — | `contracts::terminal::TerminalId` |
| `terminal.outputStop` | — | — | — | `contracts::terminal::TerminalId` |
| `todo.refs` | — | — | — | `contracts::todo::TodoId` |
| `agent.context` | `rup agent context` | `agent_context` | `agent_context` | `contracts::agent::NodeId` |
| `agent.brief` | — | — | — | `contracts::agent::NodeId` |
| `agent.skills` | — | — | — | `contracts::agent::NodeId` |
| `agent.digest` | `rup agent digest` | — | `agent_digest` | `contracts::agent::NodeId` |
| `agent.wake` | `rup agent wake` | `agent_wake` | `agent_wake` | `contracts::agent::WakeParams` |
| `project.resources` | — | — | — | `()` |
| `message.progress` | `rup message progress` | `message_progress` | `message_progress` | `contracts::message::ProgressParams` |
| `message.report` | `rup message report` | `message_report` | `message_report` | `contracts::message::ReportParams` |
| `message.acceptResult` | `rup message accept-result` | `message_acceptResult` | `message_acceptResult` | `contracts::message::AcceptResultParams` |
| `message.verifyResult` | `rup message verify-result` | `message_verifyResult` | `message_verifyResult` | `contracts::message::ResultId` |
| `message.resolveResult` | `rup message resolve-result` | `message_resolveResult` | `message_resolveResult` | `contracts::message::ResolveResultParams` |
| `message.reconcileWork` | `rup message reconcile-work` | `message_reconcileWork` | `message_reconcileWork` | `contracts::message::ProgressParams` |
| `message.resumeWork` | `rup message resume-work` | `message_resumeWork` | `message_resumeWork` | `contracts::message::ResumeWorkParams` |
| `workstream.rewind` | `rup workstream rewind` | — | `workstream_rewind` | `contracts::workstream::RewindParams` |
| `workstream.restart` | — | — | — | `contracts::workstream::RestartParams` |
| `todo.startWorkstream` | — | — | — | `contracts::workstream::StartWorkstreamParams` |
| `workstream.queue` | — | — | — | `()` |
| `workstream.dequeue` | — | — | — | `contracts::workstream::QueuedWorkstream` |
| `workstream.queueMove` | — | — | — | `contracts::workstream::QueueMoveParams` |
| `workstream.startNow` | — | — | — | `contracts::workstream::QueuedWorkstream` |
| `project.setWorkstreamCap` | — | — | — | `contracts::workstream::CapParams` |

## Explicit CLI dispatch

These commands bypass the shared method-to-command catalogue. Their production owner is `crates/rup/src/main.rs::main`, plus `skill::run` and `cli::actions::command`.

| Invocation | Role / result |
| --- | --- |
| `rup`, `rup help`, `rup -h`, `rup --help`, `rup help <noun> [verb]` | Help/discovery; no Agent required. |
| `rup ping` | Daemon connectivity; optional `--as ext:<name>` and `--json`. |
| `rup mcp [agent-id]` | stdio protocol; absent id uses actor; Agent and Extension id cannot combine. |
| `rup signal <agent-id>` | Agent hook consumes stdin, no `--as`; repeat-delivery refusal can exit 2. |
| `rup context <agent-id>` | Agent hook, no `--as`; context for caller. |
| `rup claude-memory <root> <cwd>` | Internal memory hook consumes stdin; intentionally absent from general help. |
| `rup skill setup [--dry-run] [--force] [--json]` | Installs only on request; does not require Daemon or Agent. |
| `rup skill status [--json]` | Inspects installation. |
| `rup skill remove [--dry-run] [--json]` | Removes only owned installation. |
| `rup skill report --state <state> [--kind <kind>] [--where]` | Internal OSC hook; always exits 0, no-op inside roundup Agent. |
| `rup actions [--json]` | `action.list`; requires answering open App, not MCP-offered. |
| `rup do <name> [key=value]...` | `action.run`; registered target/availability and authority still apply. |

`rup help skill`, `rup actions --help` and `rup do --help` output is retained. Global `--as ext:<name>` and `--json` restrictions are in `main`; shared CLI `--agent`/`ROUNDUP_AGENT` resolution and Door-only refusal are in `cli.rs`. No usage telemetry is inferred.


## Current public offer reconciliation

[public-commands.md](public-commands.md) pins main `0ff0b698e2cc3768a6ae316b9f829e52b20808f7`; [catalogues/public-current.json](catalogues/public-current.json) retains every current method/handler/type/role and exact CLI/tool spelling, full API descriptions, schemas, 98 leaf help results and both runtime role lists. Current counts are 167 methods, 86 Agent tools, 94 Door tools. Four methods were added, none removed against the retained historical replies. Static/actual reconciliation has no unmatched command or tool; independent Q1/Q2/Q3 decisions for every method remain unfinished. RC01–RC23 assess explicit command, discovery, stream, named-action and hook controls without authorizing deletion.
