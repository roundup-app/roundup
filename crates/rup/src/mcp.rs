//! `rup mcp <agent-id>`: Todos, Pads and Messages as MCP tools for one Agent, over stdio.
//! Every call reaches the Daemon on its own connection identified as that Agent, so it is a Touch by that Agent.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use contracts::{
    Actor, ActorKind, HistoryParams, IdentifyParams, TouchedParams, agent, checkpoint, decision,
    deliverable, link, message, pad, project, reaction, terminal, todo, workstream,
};
use rmcp::model::{
    CacheScope, CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock,
    Implementation, JsonObject, ListToolsResult, PaginatedRequestParams, ServerCapabilities,
    ServerConfig, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData, ServerHandler, ServiceExt};
use rpc::RpcError;
use schemars::JsonSchema;
use serde_json::Value;
use tokio::sync::mpsc;

/// A Todo or Pad call is a few SQLite statements; past this the Daemon is wedged, and a hung tool call would hang the Agent's turn.
pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(10);

/// `ttlMs` and `cacheScope` are required by the client's `tools/list` schema (M4). The tool set is fixed for
/// the life of this process, so the reply is `public` and fresh for an hour.
#[macro_use]
mod agent_tools;
use agent_tools::{
    agent_context, agent_digest, agent_extras, agent_extras_add, agent_set_order, agent_spawn,
    agent_wake, checkpoint_write, decision_answer, workstream_handoff, workstream_rewind,
    workstream_rewind_plan,
};

const TOOLS_TTL_MS: u64 = 3_600_000;

/// One entry of the one tool list: `rup mcp` offers it as a tool and `rup` as a command (I1).
pub(crate) struct Offered {
    pub(crate) method: &'static str,
    pub(crate) tool: Tool,
    takes_params: bool,
    /// E4: the params are `{id}` with the shim's own Agent id, and the tool takes no input.
    own_id: bool,
    /// X16: the params carry `reader`, the shim's own Agent id, and the tool's schema lacks it.
    own_reader: bool,
    /// H14: the call waits for the user, so no `CALL_TIMEOUT` applies and its result is the answer's text.
    pub(crate) waits_for_user: bool,
    /// B20, A32, M10: only a Door is offered it.
    pub(crate) door_only: bool,
    /// I9: the call answers once and then pushes Events, so `rup` has it as a command and `rup mcp` does not offer it.
    pub(crate) stream: bool,
}

impl Offered {
    /// The params of a call by Agent `agent` with the tool's `arguments`.
    pub(crate) fn params(&self, agent: &str, arguments: Option<JsonObject>) -> Value {
        let arguments = match arguments {
            Some(mut arguments) if self.own_reader => {
                arguments.insert("reader".into(), agent.into());
                Some(arguments)
            }
            other => other,
        };
        match (self.takes_params, self.own_id, arguments) {
            (false, true, _) => serde_json::json!({ "id": agent }),
            (true, true, arguments) => {
                let mut arguments = arguments.unwrap_or_default();
                arguments.insert("id".into(), agent.into());
                Value::Object(arguments)
            }
            (true, false, arguments) => Value::Object(arguments.unwrap_or_default()),
            (false, false, _) => Value::Null,
        }
    }
}

/// The Daemon cannot be spoken to; the shim exits instead of answering the Agent.
#[derive(Debug)]
enum Gone {
    Unreachable(String),
    /// The method was sent and got no answer, so it may or may not have been applied.
    Silent,
}

impl std::fmt::Display for Gone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Gone::Unreachable(why) => f.write_str(why),
            Gone::Silent => write!(
                f,
                "no answer within {}s; the call may have been applied",
                CALL_TIMEOUT.as_secs()
            ),
        }
    }
}

fn offered<P: JsonSchema>(method: &'static str, description: &'static str) -> Offered {
    let Ok(Value::Object(schema)) = serde_json::to_value(schemars::schema_for!(P)) else {
        unreachable!("a params struct's schema is an object");
    };
    offer(method, description, schema, true)
}

/// H14: the one tool that is not a method's name with the dot replaced; the Agent asks the user and the call returns the answer.
fn ask_user() -> Offered {
    let Ok(Value::Object(schema)) =
        serde_json::to_value(schemars::schema_for!(decision::AskParams))
    else {
        unreachable!("a params struct's schema is an object");
    };
    Offered {
        method: "agent.ask",
        tool: Tool::new(
            "ask_user",
            "Ask the user a decision with up to four answers, each with its tradeoff and optionally a preview sketch. Waits for the user and returns `{answer, note}`: the label they picked or null for their own answer, and their note.",
            schema,
        ),
        takes_params: true,
        own_id: false,
        own_reader: false,
        waits_for_user: true,
        door_only: false,
        stream: false,
    }
}

