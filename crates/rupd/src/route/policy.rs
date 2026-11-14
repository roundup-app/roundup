//! The one table of what the Daemon does for each method: whose identity it runs under, which
//! guard precedes it, which effect follows it and how Auto serializes it. Every reader calls
//! `policy`; no other file compares a method name. A name missing here is METHOD_NOT_FOUND.

/// Whose identity a request runs under.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Actor {
    /// The connection's own.
    Connection,
    /// The caller's process identity (`action_actor`), settled by the wire reader (Z6395a).
    Caller,
    /// A Terminal writer's: only an Agent process changes the identity.
    TerminalWriter,
}

/// A method the router answers without `route_inner`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Entry {
    Routed,
    Rail,
    Ping,
}

/// The guard that runs before the module is called, or the handler that replaces the call.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Gate {
    None,
    UserOnly,
    RefTarget,
    Workstream,
    Owner,
    /// M13: a Terminal an Agent may read.
    Terminal,
    /// M13 for a Door's read of a child's Terminal.
    ChildRead,
    Show,
    Open,
    RouteSet,
    TerminalWrite,
    RemoveSelection,
    RailRemove,
    SetVisibility,
    Spawn,
}

/// The effect that follows a call.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum After {
    None,
    MessageSend,
    AgentSignal,
    TodoCreate,
    PadCreate,
    RailRemove,
    PadDelete,
}

/// Whether Auto's gate serializes the call.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Serial {
    No,
    Yes,
    /// Only a retained removal, which names an `operation`.
    Operation,
}

/// The reference fields of the params that name an Agent by selector.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Inputs {
    None,
    StartDoor,
    Wake,
    Provenance,
    Spawn,
    Move,
    Id,
    Remove,
    Hand,
    To,
    RouteSet,
    Maker,
    Reader,
    Agent,
    Owner,
    Rewind,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Policy {
    pub(crate) actor: Actor,
    pub(crate) entry: Entry,
    pub(crate) gate: Gate,
    pub(crate) after: After,
    pub(crate) inputs: Inputs,
    /// A call that can stop at the prompt-effect observer when an Agent makes it.
    pub(crate) observed: bool,
    /// Auto tells its notices after the call.
    pub(crate) observes: bool,
    pub(crate) serial: Serial,
    /// An Agent's call takes the Workstream cap.
    pub(crate) capped: bool,
    /// The wire reader dispatches it before it reads the next request.
    pub(crate) settles: bool,
}

const PLAIN: Policy = Policy {
    actor: Actor::Connection,
    entry: Entry::Routed,
    gate: Gate::None,
    after: After::None,
    inputs: Inputs::None,
    observed: false,
    observes: false,
    serial: Serial::No,
    capped: false,
    settles: false,
};

/// The row of `method`, or `None` for a name the Daemon does not serve.
pub(crate) fn policy(method: &str) -> Option<&'static Policy> {
    TABLE
        .binary_search_by_key(&method, |row| row.0)
        .ok()
        .and_then(|at| TABLE.get(at))
        .map(|row| &row.1)
}

