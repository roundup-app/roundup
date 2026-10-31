//! One declaration supplies the method table, owning module router, TS bindings and MCP exposure.
use crate::describe::{Declared, role_summary, schema_of};
#[cfg(feature = "export")]
use crate::methods::Method;
use crate::methods::{ExportedMethod, typed};

/// F8, M16: the Bubble rule every Terminal-starting tool's description states, as the Brief does.
#[macro_export]
macro_rules! bubble_rule {
    () => {
        " Use your own tools for commands; open a Bubble only when the user needs to see its output or will interactively type into it. Routine builds, tests and inspection use your own tools."
    };
}

macro_rules! declarations {
    ($d:tt; $($owner:ident [$namespace:literal] { $($wire:literal: $params:ty => $result:ty, $handler:ident, $role:ident($($tool:tt)*);)* })*) => {
        #[cfg(feature = "export")]
        pub const METHODS: &[Method<'static>] = &[$($(Method {name: $wire, params: stringify!($params), result: stringify!($result)},)*)*];
        pub fn owner_namespace(method: &str) -> Option<&'static str> {
            match method { $($($wire => Some($namespace),)*)* _ => None }
        }
        pub(crate) fn exported() -> Vec<ExportedMethod> { vec![$($(typed::<$params, $result>($wire),)*)*] }
        pub(crate) fn declared() -> Vec<Declared> {
            vec![$($(Declared { name: $wire, tool_summary: role_summary!($role($($tool)*)), params: schema_of::<$params>, result: schema_of::<$result>, },)*)*]
        }
        pub(crate) fn types() -> specta::Types { specta::Types::default() $($(.register::<$params>().register::<$result>())*)* }
        $(
            #[macro_export]
            macro_rules! $owner {
                ($d($d callback:ident)::+, $d($d args:tt)*) => {
                    $d($d callback)::+! { [$d($d args)*] $($wire: $params => $result, $handler, $role($($tool)*);)* }
                };
            }
        )*
        #[macro_export]
        macro_rules! all_methods {
            ($d($d callback:ident)::+) => {
                $d($d callback)::+! { [] $($($wire: $params => $result, $handler, $role($($tool)*);)*)* }
            };
        }
    };
}