fn offered_without_params(method: &'static str, description: &'static str) -> Offered {
    let schema = JsonObject::from_iter([("type".into(), "object".into())]);
    offer(method, description, schema, false)
}

fn offer(
    method: &'static str,
    description: &'static str,
    schema: JsonObject,
    takes_params: bool,
) -> Offered {
    Offered {
        method,
        tool: Tool::new(method.replace('.', "_"), description, schema),
        takes_params,
        own_id: false,
        own_reader: false,
        waits_for_user: false,
        door_only: false,
        stream: false,
    }
}

/// M16: the tools a Door is not offered, since each starts a Terminal.
pub(crate) const DOOR_WITHOUT: [&str; 3] = ["agent_run", "terminal_spawn", "terminal_open"];

/// M16: what `rup mcp` offers a Door: the Door-only tools, and no tool that starts a Terminal.
/// Leaving a name out of the list is also its enforcement: a call to it is an unknown tool, and reaches no Daemon.
pub(crate) fn door_tools() -> Vec<Offered> {
    let mut list = tools(true);
    list.retain(|offer| !DOOR_WITHOUT.contains(&&*offer.tool.name));
    list
}

/// B53: a Door asks the App to show a Terminal in its Reach; nothing is read and nothing starts.
fn terminal_show() -> Offered {
    Offered {
        door_only: true,
        ..offered::<terminal::TerminalId>(
            "terminal.show",
            "Show a Terminal in your Reach to the user, who sees its owner selected. Use it when the user asks to see a child's output; it reads nothing and returns nothing.",
        )
    }
}

/// X11: `agent.run` takes `{id, command, cwd?}`; the shim fills `id`, so a Run is always the caller's own.
fn agent_run() -> Offered {
    with_own_id::<agent::RunParams>(
        "agent.run",
        "agent_run",
        concat!(
            "Run a command in a Terminal of your own that the user can watch, in your Worktree or in `cwd`. Returns the Terminal's id.",
            bubble_rule!()
        ),
    )
}

/// X16: `terminal.read` returns what is new since the caller's last read; the shim fills `reader`.
fn terminal_read() -> Offered {
    let Ok(Value::Object(mut schema)) =
        serde_json::to_value(schemars::schema_for!(terminal::ReadParams))
    else {
        unreachable!("a params struct's schema is an object");
    };
    if let Some(Value::Object(properties)) = schema.get_mut("properties") {
        properties.remove("reader");
    }
    Offered {
        own_reader: true,
        tool: Tool::new(
            "terminal_read",
            "Read a Terminal's output you have not read yet, as plain text; `next` is the offset after it. At most 200 lines and 16 384 bytes a call, `truncated` says more remains. With `after`, read from that offset instead and keep your place.",
            schema,
        ),
        ..offer("terminal.read", "", JsonObject::new(), true)
    }
}

/// A tool for `method` whose params carry the caller's own `id`, which the shim fills: the tool's schema lacks it.
fn with_own_id<P: JsonSchema>(
    method: &'static str,
    name: &'static str,
    description: &'static str,
) -> Offered {
    let Ok(Value::Object(mut schema)) = serde_json::to_value(schemars::schema_for!(P)) else {
        unreachable!("a params struct's schema is an object");
    };
    if let Some(Value::Object(properties)) = schema.get_mut("properties") {
        properties.remove("id");
    }
    if let Some(Value::Array(required)) = schema.get_mut("required") {
        required.retain(|name| name != "id");
    }
    Offered {
        own_id: true,
        door_only: matches!(
            method,
            "workstream.handoff" | "workstream.rewindPlan" | "workstream.rewind"
        ),
        tool: Tool::new(name, description, schema),
        ..offer(method, "", JsonObject::new(), true)
    }
}

/// I9: `events.subscribe`, the one stream of the list.
fn events_stream() -> Offered {
    Offered {
        stream: true,
        ..offered::<contracts::SubscribeParams>(
            "events.subscribe",
            "Print the Events saved after a number, one JSON object per line, then stop at the end of the log. `--follow` keeps streaming new ones; without `--after` it starts at the end.",
        )
    }
}

