//! `rup mcp <agent-id>`: Todos, Pads and Messages as MCP tools for one Agent, over stdio.
//! Every call reaches the Daemon on its own connection identified as that Agent, so it is a Touch by that Agent.

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use contracts::{
    Actor, ActorKind, HistoryParams, IdentifyParams, TouchedParams, agent, checkpoint, decision,
    message, pad, project, terminal, todo, workstream,
};
use rmcp::model::{
    CacheScope, CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock,
    ElicitRequestParams, ElicitationSchema, Implementation, JsonObject, ListToolsResult,
    PaginatedRequestParams, ServerCapabilities, ServerConfig, ServerRequest, Tool,
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
const TOOLS_TTL_MS: u64 = 3_600_000;

/// One entry of the one tool list: `rup mcp` offers it as a tool and `rup` as a command (I1).
pub(crate) struct Offered {
    pub(crate) method: &'static str,
    pub(crate) tool: Tool,
    takes_params: bool,
    /// E4: the params are `{id}` with the shim's own Agent id, and the tool takes no input.
    own_id: bool,
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
        waits_for_user: false,
        door_only: false,
        stream: false,
    }
}

/// E4: `agent.context` takes `{id}`; the shim fills it, so the Agent's tool takes no input.
fn agent_context() -> Offered {
    Offered {
        own_id: true,
        ..offered_without_params(
            "agent.context",
            "Ask where you stand now: whom you report to, whom to ask, your peers, your open Todos and the Models you may start a child on.",
        )
    }
}

/// B20: `agent.digest` takes `{id}`; the shim fills it, so a Door's tool takes no input.
fn agent_digest() -> Offered {
    Offered {
        own_id: true,
        door_only: true,
        ..offered_without_params(
            "agent.digest",
            "Ask what each of your direct children did: its Kind, its last line, its open Todos and the Pads it wrote since you were last told.",
        )
    }
}

/// M10: only a Door writes a Checkpoint.
fn checkpoint_write() -> Offered {
    Offered {
        door_only: true,
        ..offered::<checkpoint::WriteParams>(
            "checkpoint.write",
            "Write a Checkpoint: a short card of facts for the user, with a title and one to eight Blocks (rows, table, diagram or text) you choose to suit what happened.",
        )
    }
}

/// H21: `decision.answer` takes `{id, answer, note}`; an Agent has no `proof` to send, and the Daemon
/// ignores one, so the tool's schema omits it.
fn decision_answer() -> Offered {
    let Ok(Value::Object(mut schema)) =
        serde_json::to_value(schemars::schema_for!(decision::AnswerParams))
    else {
        unreachable!("a params struct's schema is an object");
    };
    if let Some(Value::Object(properties)) = schema.get_mut("properties") {
        properties.remove("proof");
    }
    if let Some(Value::Array(required)) = schema.get_mut("required") {
        required.retain(|name| name != "proof");
    }
    Offered {
        tool: Tool::new(
            "decision_answer",
            "Answer an open Decision of an Agent below you: `allow` or `deny` for a permission request; for an `ask_user` question one of its labels, or null with a `note` as your own answer, and an optional `note`. Never your own.",
            schema,
        ),
        ..offer("decision.answer", "", JsonObject::new(), true)
    }
}

/// B41: ask to be woken when named Agents finish. The caller is the Agent itself, so `id` is not a parameter.
fn agent_wake() -> Offered {
    offered::<agent::WakeParams>(
        "agent.wake",
        "Ask to be woken when all, or with `any` the first, of the named Agents finish (idle, done, error or needs-you). Returns at once with `{id, fired}`; then end your turn instead of polling. You get one note with each Agent's Kind and last words, and the request is gone.",
    )
}

/// O4: `agent.setOrder` takes `{id, order}`; the shim fills `id`, so the Agent's tool takes only
/// `order`.
fn agent_set_order() -> Offered {
    with_own_id::<agent::SetOrderParams>(
        "agent.setOrder",
        "agent_set_order",
        "Replace your own order: a Work order once the ask is clear, or a Clarification order while a question is open.",
    )
}

/// A32: a Door's answer to the clear of its Workstream.
fn workstream_handoff() -> Offered {
    with_own_id::<workstream::HandoffParams>(
        "workstream.handoff",
        "workstream_handoff",
        "Hand off your Workstream when the user clears it: what happened and why, and the Todos and Pads to keep. Keep only what the user's own words clearly asked for from the start.",
    )
}

/// X11: `agent.run` takes `{id, command, cwd?}`; the shim fills `id`, so a Run is always the caller's own.
fn agent_run() -> Offered {
    with_own_id::<agent::RunParams>(
        "agent.run",
        "agent_run",
        "Run a command in a Terminal of your own that the user can watch, in your Worktree or in `cwd`. Returns the Terminal's id.",
    )
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
        door_only: method == "workstream.handoff",
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
    list.extend([agent_digest(), workstream_handoff(), checkpoint_write()]);
    list.push(events_stream());
    list.retain(|offer| door || !offer.door_only);
    list
}