declarations! { $;
    agents_methods["agent"] {
        "terminal.open": contracts::terminal::OpenParams => contracts::terminal::Opened, rpc_terminal_open, all(schema(contracts::terminal::OpenParams,concat!(
                "Start a login shell in a Terminal owned by a Workstream that is yours or in your Reach; `workstream` is required for Agents. The answer holds its `terminal_id`.",
                bubble_rule!()
            )));
        "agent.spawn": contracts::agent::SpawnParams => contracts::agent::RailNode, rpc_agent_spawn, all(custom(agent_spawn()));
        "agent.extras": () => contracts::agent::Extras, rpc_agent_extras, door(custom(agent_extras()));
        "agent.extras_add": contracts::agent::ExtrasAddParams => contracts::agent::RailNode, rpc_agent_extras_add, door(custom(agent_extras_add()));
        "agent.stop": contracts::agent::NodeId => (), rpc_agent_stop, all(schema(contracts::agent::NodeId,"Stop an Agent in your Reach, never yourself."));
        "agent.prompt": contracts::agent::PromptParams => (), rpc_agent_prompt, all(schema(contracts::agent::PromptParams,"Send a prompt to an Agent in your Reach as the user would."));
        "agent.interrupt": contracts::agent::NodeId => (), rpc_agent_interrupt, all(schema(contracts::agent::NodeId,"Interrupt the turn of an Agent in your Reach."));
        "agent.worktreeState": contracts::agent::NodeId => contracts::agent::WorktreeState, rpc_agent_worktree_state, all(schema(contracts::agent::NodeId,"Read what a Worktree holds: its changes and whether it can land. Yours or one in your Reach."));
        "agent.changedFiles": contracts::agent::NodeId => contracts::agent::ChangedFiles, rpc_agent_changed_files, none();
        "agent.compareFile": contracts::agent::CompareFileParams => contracts::agent::FileComparison, rpc_agent_compare_file, none();
        "agent.land": contracts::agent::NodeId => contracts::agent::Landed, rpc_agent_land, all(schema(contracts::agent::NodeId,"Land the Worktree of an Agent in your Reach on the Base branch."));
        "agent.discard": contracts::agent::NodeId => (), rpc_agent_discard, all(schema(contracts::agent::NodeId,"Discard the Worktree of an Agent in your Reach and its changes."));
        "agent.spawnPrompt": contracts::agent::NodeId => contracts::agent::SpawnPrompt, rpc_agent_spawn_prompt, none();
        "agent.setOrder": contracts::agent::SetOrderParams => contracts::agent::RailNode, rpc_agent_set_order, all(custom(agent_set_order()));
        "agent.instructions": contracts::agent::NodeId => contracts::agent::Instructions, rpc_agent_instructions, all(schema(contracts::agent::NodeId,"Read exact instruction revisions and Attempt-bound delivery facts for yourself or an Agent in your Reach. Reading sends nothing; submission never proves completion of work."));
        "agent.channelUp": contracts::agent::NodeId => (), rpc_agent_channel_up, none();
        "agent.signal": contracts::agent::SignalParams => Option<contracts::agent::SignalOutcome>, rpc_agent_signal, none();
        "rail.tree": () => Vec<contracts::agent::RailNode>, rpc_rail_tree, all(empty("Read the Rail: every Workstream, Agent and Terminal with its Status."));
        "rail.list": () => Vec<contracts::agent::RailNode>, rpc_rail_tree, none();
        "workstream.setAuto": contracts::workstream::AutoParams => (), rpc_workstream_set_auto, none();
        "workstream.setOpeningPrompt": contracts::workstream::OpeningPromptParams => (), rpc_workstream_set_opening_prompt, none();
        "rail.createWorkstream": contracts::agent::CreateWorkstreamParams => contracts::agent::RailNode, rpc_rail_create_workstream, all(schema(contracts::agent::CreateWorkstreamParams,"Make a Workstream at the Project root, with `parent` null. Start its Door next with `rail_startDoor`. Workstreams never nest."));
        "rail.move": contracts::agent::MoveParams => (), rpc_rail_move, all(schema(contracts::agent::MoveParams,"Move a node in your Reach: an Agent under a Workstream or Agent, a Workstream only to the root."));
        "rail.rename": contracts::agent::RenameParams => contracts::agent::RailNode, rpc_rail_rename, all(schema(contracts::agent::RenameParams,"Rename yourself or a node in your Reach."));
        "rail.startDoor": contracts::agent::StartDoorParams => contracts::agent::RailNode, rpc_rail_start_door, all(schema(contracts::agent::NodeId,"Start the Door of a Workstream you made, or of one in your Reach. It asks the user what the Workstream is for."));
        "agent.run": contracts::agent::RunParams => contracts::terminal::Opened, rpc_agent_run, all(custom(agent_run()));
        "project.setWorktrees": contracts::project::Worktrees => (), rpc_project_set_worktrees, all(schema(contracts::project::Worktrees,"Turn Worktrees on or off for the Project and set the command Landing runs."));
        "project.setMcp": contracts::project::Mcp => (), rpc_project_set_mcp, none();
        "project.setPrepared": contracts::project::Prepared => (), rpc_project_set_prepared, none();
        "project.getPrepared": () => contracts::project::Prepared, rpc_project_get_prepared, none();
        "project.importDiscover": contracts::project::ImportDiscoverParams => contracts::project::ImportDiscovery, rpc_project_import_discover, none();
        "import.list": contracts::project::ImportListParams => contracts::project::ImportList, rpc_import_list, all(schema(contracts::project::ImportListParams,"Read-only: list this Project's saved and live top-level Claude Code sessions active in the period, once each, with the revision to approve. Starts no import and spends no Model turn."));
        "project.importCommit": contracts::project::ImportCommitParams => contracts::project::ImportResult, rpc_project_import_commit, none();
        "project.prepareDirectory": contracts::project::PrepareParams => (), rpc_project_prepare_directory, none();
        "project.get": () => contracts::project::ProjectSettings, rpc_project_get, all(empty("Read the Project's settings."));
        "project.setModels": contracts::project::ProjectModels => (), rpc_project_set_models, none();
        "models.list": () => contracts::project::ModelList, rpc_models_list, none();
        "project.open": contracts::project::OpenParams => (), rpc_project_open, all(schema(contracts::project::OpenParams,"Ask the App to open the Project at an absolute folder path. The answer means asked, not done."));
        "project.rename": contracts::project::RenameParams => (), rpc_project_rename, all(schema(contracts::project::RenameParams,"Ask the App to give this Project a name of 1 to 40 characters. The answer means asked, not done."));
        "rail.remove": contracts::agent::RemoveParams => Option<contracts::agent::Removal>, rpc_rail_remove, all(schema(contracts::agent::RemoveParams,"Remove a node in your Reach, never yourself. Workstream scope this (default) keeps unfinished work; all stops and removes its contents. All is only valid for a Workstream and cannot retain an operation."));
        "agent.resume": contracts::agent::ResumeParams => contracts::agent::RailNode, rpc_agent_resume, all(schema(contracts::agent::ResumeParams,"Continue a saved conversation in your Reach. An explicit normal or yolo mode stops a running Agent or Door first; omitted mode requires an exited Agent."));
        "agent.setModel": contracts::agent::SetModelParams => contracts::agent::RailNode, rpc_agent_set_model, none();
    }
    todos_methods["todo"] {
        "todo.create": contracts::todo::CreateParams => contracts::todo::Todo, rpc_todo_create, all(schema(contracts::todo::CreateParams,"Create a Todo. Optional priority: low, medium, high or urgent; omitted/null is unset."));
        "todo.get": contracts::todo::TodoId => contracts::todo::Todo, rpc_todo_get, all(schema(contracts::todo::TodoId,"Read one Todo."));
        "todo.listHanded": () => Vec<contracts::todo::Handed>, rpc_todo_list_handed, none();
        "todo.getHistory": contracts::todo::TodoId => contracts::todo::History, rpc_todo_get_history, none();
        "todo.readHistory": contracts::todo::ReadHistoryParams => (), rpc_todo_read_history, none();
        "todo.list": () => Vec<contracts::todo::Todo>, rpc_todo_list, all(empty("List every Todo."));
        "todo.update": contracts::todo::UpdateParams => contracts::todo::Todo, rpc_todo_update, all(schema(contracts::todo::UpdateParams,"Change a Todo's title, body or priority. Priority: low, medium, high or urgent; omitted preserves it, null clears it."));
        "todo.complete": contracts::todo::TodoId => contracts::todo::Todo, rpc_todo_complete, all(schema(contracts::todo::TodoId,"Mark a Todo done."));
        "todo.reopen": contracts::todo::TodoId => contracts::todo::Todo, rpc_todo_reopen, all(schema(contracts::todo::TodoId,"Reopen a done Todo."));
        "todo.setBlockers": contracts::todo::SetBlockersParams => contracts::todo::Todo, rpc_todo_set_blockers, all(schema(contracts::todo::SetBlockersParams,"Replace a Todo's whole blocker list."));
        "todo.assign": contracts::todo::AssignParams => contracts::todo::Todo, rpc_todo_assign, all(schema(contracts::todo::AssignParams,"Assign a Todo to an owner, or leave it unassigned."));
        "todo.hand": contracts::todo::HandParams => Option<contracts::todo::Todo>, rpc_todo_hand, none();
        "todo.move": contracts::todo::MoveParams => contracts::todo::Todo, rpc_todo_move, all(schema(contracts::todo::MoveParams,"Move a Todo into a Workstream, or out of every Workstream with a null `home`."));
        "todo.reorder": contracts::todo::ReorderParams => contracts::todo::Todo, rpc_todo_reorder, all(schema(contracts::todo::ReorderParams,"Put a Todo before another in the Todo order, or last with a null `before`."));
        "todo.delete": contracts::todo::DeleteParams => contracts::todo::Deletion, rpc_todo_delete, all(schema(contracts::todo::DeleteParams,"Delete exactly the chosen Todo ids. Capture an operation key before calling; retry the same key and ids after an unknown reply."));
        "todo.deletion": contracts::todo::DeletionParams => Option<contracts::todo::Deletion>, rpc_todo_deletion, none();
        "todo.redo": contracts::todo::RedoParams => contracts::todo::Deletion, rpc_todo_redo, none();
        "todo.restore": contracts::todo::DeletionParams => contracts::todo::Deletion, rpc_todo_restore, none();
        "todo.comment": contracts::todo::CommentParams => contracts::todo::Comment, rpc_todo_comment, all(schema(contracts::todo::CommentParams,"Leave a comment on a Todo only when the user must read it, such as a question or a blocker. Write one short plain line, at most 280 characters; it shows in the user's Inbox until they open the Todo. Never report progress or results here."));
        "todo.comments": contracts::todo::TodoId => Vec<contracts::todo::Comment>, rpc_todo_comments, all(schema(contracts::todo::TodoId,"Read a Todo comment thread oldest first, including authors and user replies. Reading does not mark comments read."));
        "todo.unread": () => Vec<contracts::todo::UnreadComment>, rpc_todo_unread, none();
        "todo.markCommentsRead": contracts::todo::TodoId => (), rpc_todo_mark_comments_read, none();
        "todo.addRef": contracts::todo::RefParams => contracts::todo::Todo, rpc_todo_add_ref, all(schema(contracts::todo::RefParams,"Point the user to a Pad or one section of it from a Todo, so they open it from the Todo and read it. Pass the link `roundup://pad/<name>?project=<key>`; a section link ends in `#<heading>`, the heading's text percent-encoded. The Pad and heading must exist. Adding the same link twice keeps one."));
        "todo.removeRef": contracts::todo::RefParams => contracts::todo::Todo, rpc_todo_remove_ref, all(schema(contracts::todo::RefParams,"Remove a Pad or Pad-section link from a Todo, by the same link you added; removing one the Todo lacks changes nothing."));
    }
    pads_methods["pad"] {
        "pad.create": contracts::pad::CreateParams => contracts::pad::Pad, rpc_pad_create, all(schema(contracts::pad::CreateParams,"Create a shared Pad."));
        "pad.read": contracts::pad::PadName => contracts::pad::Pad, rpc_pad_read, all(schema(contracts::pad::PadName,"Read one Pad."));
        "pad.list": () => Vec<contracts::pad::Pad>, rpc_pad_list, all(empty("List every Pad."));
        "pad.rename": contracts::pad::RenameParams => contracts::pad::Pad, rpc_pad_rename, all(schema(contracts::pad::RenameParams,"Rename any Pad, keeping its creation and text. Pass the exact original name and expectedIncarnation from a read in this Project."));
        "pad.write": contracts::pad::WriteParams => contracts::pad::Pad, rpc_pad_write, all(schema(contracts::pad::WriteParams,"Rewrite a Pad's whole text. Optional expectedRevision refuses a stale write with CONFLICT."));
        "pad.append": contracts::pad::AppendParams => contracts::pad::Pad, rpc_pad_append, all(schema(contracts::pad::AppendParams,"Add text to the end of any Pad."));
        "pad.appendSection": contracts::pad::AppendSectionParams => contracts::pad::Pad, rpc_pad_append_section, all(schema(contracts::pad::AppendSectionParams,"Add text at the end of the section under a Markdown heading of any Pad; the heading ignores case and extra whitespace. Pass expectedRevision (from a read) to refuse if the Pad changed since."));
        "pad.reorder": contracts::pad::ReorderParams => contracts::pad::Pad, rpc_pad_reorder, none();
        "pad.move": contracts::pad::MoveParams => contracts::pad::Pad, rpc_pad_move, all(schema(contracts::pad::MoveParams,"Move a Pad to a Workstream or the Project root."));
        "pad.delete": contracts::pad::DeleteParams => contracts::pad::Deletion, rpc_pad_delete, all(schema(contracts::pad::DeleteParams,"Delete a Pad, retaining its original creation for restoration."));
        "pad.redoDelete": contracts::pad::RedoDeleteParams => contracts::pad::Deletion, rpc_pad_redo_delete, all(schema(contracts::pad::RedoDeleteParams,"Redo a restored Pad deletion with an acknowledged creation, Revision and Home; retain the current authoritative state for Undo."));
        "pad.getDeletion": contracts::pad::GetDeletionParams => contracts::pad::Deletion, rpc_pad_get_deletion, all(schema(contracts::pad::GetDeletionParams,"Reconcile an unknown Pad deletion on its originating Project."));
        "pad.restore": contracts::pad::DeletionId => contracts::pad::Deletion, rpc_pad_restore, all(schema(contracts::pad::DeletionId,"Restore your retained Pad deletion once, without replaying external effects."));
        "pad.export": contracts::pad::ExportParams => (), rpc_pad_export, all(schema(contracts::pad::ExportParams,"Write a Pad's text to a file at an absolute path."));
        "pad.setStorage": contracts::pad::SetStorageParams => (), rpc_pad_set_storage, all(schema(contracts::pad::SetStorageParams,"Choose whether the Project mirrors its Pads to files."));
    }
    messages_methods["message"] {
        "message.send": contracts::message::SendParams => contracts::message::Message, rpc_message_send, all(schema(contracts::message::SendParams,"Send a note or a question to an Agent or the user. You are the sender."));
        "message.get": contracts::message::MessageId => contracts::message::Message, rpc_message_get, all(schema(contracts::message::MessageId,"Read one Message you sent or received."));
        "message.list": contracts::message::ListParams => Vec<contracts::message::Message>, rpc_message_list, all(schema(contracts::message::ListParams,"List the Messages you sent or received, newest last."));
        "message.drop": contracts::message::MessageId => contracts::message::Message, rpc_message_drop, none();
        "route.set": contracts::message::SetRouteParams => contracts::message::Route, rpc_route_set, all(schema(contracts::message::SetRouteParams,"Set where one Agent's Messages to another go: `auto` or `drop`. Both must be you or in your Reach; never a Route to yourself, and never over a Route the user set."));
        "route.list": () => Vec<contracts::message::Route>, rpc_route_list, all(empty("List the Routes: who each Agent's questions go to."));
    }
    terminal_methods["terminal"] {
        "terminal.spawn": contracts::terminal::SpawnParams => contracts::terminal::TerminalId, rpc_terminal_spawn, all(schema(contracts::terminal::SpawnParams,concat!(
                "Start a program in a Terminal owned by you; the answer holds its `id`. At most 8 per owner.",
                bubble_rule!()
            )));
        "terminal.close": contracts::terminal::TerminalId => (), rpc_terminal_close, all(schema(contracts::terminal::TerminalId,"Stop a Terminal you or your Reach own and forget it."));
        "terminal.write": contracts::terminal::WriteParams => (), rpc_terminal_write, all(schema(contracts::terminal::WriteParams,"Type base64 `data` into a Terminal you or your Reach own. To prompt, interrupt or stop an Agent, use `agent_prompt`, `agent_interrupt` or `agent_stop`; type keystrokes only when no direct tool does."));
        "terminal.resize": contracts::terminal::ResizeParams => (), rpc_terminal_resize, all(schema(contracts::terminal::ResizeParams,"Resize a Terminal you or your Reach own to `cols` by `rows`."));
        "terminal.kill": contracts::terminal::TerminalId => (), rpc_terminal_kill, all(schema(contracts::terminal::TerminalId,"Stop the program of a Terminal you or your Reach own."));
        "terminal.measure": contracts::terminal::MeasureParams => contracts::terminal::Measurement, rpc_terminal_measure, none();
        "terminal.scheme": contracts::terminal::SchemeParams => (), rpc_terminal_scheme, none();
        "terminal.show": contracts::terminal::TerminalId => (), rpc_terminal_show, door(custom(terminal_show()));
        "terminal.list": () => Vec<contracts::terminal::TerminalInfo>, rpc_terminal_list, none();
        "terminal.catchUp": contracts::terminal::CatchUpParams => contracts::terminal::CatchUp, rpc_terminal_catch_up, none();
        "terminal.snapshot": contracts::terminal::TerminalId => contracts::terminal::Snapshot, rpc_terminal_snapshot, none();
        "terminal.screen": contracts::terminal::TerminalId => contracts::terminal::Screen, rpc_terminal_screen, all(schema(contracts::terminal::TerminalId,"Read a Terminal's screen as it is now, as plain text, with the `offset` to read from next. Only the Terminals of your Runs and your Workstream."));
        "terminal.read": contracts::terminal::ReadParams => contracts::terminal::Read, rpc_terminal_read, all(custom(terminal_read()));
        "terminal.search": contracts::terminal::SearchParams => contracts::terminal::Search, rpc_terminal_search, all(schema(contracts::terminal::SearchParams,"Search a Terminal's output for a regular expression and get the matching lines with their offsets. At most 50 matches a call."));
    }
    asks_methods["ask"] {
        "ask.send": contracts::ask::SendParams => contracts::ask::Ask, rpc_ask_send, none();
        "ask.list": () => Vec<contracts::ask::Ask>, rpc_ask_list, none();
        "ask.pick": contracts::ask::PickParams => contracts::ask::Ask, rpc_ask_pick, none();
    }
    daemon_methods["daemon"] {
        "daemon.getNaming": () => contracts::project::NamingSettings, rpc_naming, none();
        "daemon.setNaming": contracts::project::NamingSettings => (), rpc_naming, none();
        "rail.deletion": contracts::agent::DeletionParams => Option<contracts::agent::Removal>, rail_deletion_call, none();
        "rail.redo": contracts::agent::RedoParams => contracts::agent::Removal, rail_redo_call, none();
        "rail.restore": contracts::agent::DeletionParams => contracts::agent::Removal, rail_deletion_call, none();
        "deliverable.publish": contracts::deliverable::PublishParams => contracts::deliverable::Deliverable, deliverable_call, all(schema(contracts::deliverable::PublishParams,"Deliberately publish a file, expected Pad incarnation and Revision or current external URL. Replay the same key and request after an unknown reply; conflicting replay refuses."));
        "deliverable.list": contracts::deliverable::ListParams => Vec<contracts::deliverable::Deliverable>, deliverable_call, all(schema(contracts::deliverable::ListParams,"List published results without reading retained payloads."));
        "deliverable.get": contracts::deliverable::DeliverableId => contracts::deliverable::Deliverable, deliverable_call, all(schema(contracts::deliverable::DeliverableId,"Read publication metadata by its Project and identity."));
        "deliverable.resolve": contracts::deliverable::DeliverableId => contracts::deliverable::Resolution, deliverable_call, all(schema(contracts::deliverable::DeliverableId,"Resolve the recorded revision or exact current external target, or its unavailability cause."));
        "deliverable.move": contracts::deliverable::MoveParams => contracts::deliverable::Deliverable, deliverable_call, all(schema(contracts::deliverable::MoveParams,"Move a published result; an Agent cannot override user placement."));
        "deliverable.remove": contracts::deliverable::DeliverableId => (), deliverable_call, all(schema(contracts::deliverable::DeliverableId,"Explicitly remove a publication. User only; the identity and key cannot be reused."));
        "daemon.ping": () => contracts::common::Ping, rpc_builtin, none();
        "daemon.methods": () => Vec<String>, rpc_builtin, none();
        "api.list": () => contracts::describe::MethodList, rpc_builtin, all(empty("List every method the Daemon serves with a one-line summary."));
        "api.describe": contracts::describe::DescribeParams => contracts::describe::MethodDescription, rpc_builtin, all(schema(contracts::describe::DescribeParams,"Describe one method: its summary, params and result schemas and an example."));
        "link.read": contracts::link::LinkUrl => contracts::link::LinkContent, rpc_link_read, all(schema(contracts::link::LinkUrl,"Read a Project roundup:// link: current Pad, Todo, Agent, Workstream or Terminal content, or a Deliverable recorded revision/current external target and its availability."));
        "daemon.identify": contracts::common::IdentifyParams => (), rpc_builtin, none();
        "events.subscribe": Option<contracts::common::SubscribeParams> => contracts::common::SubscribeResult, rpc_builtin, all(custom(events_stream()));
        "provenance.history": contracts::common::HistoryParams => Vec<contracts::common::Touch>, rpc_builtin, all(schema(contracts::HistoryParams,"List the Touches on one item, such as `todo:3` or `rail:5`."));
        "provenance.touched": contracts::common::TouchedParams => Vec<contracts::common::Touch>, rpc_builtin, all(schema(contracts::TouchedParams,"List the Touches one Actor made."));
        "terminal.output": contracts::terminal::TerminalId => contracts::terminal::OutputStarted, terminal_output, none();
        "terminal.outputStop": contracts::terminal::TerminalId => (), terminal_output, none();
        "todo.refs": contracts::todo::TodoId => Vec<contracts::todo::Ref>, rpc_todo_refs, none();
        "agent.context": contracts::agent::NodeId => contracts::agent::Context, awareness, all(custom(agent_context()));
        "agent.brief": contracts::agent::NodeId => contracts::agent::Brief, awareness, none();
        "agent.skills": contracts::agent::NodeId => contracts::agent::Skills, rpc_agent_skills, none();
        "agent.digest": contracts::agent::NodeId => contracts::agent::Digest, rpc_agent_digest, door(custom(agent_digest()));
        "agent.wake": contracts::agent::WakeParams => contracts::agent::Woken, rpc_agent_wake, all(custom(agent_wake()));
        "reaction.create": contracts::reaction::CreateParams => contracts::reaction::Reaction, reaction_call, all(schema(contracts::reaction::CreateParams,"Save a named instruction that a declared condition (named Agents finished, a PR's checks passed, or one instant) delivers once to a target Agent as a Message. Creates immediately without approval, recording you as the authenticated maker. Needs a nonempty one-line `reason` explaining why it is needed (separate from the delivered instruction), an `operation` retry key, an `expires_at` and a target that is you or in your Reach; the definition is immutable, so to change it stop it and create another. A refusal saves nothing."));
        "reaction.preview": contracts::reaction::PreviewParams => contracts::reaction::Preview, reaction_call, all(schema(contracts::reaction::PreviewParams,"Resolve a date, time and UTC offset to the exact `instant` condition `at` and its UTC instant, before creating a time reaction. Saves nothing."));
        "reaction.list": () => Vec<contracts::reaction::Reaction>, reaction_call, all(empty("List the reactions you authorized."));
        "reaction.get": contracts::reaction::ReactionId => contracts::reaction::Reaction, reaction_call, all(schema(contracts::reaction::ReactionId,"Read one reaction you authorized."));
        "reaction.stop": contracts::reaction::ReactionId => contracts::reaction::Reaction, reaction_call, all(schema(contracts::reaction::ReactionId,"Stop a reaction you authorized; no later firing is accepted."));
        "reaction.run": contracts::reaction::RunParams => contracts::reaction::Reaction, reaction_call, all(schema(contracts::reaction::RunParams,"Spend one remaining firing of a reaction you authorized now, with an `operation` retry key. Refused while the reaction is stopped."));
        "project.resources": () => contracts::project::Resources, rpc_project_resources, none();
        "attachment.save": contracts::attachment::SaveParams => contracts::attachment::Saved, rpc_attachment_save, none();
        "message.progress": contracts::message::ProgressParams => contracts::message::Progress, rpc_evidence, all(schema(contracts::message::ProgressParams,"Inspect retained instructions, reports, acceptance and declared verification without starting work."));
        "message.report": contracts::message::ReportParams => contracts::message::ResultReport, rpc_evidence, all(schema(contracts::message::ReportParams,"Report your own Attempt's result for an exact delivered instruction and published output. This is a claim, not acceptance or verification. Use the same key for retries."));
        "message.acceptResult": contracts::message::AcceptResultParams => contracts::message::ResultAcceptance, rpc_evidence, all(schema(contracts::message::AcceptResultParams,"Record user acceptance of one exact reported result with its evidence; only the user may accept."));
        "message.verifyResult": contracts::message::ResultId => contracts::message::ResultObservation, rpc_evidence, all(schema(contracts::message::ResultId,"Observe a report's declared authoritative condition without a Model call; unavailable or unsupported evidence stays unknown."));
        "message.resolveResult": contracts::message::ResolveResultParams => contracts::message::ResultObservation, rpc_evidence, all(schema(contracts::message::ResolveResultParams,"User only: authorize a read-only authoritative receipt source for an unknown external effect. Exact target/version and fresh source evidence are required; this never repeats the effect."));
        "message.reconcileWork": contracts::message::ProgressParams => contracts::message::Reconciliation, resume_call, all(schema(contracts::message::ProgressParams,"Read which retained work is unfinished, confirmed, pending a check or uncertain, without sending or starting anything."));
        "message.resumeWork": contracts::message::ResumeWorkParams => contracts::message::ResumeWork, resume_call, all(schema(contracts::message::ResumeWorkParams,"User only: resume an Agent's eligible unfinished work with one successor Message. Retry with the same request id after an unknown reply; it never repeats an uncertain external effect, restarts a stopped Agent or starts a program."));
        "workstream.rewind": contracts::workstream::RewindParams => contracts::workstream::Rewind, rpc_rewind, door(custom(workstream_rewind()));
        "workstream.restart": contracts::workstream::RestartParams => contracts::agent::RailNode, rpc_workstream_restart, none();
        "todo.startWorkstream": contracts::workstream::StartWorkstreamParams => contracts::agent::RailNode, rpc_queue, none();
        "workstream.queue": () => contracts::workstream::QueueState, rpc_queue, none();
        "workstream.dequeue": contracts::workstream::QueuedWorkstream => (), rpc_queue, none();
        "workstream.queueMove": contracts::workstream::QueueMoveParams => (), rpc_queue, none();
        "workstream.startNow": contracts::workstream::QueuedWorkstream => contracts::agent::RailNode, rpc_queue, none();
        "project.setWorkstreamCap": contracts::workstream::CapParams => (), rpc_queue, none();
    }
}