/// I1: the one list both `rup mcp` and `rup` read: M5's tools, and the Door-only ones (marked) when `door`.
/// The streams are in `commands`, not here: an MCP call returns once (I9).
pub(crate) fn tools(door: bool) -> Vec<Offered> {
    commands(door)
        .into_iter()
        .filter(|offer| !offer.stream)
        .collect()
}

/// I1, I9: every entry of the one list, the streams included.
pub(crate) fn commands(door: bool) -> Vec<Offered> {
    let mut list = offered_tools();
    list.push(offered_without_params(
        "project.measurements",
        "Read retained Project measurements and collection coverage.",
    ));
    list.push(offered::<contracts::project::MeasurementSummaryParams>(
        "project.measurementSummary",
        "Read a Workstream’s consumed tokens and ranked contributors, twenty per page. Later pages require the first page’s revision; reconcile from offset zero after a revision conflict. Unknown coverage is not zero. This does not report money or time.",
    ));
    list.extend([
        agent_digest(),
        workstream_handoff(),
        checkpoint_write(),
        workstream_rewind_plan(),
        workstream_rewind(),
        agent_extras(),
        agent_extras_add(),
    ]);
    list.push(events_stream());
    list.retain(|offer| door || !offer.door_only);
    list
}

/// M5: one tool for each method of its first list; the methods left out are in its second, with their reasons (`scenarios/mcp.md`).
fn offered_tools() -> Vec<Offered> {
    vec![
        offered::<deliverable::PublishParams>(
            "deliverable.publish",
            "Deliberately publish a file, expected Pad incarnation and Revision or current external URL. Replay the same key and request after an unknown reply; conflicting replay refuses.",
        ),
        offered::<deliverable::ListParams>(
            "deliverable.list",
            "List published results without reading retained payloads.",
        ),
        offered::<deliverable::DeliverableId>(
            "deliverable.get",
            "Read publication metadata by its Project and identity.",
        ),
        offered::<deliverable::DeliverableId>(
            "deliverable.resolve",
            "Resolve the recorded revision or exact current external target, or its unavailability cause.",
        ),
        offered::<deliverable::MoveParams>(
            "deliverable.move",
            "Move a published result; an Agent cannot override user placement.",
        ),
        offered::<deliverable::DeliverableId>(
            "deliverable.remove",
            "Explicitly remove a publication. User only; the identity and key cannot be reused.",
        ),
        offered::<reaction::CreateParams>(
            "reaction.create",
            "Save a named instruction that a declared condition (named Agents finished, a PR's checks passed, or one instant) delivers once to a target Agent as a Message. Needs an `operation` retry key, an `expires_at` and a target that is you or in your Reach; the definition is immutable, so to change it stop it and create another. A refusal saves nothing.",
        ),
        offered::<reaction::PreviewParams>(
            "reaction.preview",
            "Resolve a date, time and UTC offset to the exact `instant` condition `at` and its UTC instant, before creating a time reaction. Saves nothing.",
        ),
        offered_without_params("reaction.list", "List the reactions you authorized."),
        offered::<reaction::ReactionId>("reaction.get", "Read one reaction you authorized."),
        offered::<reaction::ReactionId>(
            "reaction.stop",
            "Stop a reaction you authorized; no later firing is accepted.",
        ),
        offered::<reaction::RunParams>(
            "reaction.run",
            "Spend one remaining firing of a reaction you authorized now, with an `operation` retry key. Refused while the reaction is stopped.",
        ),
        offered::<todo::CreateParams>("todo.create", "Create a Todo."),
        offered::<todo::TodoId>("todo.get", "Read one Todo."),
        offered_without_params("todo.list", "List every Todo."),
        offered::<todo::UpdateParams>("todo.update", "Change a Todo's title, body or estimate."),
        offered::<todo::CommentParams>(
            "todo.comment",
            "Leave a comment on a Todo only when the user must read it, such as a question or a blocker. Write one short plain line, at most 280 characters; it shows in the user's Inbox until they open the Todo. Never report progress or results here.",
        ),
        offered::<todo::RefParams>(
            "todo.addRef",
            "Point the user to a Pad or one section of it from a Todo, so they open it from the Todo and read it. Pass the link `roundup://pad/<name>?project=<key>`; a section link ends in `#<heading>`, the heading's text percent-encoded. The Pad and heading must exist. Adding the same link twice keeps one.",
        ),
        offered::<todo::RefParams>(
            "todo.removeRef",
            "Remove a Pad or Pad-section link from a Todo, by the same link you added; removing one the Todo lacks changes nothing.",
        ),
        offered::<todo::TodoId>("todo.complete", "Mark a Todo done."),
        offered::<todo::TodoId>("todo.reopen", "Reopen a done Todo."),
        offered::<todo::SetBlockersParams>(
            "todo.setBlockers",
            "Replace a Todo's whole blocker list.",
        ),
        offered::<pad::CreateParams>("pad.create", "Create a Pad you own."),
        offered::<pad::PadName>("pad.read", "Read one Pad."),
        offered::<link::LinkUrl>(
            "link.read",
            "Read a Project roundup:// link: current Pad, Todo, Agent, Workstream or Terminal content, or a Deliverable recorded revision/current external target and its availability.",
        ),
        offered_without_params("pad.list", "List every Pad."),
        offered::<pad::WriteParams>(
            "pad.write",
            "Rewrite a Pad's whole text. Owner only. Optional expectedRevision refuses a stale write with CONFLICT.",
        ),
        offered::<pad::AppendParams>("pad.append", "Add text to the end of any Pad."),
        offered::<pad::AppendSectionParams>(
            "pad.appendSection",
            "Add text at the end of the section under a Markdown heading of any Pad; the heading ignores case and extra whitespace. Pass expectedRevision (from a read) to refuse if the Pad changed since.",
        ),
        offered::<pad::SetOwnerParams>("pad.setOwner", "Give a Pad to another Actor."),
        offered::<pad::PadName>("pad.delete", "Delete a Pad."),
        offered::<message::ProgressParams>(
            "message.progress",
            "Inspect retained instructions, reports, acceptance and declared verification without starting work.",
        ),
        offered::<message::ReportParams>(
            "message.report",
            "Report your own Attempt's result for an exact delivered instruction and published output. This is a claim, not acceptance or verification. Use the same key for retries.",
        ),
        offered::<message::AcceptResultParams>(
            "message.acceptResult",
            "Record user acceptance of one exact reported result with its evidence; only the user may accept.",
        ),
        offered::<message::ResultId>(
            "message.verifyResult",
            "Observe a report's declared authoritative condition without a Model call; unavailable or unsupported evidence stays unknown.",
        ),
        offered::<message::ResolveResultParams>(
            "message.resolveResult",
            "User only: authorize a read-only authoritative receipt source for an unknown external effect. Exact target/version and fresh source evidence are required; this never repeats the effect.",
        ),
        offered::<message::ProgressParams>(
            "message.reconcileWork",
            "Read which retained work is unfinished, confirmed, pending a check or uncertain, without sending or starting anything.",
        ),
        offered::<message::ResumeWorkParams>(
            "message.resumeWork",
            "User only: resume an Agent's eligible unfinished work with one successor Message. Retry with the same request id after an unknown reply; it never repeats an uncertain external effect, restarts a stopped Agent or starts a program.",
        ),
        offered::<message::SendParams>(
            "message.send",
            "Send a note or a question to an Agent or the user. You are the sender.",
        ),
        offered::<message::MessageId>("message.get", "Read one Message you sent or received."),
        offered::<message::ListParams>(
            "message.list",
            "List the Messages you sent or received, newest last.",
        ),
        offered::<message::MessageId>(
            "message.pass",
            "Pass a question sent to you on to the next Door above, at once.",
        ),
        offered::<todo::MoveParams>(
            "todo.move",
            "Move a Todo into a Workstream, or out of every Workstream with a null `home`.",
        ),
        offered::<todo::ReorderParams>(
            "todo.reorder",
            "Put a Todo before another in the Todo order, or last with a null `before`.",
        ),
        offered::<todo::TodoId>("todo.delete", "Delete a Todo."),
        offered::<pad::ExportParams>(
            "pad.export",
            "Write a Pad's text to a file at an absolute path.",
        ),
        offered::<pad::SetStorageParams>(
            "pad.setStorage",
            "Choose whether the Project mirrors its Pads to files.",
        ),
        offered_without_params(
            "rail.tree",
            "Read the Rail: every Workstream, Agent and Terminal with its Status.",
        ),
        offered::<agent::CreateWorkstreamParams>(
            "rail.createWorkstream",
            "Make a Workstream at the Project root, with `parent` null. Start its Door next with `rail_startDoor`. Workstreams never nest.",
        ),
        offered::<agent::NodeId>(
            "rail.startDoor",
            "Start the Door of a Workstream you made, or of one in your Reach. It asks the user what the Workstream is for.",
        ),
        offered::<agent::RenameParams>(
            "rail.rename",
            "Rename yourself or a node in your Reach. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
        ),
        offered::<agent::MoveParams>(
            "rail.move",
            "Move a node in your Reach: an Agent under a Workstream or Agent, a Workstream only to the root.",
        ),
        offered::<agent::NodeId>(
            "rail.remove",
            "Remove a node in your Reach, never yourself. Its children move to its parent.",
        ),
        offered::<agent::NodeId>(
            "agent.stop",
            "Stop an Agent in your Reach, never yourself. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
        ),
        offered::<agent::NodeId>(
            "agent.interrupt",
            "Interrupt the turn of an Agent in your Reach. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
        ),
        offered::<agent::PromptParams>(
            "agent.prompt",
            "Send a prompt to an Agent in your Reach as the user would. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
        ),
        offered::<agent::ResumeParams>(
            "agent.resume",
            "Continue a saved conversation in your Reach. An explicit normal or yolo mode stops a running Agent or Door first; omitted mode requires an exited Agent.",
        ),
        offered::<agent::NodeId>(
            "agent.discard",
            "Discard the Worktree of an Agent in your Reach and its changes.",
        ),
        offered::<agent::NodeId>(
            "agent.land",
            "Land the Worktree of an Agent in your Reach on the Base branch.",
        ),
        offered::<agent::NodeId>(
            "agent.worktreeState",
            "Read what a Worktree holds: its changes and whether it can land. Yours or one in your Reach.",
        ),
        offered_without_params(
            "route.list",
            "List the Routes: who each Agent's questions go to.",
        ),
        offered_without_params("project.get", "Read the Project's settings."),
        offered::<project::Worktrees>(
            "project.setWorktrees",
            "Turn Worktrees on or off for the Project and set the command Landing runs.",
        ),
        offered::<HistoryParams>(
            "provenance.history",
            "List the Touches on one item, such as `todo:3` or `rail:5`.",
        ),
        offered::<TouchedParams>("provenance.touched", "List the Touches one Actor made."),
        offered::<project::OpenParams>(
            "project.open",
            "Ask the App to open the Project at an absolute folder path. The answer means asked, not done.",
        ),
        offered::<project::RenameParams>(
            "project.rename",
            "Ask the App to give this Project a name of 1 to 40 characters. The answer means asked, not done.",
        ),
        offered::<checkpoint::ListParams>(
            "checkpoint.list",
            "List the Checkpoints of a Workstream, oldest first.",
        ),
        offered_without_params(
            "decision.list",
            "List the open Decisions of the Agents below you: their permission requests and `ask_user` questions.",
        ),
        decision_answer(),
        offered::<terminal::TerminalId>(
            "terminal.screen",
            "Read a Terminal's screen as it is now, as plain text, with the `offset` to read from next. Only the Terminals of your Runs and your Workstream.",
        ),
        terminal_read(),
        offered::<terminal::SearchParams>(
            "terminal.search",
            "Search a Terminal's output for a regular expression and get the matching lines with their offsets. At most 50 matches a call.",
        ),
        terminal_show(),
        offered::<message::SetRouteParams>(
            "route.set",
            "Set where one Agent's Messages to another go: `auto`, `ask-first` or `drop`. Both must be you or in your Reach; never a Route to yourself, and never over a Route the user set.",
        ),
        offered::<terminal::SpawnParams>(
            "terminal.spawn",
            concat!(
                "Start a program in a Terminal owned by you; the answer holds its `id`. At most 8 per owner.",
                bubble_rule!()
            ),
        ),
        offered::<terminal::OpenParams>(
            "terminal.open",
            concat!(
                "Start a login shell in a Terminal owned by a Workstream that is yours or in your Reach; `workstream` is required for Agents. The answer holds its `terminal_id`.",
                bubble_rule!()
            ),
        ),
        offered::<terminal::TerminalId>(
            "terminal.close",
            "Stop a Terminal you or your Reach own and forget it. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
        ),
        offered::<terminal::WriteParams>(
            "terminal.write",
            "Type base64 `data` into a Terminal you or your Reach own. To prompt, interrupt or stop an Agent, or to answer its Decision, use `agent_prompt`, `agent_interrupt`, `agent_stop` or `decision_answer`; type keystrokes only when no direct tool does. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
        ),
        offered::<terminal::ResizeParams>(
            "terminal.resize",
            "Resize a Terminal you or your Reach own to `cols` by `rows`. During Takeover, a durable waiting receipt means accepted, not executed; read terminal_resizeHistory for its outcome.",
        ),
        offered::<terminal::TerminalId>(
            "terminal.resizeHistory",
            "Read your accepted resize actions and their outcomes, even after the Terminal is gone. Waiting means the user holds Takeover; a dropped reason explains why no retry was made.",
        ),
        offered::<terminal::TerminalId>(
            "terminal.kill",
            "Stop the program of a Terminal you or your Reach own. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
        ),
        offered::<agent::NodeId>(
            "agent.actionHistory",
            "Read your durably accepted child actions and their outcomes. Waiting means accepted, not executed; do not resubmit it. A dropped reason explains an unavailable or uncertain effect.",
        ),
        offered::<agent::NodeId>(
            "agent.instructions",
            "Read exact instruction revisions and Attempt-bound delivery facts for yourself or an Agent in your Reach. Reading sends nothing; submission never proves completion of work.",
        ),
        agent_context(),
        agent_wake(),
        agent_set_order(),
        agent_run(),
        ask_user(),
        agent_spawn(),
    ]
}

