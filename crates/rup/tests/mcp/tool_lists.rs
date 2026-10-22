//! M5: which methods have a tool for every Agent, for a Door only, or none, with the reason.

use std::path::Path;
/// M5: the methods with a tool for every Agent, each named after its method with the dot replaced
/// by `_`, bar `agent.setOrder` (O4), whose tool is `agent_set_order`.
pub const TOOL_METHODS: [&str; 88] = [
    "agent.wake",
    "reaction.create",
    "reaction.preview",
    "reaction.list",
    "reaction.get",
    "reaction.stop",
    "reaction.run",
    "deliverable.publish",
    "deliverable.list",
    "deliverable.get",
    "deliverable.resolve",
    "deliverable.move",
    "deliverable.remove",
    "todo.create",
    "todo.comment",
    "todo.get",
    "todo.list",
    "todo.update",
    "todo.complete",
    "todo.reopen",
    "todo.setBlockers",
    "todo.move",
    "todo.reorder",
    "todo.delete",
    "pad.create",
    "pad.read",
    "link.read",
    "pad.list",
    "pad.write",
    "pad.append",
    "pad.appendSection",
    "pad.setOwner",
    "pad.delete",
    "pad.export",
    "pad.setStorage",
    // B12
    "message.progress",
    "message.report",
    "message.acceptResult",
    "message.verifyResult",
    "message.resolveResult",
    "message.reconcileWork",
    "message.resumeWork",
    "message.send",
    "message.get",
    "message.list",
    "message.pass",
    "route.list",
    // M10
    "checkpoint.list",
    // E2, O4, F3
    "agent.context",
    "agent.instructions",
    "agent.actionHistory",
    "agent.setOrder",
    "agent.run",
    "agent.spawn",
    // H21
    "decision.list",
    "decision.answer",
    // M6, M7
    "rail.tree",
    "rail.createWorkstream",
    "rail.startDoor",
    "rail.rename",
    "rail.move",
    "rail.remove",
    "agent.stop",
    "agent.interrupt",
    "agent.prompt",
    "agent.resume",
    "agent.discard",
    "agent.land",
    "agent.worktreeState",
    "project.get",
    "project.measurements",
    "project.measurementSummary",
    "project.setWorktrees",
    "provenance.history",
    "provenance.touched",
    // M8: the App commands `open_project` and `rename_project`
    "project.open",
    "project.rename",
    // M13: reading a Terminal
    "terminal.screen",
    "terminal.read",
    "terminal.search",
    // M14: Routes and running Terminals
    "route.set",
    "terminal.spawn",
    "terminal.open",
    "terminal.close",
    "terminal.write",
    "terminal.resize",
    "terminal.resizeHistory",
    "terminal.kill",
];

/// M5: offered to a Door only (B20, M10).
pub const DOOR_METHODS: [&str; 8] = [
    "agent.digest",
    // LC7, LC8
    "agent.extras",
    "agent.extras_add",
    // B53
    "terminal.show",
    "checkpoint.write",
    "workstream.handoff",
    "workstream.rewindPlan",
    "workstream.rewind",
];

