//! `RailNode` (RO5): a node's base facts and the facts only its kind has.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::*;
use crate::common::Status;

/// RO5: one node of the Rail. The `kind` tag and the fields that kind has are in `role`; a field a
/// kind lacks is absent from its JSON.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct RailNode {
    #[serde(flatten)]
    pub base: NodeBase,
    #[serde(flatten)]
    pub role: Role,
}

impl std::ops::Deref for RailNode {
    type Target = NodeBase;
    fn deref(&self) -> &NodeBase {
        &self.base
    }
}

impl std::ops::DerefMut for RailNode {
    fn deref_mut(&mut self) -> &mut NodeBase {
        &mut self.base
    }
}

impl RailNode {
    pub fn kind(&self) -> NodeKind {
        match self.role {
            Role::Group => NodeKind::Group,
            Role::Workstream(_) => NodeKind::Workstream,
            Role::Agent(_) => NodeKind::Agent,
        }
    }

    /// The Door facts of an Agent or a Workstream; a Group has none.
    pub fn door(&self) -> Option<&DoorFacts> {
        self.role.door()
    }

    pub fn status(&self) -> Option<&Status> {
        self.door()?.status.as_ref()
    }

    pub fn attempt(&self) -> Option<Ordinal> {
        self.door()?.attempt.clone()
    }

    pub fn status_revision(&self) -> Option<Ordinal> {
        self.door()?.status_revision.clone()
    }

    pub fn terminal_id(&self) -> Option<String> {
        self.door()?.terminal_id.clone()
    }

    pub fn worktree(&self) -> Option<Worktree> {
        self.door()?.worktree.clone()
    }

    pub fn work(&self) -> Option<Order> {
        self.door()?.work.clone()
    }

    pub fn model(&self) -> Option<String> {
        self.door()?.model.clone()
    }

    pub fn effort(&self) -> Option<String> {
        self.door()?.effort.clone()
    }

    pub fn channel(&self) -> Option<Channel> {
        self.door()?.channel
    }

    pub fn can_resume(&self) -> bool {
        self.door().is_some_and(|door| door.can_resume)
    }

    pub fn has_conversation(&self) -> bool {
        self.door().is_some_and(|door| door.has_conversation)
    }

    pub fn mode_prompt(&self) -> Option<String> {
        self.agent()?.mode_prompt.clone()
    }

    pub fn machine(&self) -> Option<String> {
        self.agent()?.machine.clone()
    }

    pub fn final_text(&self) -> Option<&FinalText> {
        self.door()?.final_text.as_ref()
    }

    pub fn inbox(&self) -> Option<Inbox> {
        self.door()?.inbox
    }

    pub fn tool_call(&self) -> Option<&ToolCall> {
        self.door()?.tool_call.as_ref()
    }

    pub fn unreachable(&self) -> Option<&str> {
        self.door()?.unreachable.as_deref()
    }

    pub fn resume(&self) -> Option<&ResumeWait> {
        self.door()?.resume.as_ref()
    }

    pub fn overview(&self) -> Option<&ConversationOverview> {
        self.door()?.overview.as_ref()
    }

    pub fn yolo(&self) -> bool {
        self.door().is_some_and(|door| door.yolo)
    }

    pub fn stray(&self) -> &[Stray] {
        self.door().map_or(&[], |door| &door.stray)
    }

    pub fn can_make_workstream(&self) -> bool {
        self.agent().is_some_and(|agent| agent.can_make_workstream)
    }

    pub fn can_save_as_mode(&self) -> bool {
        self.agent().is_some_and(|agent| agent.can_save_as_mode)
    }

    /// The Workstream-only facts; `None` for a Group and an Agent.
    pub fn workstream(&self) -> Option<&WorkstreamNode> {
        match &self.role {
            Role::Workstream(w) => Some(w),
            _ => None,
        }
    }

    pub fn workstream_mut(&mut self) -> Option<&mut WorkstreamNode> {
        match &mut self.role {
            Role::Workstream(w) => Some(w),
            _ => None,
        }
    }

    /// The Workstream's Auto choice; `false` on every other kind.
    pub fn auto(&self) -> bool {
        self.workstream().is_some_and(|w| w.auto)
    }

    /// The Agent-only facts; `None` for a Group and a Workstream.
    pub fn agent(&self) -> Option<&AgentNode> {
        match &self.role {
            Role::Agent(a) => Some(a),
            _ => None,
        }
    }

    pub fn door_mut(&mut self) -> Option<&mut DoorFacts> {
        self.role.door_mut()
    }
}

impl Role {
    pub fn door(&self) -> Option<&DoorFacts> {
        match self {
            Role::Group => None,
            Role::Workstream(w) => Some(&w.door),
            Role::Agent(a) => Some(&a.door),
        }
    }

    pub fn door_mut(&mut self) -> Option<&mut DoorFacts> {
        match self {
            Role::Group => None,
            Role::Workstream(w) => Some(&mut w.door),
            Role::Agent(a) => Some(&mut a.door),
        }
    }
}