// Resolve before actions: discard removes the node, so a lookup after success loses its name.
// These parameters are for rendering; the request keeps the original machine ids.
pub(crate) async fn display_params(
    client: &rpc::Client,
    method: &str,
    params: &Value,
) -> Result<Value, RpcError> {
    if !matches!(method, "agent.discard" | "rail.move" | "workstream.handoff") {
        return Ok(params.clone());
    }
    let nodes = rail_nodes(client).await?;
    let mut display = params.clone();
    display["id"] = rail_name(&nodes, &params["id"]).into();
    if method == "rail.move" && !params["parent"].is_null() {
        display["parent"] = rail_name(&nodes, &params["parent"]).into();
    }
    Ok(display)
}

async fn rail_nodes(client: &rpc::Client) -> Result<Vec<agent::RailNode>, RpcError> {
    let result = tokio::time::timeout(CALL_TIMEOUT, client.request("rail.tree", ()))
        .await
        .map_err(|_| {
            RpcError::internal("could not read Rail names: the Daemon did not answer")
        })??;
    serde_json::from_value(result).map_err(RpcError::internal)
}

fn rail_name(nodes: &[agent::RailNode], id: &Value) -> String {
    nodes
        .iter()
        .find(|node| Some(node.id.as_str()) == id.as_str())
        .map_or_else(|| "an Agent that is gone".into(), |node| node.name.clone())
}