/// M5: one tool for each method of its first list; the methods left out are in its second, with their reasons (`scenarios/mcp.md`).
fn offered_tools() -> Vec<Offered> {
    vec![
        offered::<todo::CreateParams>("todo.create", "Create a Todo."),
        offered::<todo::TodoId>("todo.get", "Read one Todo."),
        offered_without_params("todo.list", "List every Todo."),
        offered::<todo::UpdateParams>("todo.update", "Change a Todo's title or body."),
        offered::<todo::TodoId>("todo.complete", "Mark a Todo done."),
        offered::<todo::SetBlockersParams>(
            "todo.setBlockers",
            "Replace a Todo's whole blocker list.",
        ),
        offered::<pad::CreateParams>("pad.create", "Create a Pad you own."),
        offered::<pad::PadName>("pad.read", "Read one Pad."),
        offered_without_params("pad.list", "List every Pad."),
        offered::<pad::WriteParams>("pad.write", "Rewrite a Pad's whole text. Owner only."),
        offered::<pad::AppendParams>("pad.append", "Add text to the end of any Pad."),
        offered::<pad::AppendSectionParams>(
            "pad.appendSection",
            "Add text at the end of the section under a Markdown heading of any Pad; the heading ignores case and extra whitespace. Pass expectedRevision (from a read) to refuse if the Pad changed since.",
        ),
        offered::<pad::SetOwnerParams>("pad.setOwner", "Give a Pad to another Actor."),
        offered::<pad::PadName>("pad.delete", "Delete a Pad."),
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
        offered::<agent::NodeId>(
            "agent.resume",
            "Resume a stopped Agent in your Reach from its saved conversation.",
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
        offered::<terminal::ReadParams>(
            "terminal.read",
            "Read a Terminal's output from the offset `after` on, as plain text; `next` is the offset for the next read. At most 16 384 bytes a call.",
        ),
        offered::<terminal::SearchParams>(
            "terminal.search",
            "Search a Terminal's output for a regular expression and get the matching lines with their offsets. At most 50 matches a call.",
        ),
        offered::<message::SetRouteParams>(
            "route.set",
            "Set where one Agent's Messages to another go: `auto`, `ask-first` or `drop`. Both must be you or in your Reach; never a Route to yourself, and never over a Route the user set.",
        ),
        offered::<terminal::SpawnParams>(
            "terminal.spawn",
            "Start a program in a Terminal owned by you; the answer holds its `id`. At most 8 per owner.",
        ),
        offered::<terminal::OpenParams>(
            "terminal.open",
            "Start a login shell in a Terminal owned by a Workstream that is yours or in your Reach; the answer holds its `terminal_id`.",
        ),
        offered::<terminal::TerminalId>(
            "terminal.close",
            "Stop a Terminal you or your Reach own and forget it. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
        ),
        offered::<terminal::WriteParams>(
            "terminal.write",
            "Type base64 `data` into a Terminal you or your Reach own. During Takeover, a waiting receipt means accepted, not executed; read agent_actionHistory for its outcome.",
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
        agent_context(),
        agent_wake(),
        agent_set_order(),
        agent_run(),
        ask_user(),
        agent_spawn(),
    ]
}

/// F3, A26: the tool every Agent is offered; its child sits under it.
fn agent_spawn() -> Offered {
    offered::<agent::SpawnParams>(
        "agent.spawn",
        "Start a child Agent in a folder of this Project. Put a `title` of at most six words, the one-sentence ask, the done condition and the limits in `order`, and the working detail in `prompt`; a `prompt` without an `order` is refused. Name the child after its task. The child's Home is you.",
    )
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

    /// U468: keep agent.ask as the waiting call. The vendor renders a standard
    /// MCP form; its in-process callback, not this Agent's shim, delivers the answer.
    async fn terminal_question(
        &self,
        arguments: Option<JsonObject>,
        context: &RequestContext<RoleServer>,
    ) -> Result<Result<String, RpcError>, Gone> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let question: decision::AskParams =
            match rpc::params(Value::Object(arguments.unwrap_or_default())) {
                Ok(question) => question,
                Err(error) => return Ok(Err(error)),
            };
        let terminal = format!(
            "{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let mut client = self.connect().await?;
        tokio::time::timeout(CALL_TIMEOUT, client.request("events.subscribe", ()))
            .await
            .map_err(|_| Gone::Silent)?
            .map_err(|error| Gone::Unreachable(error.to_string()))?;
        let caller = self.connect().await?;
        let call = caller.request(
            "agent.ask",
            decision::AskCall {
                question: question.clone(),
                terminal: Some(terminal.clone()),
            },
        );
        tokio::pin!(call);
        let opened = tokio::time::timeout(CALL_TIMEOUT, async {
            loop {
                tokio::select! {
                    reply = &mut call => return Err(reply),
                    event = client.next_event() => {
                        let Some(event) = event else { return Err(Err(RpcError::internal("question event connection closed"))); };
                        if let contracts::EventData::DecisionOpened(opened) = event.data {
                            let decision = *opened;
                            if decision.agent == self.actor.id
                                && serde_json::from_str::<decision::AskCall>(&decision.args)
                                    .is_ok_and(|input| input.terminal.as_deref() == Some(terminal.as_str()))
                            { return Ok(decision); }
                        }
                    }
                }
            }
        }).await.map_err(|_| Gone::Silent)?;
        let opened = match opened {
            Ok(opened) => opened,
            Err(reply) => return Ok(reply.map(|value| value.to_string())),
        };
        let field = format!("roundup_{}", opened.id);
        let schema = serde_json::json!({
            "type":"object", "properties": {
                field.clone(): {"type":"string","title":"Answer", "description":"Type a listed answer, or your own words.", "minLength":1, "maxLength":2000},
                "note": {"type":"string","title":"Note", "maxLength":2000}
            }, "required":[field]
        });
        let schema = ElicitationSchema::from_json_schema(
            schema
                .as_object()
                .expect("the form schema is an object")
                .clone(),
        )
        .map_err(|error| Gone::Unreachable(error.to_string()))?;
        let mut message = question.question;
        for answer in question.answers {
            use std::fmt::Write;
            let _ = write!(message, "\n{} — {}", answer.label, answer.description);
            if let Some(preview) = answer.preview {
                let _ = write!(message, "\n{preview}");
            }
        }
        let request = ElicitRequestParams::FormElicitationParams {
            meta: None,
            message,
            requested_schema: schema,
        };
        let mut form = tokio::time::timeout(
            CALL_TIMEOUT,
            context.peer.send_cancellable_request(
                ServerRequest::ElicitRequest(rmcp::model::Request::new(request)),
                rmcp::service::PeerRequestOptions::no_options(),
            ),
        )
        .await
        .map_err(|_| Gone::Silent)?
        .map_err(|error| Gone::Unreachable(error.to_string()))?;
        tokio::select! {
            reply = &mut call => {
                match tokio::time::timeout(CALL_TIMEOUT, form.cancel(Some("the original question ended".into()))).await {
                    Ok(Ok(())) => {},
                    Ok(Err(error)) => eprintln!("rup: native question cancellation failed after the original ended: {error}"),
                    Err(_) => eprintln!("rup: the original question ended; native form cancellation is uncertain"),
                }
                Ok(reply.map(|value| value.to_string()))
            }
            reply = &mut form.rx => {
                match reply {
                    Ok(Ok(rmcp::model::ClientResult::ElicitResult(result))) if result.action == rmcp::model::ElicitationAction::Accept => {
                        // The result hook must have authenticated and delivered it first.
                        // Never turn an Agent-origin form reply into decision.answer.
                        tokio::time::timeout(CALL_TIMEOUT, &mut call).await
                            .map(|reply| reply.map(|value| value.to_string())).map_err(|_| Gone::Silent)
                    }
                    _ => Ok(Err(RpcError::conflict("the Terminal question was dismissed or its native callback failed"))),
                }
            }
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
        tokio::time::timeout(CALL_TIMEOUT, client.request(offer.method, &params))
            .await
            .map(|reply| reply.map(|result| success_text(offer.method, &params, result)))
            .map_err(|_| Gone::Silent)
    }
}

impl ServerHandler for Shim {
    // U468 keeps one live tools/call while the native form is open. Claude's
    // modern protocol rejects server-initiated elicitation/create; negotiate the
    // SDK's supported 2025 revision rather than advertising that unimplemented era.
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
        context: RequestContext<RoleServer>,
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
        let result = if offer.waits_for_user
            && context
                .client_capabilities()
                .and_then(|capabilities| capabilities.elicitation)
                .is_some_and(|capability| capability.form.is_some() || capability.url.is_none())
        {
            self.terminal_question(request.arguments, &context).await
        } else {
            self.call(offer, request.arguments).await
        };
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
        shim.tools = tools(true);
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
mod tests {
    use super::*;

    #[test]
    fn o9_the_brief_and_the_tool_description_name_order_and_prompt() {
        let description = agent_spawn()
            .tool
            .description
            .unwrap_or_default()
            .to_string();
        assert!(
            description.contains("`order`") && description.contains("`prompt`"),
            "{description}"
        );
    }
}