/// RO5: the facts of every kind.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct NodeBase {
    pub id: String,
    pub name: String,
    pub parent: Option<String>,
    /// Position among siblings; lower first.
    pub order: u32,
    #[serde(default)]
    #[specta(optional)]
    pub visibility: RailVisibility,
    /// U5501: authoritative per-Agent choice; a Workstream stores its Door choice.
    #[serde(default)]
    #[specta(optional)]
    pub alert_level: AlertLevel,
}

/// RO5: a node's kind and the facts only that kind has. A Terminal is `terminal_id` on an Agent or a
/// Door, so there is no Terminal variant.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Role {
    Group,
    Workstream(WorkstreamNode),
    Agent(AgentNode),
}

/// RO5: what an Agent and a Workstream's Door share.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct DoorFacts {
    /// `None` for Terminals.
    pub status: Option<Status>,
    /// Last allocated program attempt; present even after stop or reopen.
    #[specta(type = Option<String>)]
    pub attempt: Option<Ordinal>,
    /// Status transition within the current Attempt; absent after reopen.
    #[specta(type = Option<String>)]
    pub status_revision: Option<Ordinal>,
    /// U5483c: only authoritative known-empty final text can permit folding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = FinalText)]
    pub final_text: Option<FinalText>,
    /// The Terminal behind an Agent or Terminal node.
    pub terminal_id: Option<String>,
    /// `None` for a Terminal, or when the Project's `worktrees` setting was off.
    pub worktree: Option<Worktree>,
    /// A22: true only for an exited Agent or Door with saved conversation data (A21) and no
    /// start in flight. `false` for a Terminal.
    pub can_resume: bool,
    /// U7191b: the Daemon holds a saved conversation (A21) for this Agent or Door, running or exited; Restart resumes it. `false` for a Terminal.
    #[serde(default)]
    pub has_conversation: bool,
    /// Permission prompts are off for the last acknowledged Attempt; cleared on reopen.
    #[serde(default)]
    pub yolo: bool,
    /// E6: whether the Agent's `rup mcp` has reported to the Daemon. `None` for a Workstream that is no Door, a Terminal, and an Agent with no live Terminal.
    pub channel: Option<Channel>,
    /// O1: the order of an Agent or a Workstream's Door; `None` for a Terminal. Named `work` because `order` is the position among siblings.
    pub work: Option<Order>,
    /// F5: processes in a Door's Terminal tree that carry a vendor program's name and that the Daemon did not register. Empty for every other node, and for a Door with none.
    pub stray: Vec<Stray>,
    /// A36: the Model the Agent runs on; `None` passes none. `None` for a Terminal.
    pub model: Option<String>,
    /// A36: the Effort the Agent runs on; `None` passes none. `None` for a Terminal.
    pub effort: Option<String>,
    /// B51: whether the Claude inbox a `note` is written to is usable, from the Agent's latest check; absent before the first check and on a Terminal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Inbox)]
    pub inbox: Option<Inbox>,
    /// U3780a: the Agent's current or last tool call; absent until its first.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = ToolCall)]
    pub tool_call: Option<ToolCall>,
    /// DCL1: why Messages to this Agent, or to a Workstream's Door, have not reached it (`inbox write failed`); absent when none is failing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub unreachable: Option<String>,
    /// U6248b: the Agent's turn ended on a Claude service error and roundup resumes it; absent when none does.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = ResumeWait)]
    pub resume: Option<ResumeWait>,
    /// A2681a: available conversation parts, only after the Agent's program exits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = ConversationOverview)]
    pub overview: Option<ConversationOverview>,
    /// A5765e: captured foreign source identity, descriptive only; absent for ordinary Add.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = StartAttribution)]
    pub start_attribution: Option<StartAttribution>,
}

/// RO5: a Workstream; its Door's facts stay on it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct WorkstreamNode {
    #[serde(flatten)]
    pub door: DoorFacts,
    /// DCL2: on a Workstream, the most urgent state among its Door and all its descendant Agents;
    /// apart from the Door's own `status`. Absent on every other node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = WorkstreamState)]
    pub workstream_state: Option<WorkstreamState>,
    /// A3308: the Workstream's Auto choice.
    #[serde(default)]
    pub auto: bool,
    /// DCL10: on a Workstream, the changes its Door has not received (stored backlog); absent when none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = u32)]
    pub waiting: Option<u32>,
}

/// RO5: an Agent.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, Type, JsonSchema)]
pub struct AgentNode {
    #[serde(flatten)]
    pub door: DoorFacts,
    /// A4452c: the Mode Agent's saved prompt; absent on other nodes and when none is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub mode_prompt: Option<String>,
    /// MC13: the Machine the Agent runs on; absent on this Mac and on every other node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub machine: Option<String>,
    /// A5287: true exactly when `agent.makeWorkstream` would not refuse the node: an Agent with a
    /// saved conversation that is no child of a Workstream, running or exited.
    #[serde(default)]
    pub can_make_workstream: bool,
    /// A5287: true exactly when `agent.saveAsMode` would not refuse the node: an Agent roundup started.
    #[serde(default)]
    pub can_save_as_mode: bool,
}