pub(crate) async fn display_data(
    client: &rpc::Client,
    method: &str,
    mut result: Value,
) -> Result<Value, RpcError> {
    match method {
        "rail.tree" => {
            let nodes: Vec<agent::RailNode> =
                serde_json::from_value(result.clone()).map_err(RpcError::internal)?;
            for node in result
                .as_array_mut()
                .ok_or_else(|| RpcError::internal("invalid Rail tree"))?
            {
                if !node["parent"].is_null() {
                    node["parent_name"] = rail_name(&nodes, &node["parent"]).into();
                }
            }
        }
        "agent.context" => {
            // A Door asks the user; only an Agent destination needs a Rail name.
            if result["ask"]["to"].as_str().is_some_and(|to| to != "you") {
                let nodes = rail_nodes(client).await?;
                result["ask"]["name"] = rail_name(&nodes, &result["ask"]["to"]).into();
            }
        }
        "decision.list" => {
            let decisions = result
                .as_array_mut()
                .ok_or_else(|| RpcError::internal("invalid Decision list"))?;
            if !decisions.is_empty() {
                let nodes = rail_nodes(client).await?;
                for decision in decisions {
                    decision["agent_name"] = rail_name(&nodes, &decision["agent"]).into();
                    if let Some(actor) = decision
                        .get_mut("failure")
                        .and_then(|failure| failure.get_mut("answered_by"))
                    {
                        if actor["kind"] == "agent" {
                            actor["name"] = rail_name(&nodes, &actor["id"]).into();
                        }
                        if !actor["parent"].is_null() {
                            actor["parent_name"] = rail_name(&nodes, &actor["parent"]).into();
                        }
                    }
                }
            }
        }
        _ => {}
    }
    Ok(result)
}

