use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::common::Actor;
use crate::{agent, checkpoint, decision, message, pad, project, terminal, todo, workstream};

/// Pushed to subscribers as a JSON-RPC notification: `{"method":"event","params":<Event>}`.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[serde(tag = "name", content = "data")]
#[ts(export)]
pub enum EventData {
    #[serde(rename = "project.measurementsChanged")]
    MeasurementsChanged { revision: String },
    #[serde(rename = "ask.changed")]
    AskChanged { ask: Box<crate::ask::Ask> },
    #[serde(rename = "terminal.title")]
    TerminalTitle(terminal::TitleEvent),
    #[serde(rename = "terminal.exited")]
    TerminalExited(terminal::ExitedEvent),
    /// A Terminal with an owner opened, closed or was forgotten (X11, X12): read `terminal.list`.
    #[serde(rename = "terminal.changed")]
    TerminalChanged,
    /// B53: the Daemon answered a Show request; the App selects the Terminal's owner so the user sees it.
    #[serde(rename = "terminal.shown")]
    TerminalShown(terminal::TerminalId),
    #[serde(rename = "todo.created")]
    TodoCreated(Box<todo::Todo>),
    #[serde(rename = "todo.updated")]
    TodoUpdated(Box<todo::Todo>),
    #[serde(rename = "todo.unblocked")]
    TodoUnblocked(todo::TodoId),
    #[serde(rename = "todo.deleted")]
    TodoDeleted(todo::TodoId),
    /// T20: a comment was added to the Todo; read `todo.comments`.
    #[serde(rename = "todo.commented")]
    TodoCommented(todo::TodoId),
    /// T23: the Todo's comments were marked read.
    #[serde(rename = "todo.commentsRead")]
    TodoCommentsRead(todo::TodoId),
    /// T27: a ref was added to the Todo; read `todo.refs`.
    #[serde(rename = "todo.refAdded")]
    TodoRefAdded(todo::TodoId),
    /// T27: a ref was removed from the Todo.
    #[serde(rename = "todo.refRemoved")]
    TodoRefRemoved(todo::TodoId),
    #[serde(rename = "pad.changed")]
    PadChanged(pad::PadName),
    #[serde(rename = "pad.deleted")]
    PadDeleted(pad::PadName),
    #[serde(rename = "message.sent")]
    MessageSent(Box<message::Message>),
    #[serde(rename = "message.held")]
    MessageHeld(Box<message::Message>),
    #[serde(rename = "message.delivered")]
    MessageDelivered(Box<message::Message>),
    #[serde(rename = "message.dropped")]
    MessageDropped(Box<message::Message>),
    #[serde(rename = "route.changed")]
    RouteChanged(message::Route),
    #[serde(rename = "takeover.changed")]
    TakeoverChanged(message::TakeoverChanged),
    #[serde(rename = "agent.status")]
    AgentStatus(Box<agent::StatusEvent>),
    #[serde(rename = "agent.channel")]
    AgentChannel(agent::ChannelEvent),
    #[serde(rename = "agent.stray")]
    AgentStray(agent::StrayEvent),
    #[serde(rename = "agent.toolCall")]
    AgentToolCall(Box<agent::ToolCallEvent>),
    #[serde(rename = "rail.changed")]
    RailChanged,
    /// A2741a: the exact destination and name committed under the Rail mutation lock.
    #[serde(rename = "rail.renamed")]
    RailRenamed { id: String, name: String },
    #[serde(rename = "checkpoint.written")]
    CheckpointWritten(checkpoint::Checkpoint),
    #[serde(rename = "workstream.rewound")]
    WorkstreamRewound(workstream::Rewound),
    #[serde(rename = "decision.opened")]
    DecisionOpened(Box<decision::Decision>),
    #[serde(rename = "decision.cleared")]
    DecisionCleared(decision::ClearedEvent),
    #[serde(rename = "project.requested")]
    ProjectRequested(project::Requested),
    #[serde(rename = "workstream.cleared")]
    WorkstreamCleared(workstream::WorkstreamClearedEvent),
    #[serde(rename = "workstream.clearFailed")]
    WorkstreamClearFailed(workstream::WorkstreamClearFailedEvent),
    /// A3195: the Queue or the Project's cap changed; read `workstream.queue`.
    #[serde(rename = "workstream.queueChanged")]
    WorkstreamQueueChanged,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Event {
    /// The Event number: set on every saved Event (D10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub seq: Option<u64>,
    pub actor: Actor,
    #[serde(flatten)]
    pub data: EventData,
}