/// Sorted by name, one row per method.
#[rustfmt::skip]
static TABLE: &[(&str, Policy)] = &[
    ("action.list", Policy { actor: Actor::Caller, ..PLAIN }),
    ("action.run", Policy { actor: Actor::Caller, ..PLAIN }),
    ("action.serve", Policy { actor: Actor::Caller, ..PLAIN }),
    ("action.userList", Policy { actor: Actor::Caller, ..PLAIN }),
    ("agent.brief", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.changedFiles", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.channelUp", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.compareFile", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.context", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.createMode", Policy { observes: true, ..PLAIN }),
    ("agent.digest", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.discard", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.extras", PLAIN),
    ("agent.extras_add", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.instructions", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("agent.interrupt", Policy { actor: Actor::Caller, observed: true, inputs: Inputs::Id, ..PLAIN }),
    ("agent.land", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.makeWorkstream", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.prompt", Policy { actor: Actor::Caller, observed: true, inputs: Inputs::Id, ..PLAIN }),
    ("agent.restartMode", Policy { observes: true, inputs: Inputs::Id, ..PLAIN }),
    ("agent.resume", Policy { actor: Actor::Caller, observes: true, inputs: Inputs::Id, ..PLAIN }),
    ("agent.run", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.saveAsMode", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.setModePrompt", Policy { observes: true, inputs: Inputs::Id, ..PLAIN }),
    ("agent.setModel", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.setOrder", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("agent.setVisibility", Policy { actor: Actor::Caller, gate: Gate::SetVisibility, inputs: Inputs::Id, ..PLAIN }),
    ("agent.signal", Policy { after: After::AgentSignal, inputs: Inputs::Id, ..PLAIN }),
    ("agent.skills", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.spawn", Policy { actor: Actor::Caller, gate: Gate::Spawn, observes: true, capped: true, inputs: Inputs::Spawn, ..PLAIN }),
    ("agent.spawnPrompt", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("agent.stop", Policy { actor: Actor::Caller, observed: true, inputs: Inputs::Id, ..PLAIN }),
    ("agent.wake", Policy { inputs: Inputs::Wake, ..PLAIN }),
    ("agent.worktreeState", Policy { inputs: Inputs::Id, ..PLAIN }),
    ("api.describe", PLAIN),
    ("api.list", PLAIN),
    ("ask.list", PLAIN),
    ("ask.pick", PLAIN),
    ("ask.place", PLAIN),
    ("ask.send", PLAIN),
    ("config.read", Policy { actor: Actor::Caller, ..PLAIN }),
    ("daemon.getNaming", Policy { actor: Actor::Caller, ..PLAIN }),
    ("daemon.identify", Policy { settles: true, ..PLAIN }),
    ("daemon.methods", PLAIN),
    ("daemon.ping", Policy { entry: Entry::Ping, ..PLAIN }),
    ("daemon.setNaming", Policy { actor: Actor::Caller, ..PLAIN }),
    ("data.fork", PLAIN),
    ("deliverable.get", Policy { actor: Actor::Caller, ..PLAIN }),
    ("deliverable.list", Policy { actor: Actor::Caller, inputs: Inputs::Maker, ..PLAIN }),
    ("deliverable.move", Policy { actor: Actor::Caller, ..PLAIN }),
    ("deliverable.publish", Policy { actor: Actor::Caller, ..PLAIN }),
    ("deliverable.remove", Policy { actor: Actor::Caller, ..PLAIN }),
    ("deliverable.resolve", Policy { actor: Actor::Caller, ..PLAIN }),
    ("events.subscribe", Policy { settles: true, ..PLAIN }),
    ("feedback.retry", PLAIN),
    ("feedback.send", PLAIN),
    ("github.issueGet", PLAIN),
    ("github.prAutoMerge", PLAIN),
    ("github.prGet", PLAIN),
    ("github.prReady", PLAIN),
    ("github.prSetBody", PLAIN),
    ("import.list", PLAIN),
    ("link.read", PLAIN),
    ("machine.add", PLAIN),
    ("machine.list", PLAIN),
    ("message.acceptResult", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("message.drop", PLAIN),
    ("message.get", PLAIN),
    ("message.list", Policy { inputs: Inputs::To, ..PLAIN }),
    ("message.progress", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("message.reconcileWork", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("message.report", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("message.resolveResult", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("message.resumeWork", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("message.retryDelivery", PLAIN),
    ("message.send", Policy { after: After::MessageSend, inputs: Inputs::To, ..PLAIN }),
    ("message.verifyResult", Policy { actor: Actor::Caller, inputs: Inputs::Id, ..PLAIN }),
    ("models.list", PLAIN),
    ("pad.append", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.appendSection", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.create", Policy { after: After::PadCreate, serial: Serial::Yes, ..PLAIN }),
    ("pad.delete", Policy { after: After::PadDelete, serial: Serial::Yes, ..PLAIN }),
    ("pad.export", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.getDeletion", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.list", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.move", Policy { gate: Gate::Workstream, serial: Serial::Yes, ..PLAIN }),
    ("pad.read", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.redoDelete", Policy { after: After::PadDelete, serial: Serial::Yes, ..PLAIN }),
    ("pad.rename", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.reorder", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.restore", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.setStorage", Policy { serial: Serial::Yes, ..PLAIN }),
    ("pad.write", Policy { serial: Serial::Yes, ..PLAIN }),
    ("project.get", PLAIN),
    ("project.importCommit", Policy { inputs: Inputs::Agent, ..PLAIN }),
    ("project.importDiscover", Policy { inputs: Inputs::Agent, ..PLAIN }),
    ("project.open", Policy { actor: Actor::Caller, ..PLAIN }),
    ("project.prepareDirectory", PLAIN),
    ("project.rename", PLAIN),
    ("project.resources", PLAIN),
    ("project.setMachine", PLAIN),
    ("project.setMcp", PLAIN),
    ("project.setModels", PLAIN),
    ("project.setPrepared", PLAIN),
    ("project.setWorkstreamCap", PLAIN),
    ("project.setWorktrees", PLAIN),
    ("project.start", Policy { actor: Actor::Caller, ..PLAIN }),
    ("provenance.history", PLAIN),
    ("provenance.touched", Policy { inputs: Inputs::Provenance, ..PLAIN }),
    ("rail.createWorkstream", PLAIN),
    ("rail.deletion", Policy { actor: Actor::Caller, ..PLAIN }),
    ("rail.group", Policy { actor: Actor::Caller, ..PLAIN }),
    ("rail.move", Policy { inputs: Inputs::Move, ..PLAIN }),
    ("rail.redo", Policy { actor: Actor::Caller, serial: Serial::Yes, ..PLAIN }),
    ("rail.remove", Policy { actor: Actor::Caller, gate: Gate::RailRemove, after: After::RailRemove, observes: true, serial: Serial::Operation, inputs: Inputs::Remove, ..PLAIN }),
    ("rail.removeSelection", Policy { actor: Actor::Caller, gate: Gate::RemoveSelection, ..PLAIN }),
    ("rail.rename", Policy { actor: Actor::Caller, observed: true, inputs: Inputs::Id, ..PLAIN }),
    ("rail.restore", Policy { actor: Actor::Caller, serial: Serial::Yes, ..PLAIN }),
    ("rail.setAlertLevel", Policy { actor: Actor::Caller, ..PLAIN }),
    ("rail.startDoor", Policy { observes: true, inputs: Inputs::StartDoor, ..PLAIN }),
    ("rail.tree", Policy { entry: Entry::Rail, ..PLAIN }),
    ("route.list", PLAIN),
    ("route.set", Policy { gate: Gate::RouteSet, inputs: Inputs::RouteSet, ..PLAIN }),
    ("shortcuts.export", PLAIN),
    ("skill.remove", PLAIN),
    ("skill.setup", PLAIN),
    ("skill.status", PLAIN),
    ("terminal.catchUp", Policy { actor: Actor::Caller, ..PLAIN }),
    ("terminal.close", Policy { observed: true, gate: Gate::Terminal, ..PLAIN }),
    ("terminal.kill", Policy { observed: true, gate: Gate::Terminal, ..PLAIN }),
    ("terminal.list", PLAIN),
    ("terminal.measure", PLAIN),
    ("terminal.open", Policy { gate: Gate::Open, ..PLAIN }),
    ("terminal.output", Policy { settles: true, ..PLAIN }),
    ("terminal.outputStop", Policy { settles: true, ..PLAIN }),
    ("terminal.read", Policy { gate: Gate::ChildRead, inputs: Inputs::Reader, ..PLAIN }),
    ("terminal.resize", Policy { observed: true, gate: Gate::Terminal, ..PLAIN }),
    ("terminal.scheme", PLAIN),
    ("terminal.screen", Policy { gate: Gate::ChildRead, ..PLAIN }),
    ("terminal.search", Policy { gate: Gate::ChildRead, ..PLAIN }),
    ("terminal.show", Policy { gate: Gate::Show, ..PLAIN }),
    ("terminal.snapshot", Policy { gate: Gate::ChildRead, ..PLAIN }),
    ("terminal.spawn", PLAIN),
    ("terminal.write", Policy { actor: Actor::TerminalWriter, gate: Gate::TerminalWrite, ..PLAIN }),
    ("todo.addRef", Policy { gate: Gate::RefTarget, observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.assign", Policy { gate: Gate::Owner, observes: true, serial: Serial::Yes, inputs: Inputs::Owner, ..PLAIN }),
    ("todo.comment", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.comments", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.complete", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.create", Policy { gate: Gate::Owner, after: After::TodoCreate, observes: true, serial: Serial::Yes, inputs: Inputs::Owner, ..PLAIN }),
    ("todo.delete", Policy { actor: Actor::Caller, observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.deletion", Policy { actor: Actor::Caller, serial: Serial::Yes, ..PLAIN }),
    ("todo.get", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.getHistory", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.hand", Policy { observes: true, serial: Serial::Yes, inputs: Inputs::Hand, ..PLAIN }),
    ("todo.list", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.listHanded", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.markCommentsRead", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.move", Policy { gate: Gate::Workstream, observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.readHistory", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.redo", Policy { actor: Actor::Caller, gate: Gate::UserOnly, serial: Serial::Yes, ..PLAIN }),
    ("todo.refs", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.removeRef", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.reopen", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.reorder", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.restore", Policy { actor: Actor::Caller, gate: Gate::UserOnly, serial: Serial::Yes, ..PLAIN }),
    ("todo.setBlockers", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.startWorkstream", Policy { observes: true, ..PLAIN }),
    ("todo.unread", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("todo.update", Policy { observes: true, serial: Serial::Yes, ..PLAIN }),
    ("workstream.dequeue", Policy { observes: true, ..PLAIN }),
    ("workstream.queue", Policy { observes: true, ..PLAIN }),
    ("workstream.queueMove", Policy { observes: true, ..PLAIN }),
    ("workstream.rewind", Policy { observes: true, inputs: Inputs::Rewind, ..PLAIN }),
    ("workstream.setAuto", Policy { actor: Actor::Caller, observes: true, serial: Serial::Yes, ..PLAIN }),
    ("workstream.startNow", Policy { observes: true, ..PLAIN }),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn d9_method_policy_names_equal_the_contract_methods() {
        let names: Vec<&str> = TABLE.iter().map(|row| row.0).collect();
        assert_eq!(names, contracts::methods::method_names());
    }
}