/// M17: only declared unit replies become acknowledgements; nullable data stays JSON.
pub(crate) fn success_text(method: &str, params: &Value, result: Value) -> String {
    let unit = contracts::methods::METHODS
        .iter()
        .any(|m| m.name == method && m.result == "null")
        // A held answer is a receipt; an answer that ran has nothing to return.
        || method == "decision.answer" && result.is_null();
    if !unit {
        return result.to_string();
    }
    let field = |key: &str| match &params[key] {
        Value::String(text) => text.clone(),
        value => value.to_string(),
    };
    let id = field("id");
    match method {
        "decision.answer" => {
            let answer = if params["answer"].is_null() {
                field("note")
            } else {
                field("answer")
            };
            format!("answered Decision {id}: {answer}")
        }
        "todo.delete" => format!("deleted Todo {id}"),
        "deliverable.remove" => format!("removed publication {id}"),
        "pad.delete" => format!("deleted Pad {}", field("name")),
        "pad.export" => format!("exported Pad {} to {}", field("name"), field("path")),
        "pad.setStorage" => format!(
            "{} Pad files",
            if params["files"] == true {
                "enabled"
            } else {
                "disabled"
            }
        ),
        "agent.discard" => format!("discarded Worktree of Agent {id}"),
        "rail.move" => format!(
            "moved {id} to {}",
            if params["parent"].is_null() {
                "Project root".into()
            } else {
                field("parent")
            }
        ),
        "project.setWorktrees" => format!(
            "{} Worktrees",
            if params["on"] == true {
                "enabled"
            } else {
                "disabled"
            }
        ),
        "project.open" => format!("requested opening Project {}", field("path")),
        "project.rename" => format!("requested renaming Project to {}", field("name")),
        "terminal.show" => format!("showing Terminal {id}"),
        "workstream.handoff" => format!("handed off Workstream {id}"),
        _ => format!("accepted {}", method.replace('.', " ")),
    }
}