/// M5: the methods and App commands with no tool; the reasons are in `scenarios/mcp.md`.
pub const NO_TOOL: [&str; 60] = [
    // U2539b, U2540a: the App's Worktree comparison; an Agent reads its own diff with git.
    "agent.changedFiles",
    "agent.compareFile",
    // A40, P9: each carries a Steer from the user.
    "ask.send",
    "ask.list",
    "ask.pick",
    // U462, T21, T23: the open Drawer fetches and acknowledges History; an Agent only leaves a comment.
    "todo.getHistory",
    "todo.readHistory",
    "todo.comments",
    "todo.unread",
    "todo.markCommentsRead",
    // T17, T25: an Agent cannot assign, and only the Daemon hands a Todo.
    "todo.assign",
    "todo.hand",
    "message.deliver",
    "message.drop",
    "takeover.begin",
    "takeover.end",
    "terminal.list",
    "terminal.snapshot",
    // X14: the App's per-Terminal byte stream; an Agent reads text with `terminal_read`.
    "terminal.output",
    "terminal.outputStop",
    // X17: the App tells the Daemon its colour scheme; no Agent sets it.
    "terminal.scheme",
    "daemon.ping",
    "daemon.identify",
    "events.subscribe",
    "agent.brief",
    "agent.channelUp",
    "agent.signal",
    "agent.permission",
    // B6: the Daemon captures an original prompt when it holds an action.
    "decision.capture",
    // U468: the App reads retained answers for display; Agents act on open Decisions.
    "decision.answers",
    "agent.ask",
    "agent.skills",
    // O8: the App's Drawer reads the prompt an Agent's spawn gave; the spawning Agent wrote it
    "agent.spawnPrompt",
    "pad.move",
    // U419: the bytes of an image the user pasted
    "attachment.save",
    // A36, A37: the user's own settings, which spend the user's usage (P8)
    "models.list",
    "project.setModels",
    // M2219: the user's setting for whether Agents get these tools at all
    "project.setMcp",
    // G2542: enrolling a directory and running its commands is the user's explicit consent
    "project.setPrepared",
    "project.getPrepared",
    "project.prepareDirectory",
    // U2875: only the user imports recent Claude Code conversations
    "project.importDiscover",
    "project.importCommit",
    "agent.setModel",
    // D8: the App's Resource strip
    "project.resources",
    // A32: the user's act of clearing; a Door answers it with `workstream_handoff`
    "workstream.clear",
    "close_project",
    "projects",
    "daemon_proof",
    "open_target",
    "open_in_editor",
    "save_pasted_image",
    // U2694a: the native menu of the user's right-click
    "show_context_menu",
    // U449–U451: the user's native window, which an Agent cannot move or rename.
    "plugin:window-bar|set_window_title",
    "plugin:window-bar|drag_window",
    "plugin:window-bar|zoom_window",
    "rpc",
    "subscribe",
    "terminal_output",
    "terminal_output_stop",
];

pub fn tool_name(method: &str) -> String {
    match method {
        "agent.setOrder" => "agent_set_order".into(),
        other => other.replace('.', "_"),
    }
}

/// The names of the strings inside the first `[...]` after `marker` in `file`.
pub fn quoted_after(file: &str, marker: &str) -> Vec<String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let text = std::fs::read_to_string(root.join(file)).unwrap();
    let start = text
        .find(marker)
        .unwrap_or_else(|| panic!("{marker} in {file}"));
    let open = start + text[start..].find(['[', '{']).unwrap();
    let close = open + text[open..].find([']', '}']).unwrap();
    text[open + 1..close]
        .split(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | ':' | '|' | '-')))
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The seam commands of `apps/desktop/src/app/seam.ts`, and whether `crates/desktop` registers the same.
pub fn seam_commands() -> Vec<String> {
    let table = quoted_after("apps/desktop/src/app/seam.ts", "SEAM_COMMANDS = [");
    let mut registered = quoted_after("crates/desktop/src/lib.rs", "generate_handler![");
    for command in &mut registered {
        if let Some((_, name)) = command.rsplit_once("::") {
            *command = name.to_owned();
        }
    }
    registered.extend(
        quoted_after("crates/desktop/src/window.rs", "generate_handler![")
            .into_iter()
            .map(|command| format!("plugin:window-bar|{command}")),
    );
    let mut declared = table.clone();
    registered.sort();
    declared.sort();
    assert_eq!(
        registered, declared,
        "seam.ts and the Tauri handler list differ"
    );
    table
}

/// M5, M6: the tools a non-Door Agent is offered.
pub fn expected_tools() -> Vec<String> {
    let mut expected: Vec<_> = TOOL_METHODS.iter().map(|m| tool_name(m)).collect();
    // H14: `ask_user` is the one tool that is not a method's name.
    expected.push("ask_user".into());
    expected
}