/// B20: whether Agent `id` is a Door, a Workstream's Door, which the Rail shows as a Workstream node with its own id.
pub(crate) async fn is_door(client: &rpc::Client, id: &str) -> Result<bool, String> {
    let tree = client.request("rail.tree", Value::Null);
    match tokio::time::timeout(CALL_TIMEOUT, tree).await {
        Ok(Ok(tree)) => Ok(
            serde_json::from_value::<Vec<agent::RailNode>>(tree).is_ok_and(|nodes| {
                nodes
                    .iter()
                    .any(|node| node.id == id && node.kind == agent::NodeKind::Workstream)
            }),
        ),
        Ok(Err(err)) => Err(format!("the Daemon would not show the Rail: {err}")),
        Err(_) => Err(format!(
            "no answer to the Rail within {}s",
            CALL_TIMEOUT.as_secs()
        )),
    }
}

struct Shim {
    socket: PathBuf,
    actor: Actor,
    tools: Vec<Offered>,
    gone: mpsc::Sender<Gone>,
}

impl Shim {
    async fn connect(&self) -> Result<rpc::Client, Gone> {
        let socket = self.socket.display();
        let handshake = async {
            let client = rpc::Client::connect(&self.socket)
                .await
                .map_err(|err| Gone::Unreachable(format!("no Daemon at {socket}: {err}")))?;
            client
                .request(
                    "daemon.identify",
                    IdentifyParams {
                        actor: self.actor.clone(),
                    },
                )
                .await
                .map_err(|err| {
                    Gone::Unreachable(format!("the Daemon at {socket} refused identify: {err}"))
                })?;
            Ok(client)
        };
        tokio::time::timeout(CALL_TIMEOUT, handshake)
            .await
            .map_err(|_| {
                Gone::Unreachable(format!(
                    "no answer from the Daemon at {socket} within {}s",
                    CALL_TIMEOUT.as_secs()
                ))
            })?
    }

    /// B20: whether this Agent is a Door. A Daemon that cannot say leaves the tool out, and says so.
    async fn is_door(&self, start: &rpc::Client) -> bool {
        match is_door(start, &self.actor.id).await {
            Ok(door) => door,
            Err(why) => {
                eprintln!("rup: {why}, so no digest tool");
                false
            }
        }
    }

    /// E6: tell the Daemon this Agent's `rup mcp` is up, once, on the start connection (after its
    /// `daemon.identify`) and before any tool call. A refusal or silence is one line on stderr:
    /// the tools still work, and the Daemon's Channel says `missing` on its own.
    async fn report_channel(&self, start: &rpc::Client) {
        // CL2: an Ext Actor has no Channel to report.
        if self.actor.kind != ActorKind::Agent {
            return;
        }
        let up = start.request(
            "agent.channelUp",
            contracts::agent::NodeId {
                id: self.actor.id.clone(),
            },
        );
        match tokio::time::timeout(CALL_TIMEOUT, up).await {
            Ok(Ok(_)) => {}
            Ok(Err(err)) => eprintln!("rup: the Daemon did not take the Channel report: {err}"),
            Err(_) => eprintln!(
                "rup: no answer to the Channel report within {}s",
                CALL_TIMEOUT.as_secs()
            ),
        }
    }

    async fn call(
        &self,
        offer: &Offered,
        arguments: Option<JsonObject>,
    ) -> Result<Result<String, RpcError>, Gone> {
        let params = offer.params(&self.actor.id, arguments);
        let client = self.connect().await?;
        if offer.waits_for_user {
            return Ok(client
                .request(offer.method, params)
                .await
                .map(|result| result.to_string()));
        }
        let display = match display_params(&client, offer.method, &params).await {
            Ok(display) => display,
            Err(error) => return Ok(Err(error)),
        };
        let result = tokio::time::timeout(CALL_TIMEOUT, client.request(offer.method, &params))
            .await
            .map_err(|_| Gone::Silent)?;
        let result = match result {
            Ok(result) => display_data(&client, offer.method, result).await,
            Err(error) => Err(error),
        };
        Ok(result.map(|result| success_text(offer.method, &display, result)))
    }
}

impl ServerHandler for Shim {
    // Negotiate the SDK's supported 2025 revision rather than advertising a newer era it
    // does not implement.
    fn supported_protocol_versions(
        &self,
    ) -> std::borrow::Cow<'static, [rmcp::model::ProtocolVersion]> {
        std::borrow::Cow::Borrowed(rmcp::model::ProtocolVersion::known_up_to(
            &rmcp::model::ProtocolVersion::V_2025_11_25,
        ))
    }

    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("roundup", env!("CARGO_PKG_VERSION")))
    }

    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        // Every tool is always in the one page handed out with no cursor; a cursor asks for
        // whatever comes after that page, which is nothing.
        let tools = match request.and_then(|r| r.cursor) {
            Some(_) => Vec::new(),
            None => self.tools.iter().map(|offer| offer.tool.clone()).collect(),
        };
        Ok(ListToolsResult::with_all_items(tools)
            .with_ttl_ms(TOOLS_TTL_MS)
            .with_cache_scope(CacheScope::Public))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        if matches!(request.name.as_ref(), "ask_send" | "ask_list" | "ask_pick") {
            return Err(ErrorData::new(
                rmcp::model::ErrorCode(
                    rpc::code::FORBIDDEN.try_into().expect("FORBIDDEN fits i32"),
                ),
                format!("{} is user-only", request.name),
                None,
            ));
        }
        let offer = self
            .tools
            .iter()
            .find(|offer| offer.tool.name == request.name)
            .ok_or_else(|| {
                ErrorData::invalid_params(format!("no tool named {}", request.name), None)
            })?;
        let result = self.call(offer, request.arguments).await;
        match result {
            Ok(Ok(result)) => Ok(CallToolResult::success(vec![ContentBlock::text(result)]).into()),
            Ok(Err(err)) => {
                let body = serde_json::to_string(&err)
                    .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
                Ok(CallToolResult::error(vec![ContentBlock::text(body)]).into())
            }
            Err(gone) => {
                let message = gone.to_string();
                // A full channel means the shim is already exiting.
                let _ = self.gone.try_send(gone);
                Err(ErrorData::internal_error(message, None))
            }
        }
    }
}

pub async fn run(actor: Actor) -> ExitCode {
    match serve(actor).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("rup: {why}");
            // Returning would block in runtime shutdown on the pending stdin read until the client closes the pipe.
            std::process::exit(1)
        }
    }
}

async fn serve(actor: Actor) -> Result<(), String> {
    let socket = rpc::socket_path().map_err(|err| err.to_string())?;
    let (gone, mut gone_rx) = mpsc::channel(1);
    let mut shim = Shim {
        socket,
        actor,
        tools: tools(false),
        gone,
    };
    let start = shim.connect().await.map_err(|gone| gone.to_string())?;
    // Both wait on the same Daemon, so a mute one costs one `CALL_TIMEOUT`, not two.
    let (meta, ()) = tokio::join!(shim.is_door(&start), shim.report_channel(&start));
    if meta {
        shim.tools = door_tools();
    }
    drop(start);
    let running = shim
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|err| err.to_string())?;
    tokio::select! {
        ended = running.waiting() => ended.map(|_| ()).map_err(|err| err.to_string()),
        Some(gone) = gone_rx.recv() => Err(gone.to_string()),
    }
}

#[cfg(test)]
mod tests;
