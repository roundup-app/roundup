//! `rup mcp <agent-id>`: Todos, Pads and Messages as MCP tools for one Agent, over stdio.
//! Every call reaches the Daemon on its own connection identified as that Agent, so it is a Touch by that Agent.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use contracts::{
    Actor, ActorKind, HistoryParams, IdentifyParams, TouchedParams, agent, checkpoint, decision,
    message, pad, project, todo,
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
const CALL_TIMEOUT: Duration = Duration::from_secs(10);

/// `ttlMs` and `cacheScope` are required by the client's `tools/list` schema (M4). The tool set is fixed for
/// the life of this process, so the reply is `public` and fresh for an hour.
const TOOLS_TTL_MS: u64 = 3_600_000;

struct Offered {
    method: &'static str,
    tool: Tool,
    takes_params: bool,
    /// E4: the params are `{id}` with the shim's own Agent id, and the tool takes no input.
    own_id: bool,
    /// H14: the call waits for the user, so no `CALL_TIMEOUT` applies and its result is the answer's text.
    waits_for_user: bool,
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
            "Ask the user a question with one to four short answers to pick from. Waits for the user and returns the answer they picked.",
            schema,
        ),
        takes_params: true,
        own_id: false,
        waits_for_user: true,
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
    }
}

/// E4: `agent.context` takes `{id}`; the shim fills it, so the Agent's tool takes no input.
fn agent_context() -> Offered {
    Offered {
        own_id: true,
        ..offered_without_params(
            "agent.context",
            "Ask where you stand now: whom you report to, whom to ask, your peers and your open Todos.",
        )
    }
}

/// B20: `agent.digest` takes `{id}`; the shim fills it, so a Door's tool takes no input.
fn agent_digest() -> Offered {
    Offered {
        own_id: true,
        ..offered_without_params(
            "agent.digest",
            "Ask what each of your direct children did: its Kind, its last line, its open Todos and the Pads it wrote since you were last told.",
        )
    }
}

/// M10: only a Door writes a Checkpoint.
fn checkpoint_write() -> Offered {
    offered::<checkpoint::WriteParams>(
        "checkpoint.write",
        "Write a Checkpoint: a short card of facts for the user, with a title and one to eight Blocks (rows, table, diagram or text) you choose to suit what happened.",
    )
}

/// H21: `decision.answer` takes `{id, answer}`; an Agent has no `proof` to send, and the Daemon
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
            "Answer an open Decision of an Agent below you: `allow` or `deny` for a permission request, one of the listed answers for an `ask_user` question. Never your own.",
            schema,
        ),
        ..offer("decision.answer", "", JsonObject::new(), true)
    }
}

/// O4: `agent.setOrder` takes `{id, order}`; the shim fills `id`, so the Agent's tool takes only
/// `order`.
fn agent_set_order() -> Offered {
    let Ok(Value::Object(mut schema)) =
        serde_json::to_value(schemars::schema_for!(agent::SetOrderParams))
    else {
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
        tool: Tool::new(
            "agent_set_order",
            "Replace your own order: a Work order once the ask is clear, or a Clarification order while a question is open.",
            schema,
        ),
        ..offer("agent.setOrder", "", JsonObject::new(), true)
    }
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
        offered::<agent::RenameParams>("rail.rename", "Rename yourself or a node in your Reach."),
        offered::<agent::MoveParams>(
            "rail.move",
            "Move a node in your Reach: an Agent under a Workstream or Agent, a Workstream only to the root.",
        ),
        offered::<agent::NodeId>(
            "rail.remove",
            "Remove a node in your Reach, never yourself. Its children move to its parent.",
        ),
        offered::<agent::NodeId>("agent.stop", "Stop an Agent in your Reach, never yourself."),
        offered::<agent::NodeId>(
            "agent.interrupt",
            "Interrupt the turn of an Agent in your Reach.",
        ),
        offered::<agent::PromptParams>(
            "agent.prompt",
            "Send a prompt to an Agent in your Reach as the user would.",
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
        agent_context(),
        agent_set_order(),
        ask_user(),
        agent_spawn(),
    ]
}

/// F3, A26: the tool every Agent is offered; its child sits under it.
fn agent_spawn() -> Offered {
    offered::<agent::SpawnParams>(
        "agent.spawn",
        "Start a child Agent in a folder of this Project. Put the one-sentence ask, the done condition and the limits in `order`, and the working detail in `prompt`; a `prompt` without an `order` is refused. Name the child after its task. The child's Home is you.",
    )
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

    /// B20: whether this Agent is a Door, a Workstream's Door, which the Rail shows as a
    /// Workstream node with its own id. A Daemon that cannot say leaves the tool out, and says so.
    async fn is_door(&self, start: &rpc::Client) -> bool {
        let tree = start.request("rail.tree", Value::Null);
        match tokio::time::timeout(CALL_TIMEOUT, tree).await {
            Ok(Ok(tree)) => {
                serde_json::from_value::<Vec<agent::RailNode>>(tree).is_ok_and(|nodes| {
                    nodes.iter().any(|node| {
                        node.id == self.actor.id && node.kind == agent::NodeKind::Workstream
                    })
                })
            }
            Ok(Err(err)) => {
                eprintln!("rup: the Daemon would not show the Rail, so no digest tool: {err}");
                false
            }
            Err(_) => {
                eprintln!(
                    "rup: no answer to the Rail within {}s, so no digest tool",
                    CALL_TIMEOUT.as_secs()
                );
                false
            }
        }
    }

    /// E6: tell the Daemon this Agent's `rup mcp` is up, once, on the start connection (after its
    /// `daemon.identify`) and before any tool call. A refusal or silence is one line on stderr:
    /// the tools still work, and the Daemon's Channel says `missing` on its own.
    async fn report_channel(&self, start: &rpc::Client) {
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
    ) -> Result<Result<Value, RpcError>, Gone> {
        let params = match (offer.takes_params, offer.own_id, arguments) {
            (false, true, _) => serde_json::json!({ "id": self.actor.id }),
            (true, true, arguments) => {
                let mut arguments = arguments.unwrap_or_default();
                arguments.insert("id".into(), self.actor.id.clone().into());
                Value::Object(arguments)
            }
            (true, false, arguments) => Value::Object(arguments.unwrap_or_default()),
            (false, false, _) => Value::Null,
        };
        let client = self.connect().await?;
        if offer.waits_for_user {
            return Ok(client.request(offer.method, params).await);
        }
        tokio::time::timeout(CALL_TIMEOUT, client.request(offer.method, params))
            .await
            .map_err(|_| Gone::Silent)
    }
}

impl ServerHandler for Shim {
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
        let offer = self
            .tools
            .iter()
            .find(|offer| offer.tool.name == request.name)
            .ok_or_else(|| {
                ErrorData::invalid_params(format!("no tool named {}", request.name), None)
            })?;
        match self.call(offer, request.arguments).await {
            Ok(Ok(result)) => {
                let text = match result["answer"].as_str() {
                    Some(answer) if offer.waits_for_user => answer.to_owned(),
                    _ => result.to_string(),
                };
                Ok(CallToolResult::success(vec![ContentBlock::text(text)]).into())
            }
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

pub async fn run(agent_id: Option<String>) -> ExitCode {
    let Some(id) = agent_id else {
        eprintln!("usage: rup mcp <agent-id>");
        return ExitCode::from(2);
    };
    match serve(id).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(why) => {
            eprintln!("rup: {why}");
            // Returning would block in runtime shutdown on the pending stdin read until the client closes the pipe.
            std::process::exit(1)
        }
    }
}

async fn serve(id: String) -> Result<(), String> {
    let socket = rpc::socket_path().map_err(|err| err.to_string())?;
    let (gone, mut gone_rx) = mpsc::channel(1);
    let mut shim = Shim {
        socket,
        actor: Actor {
            kind: ActorKind::Agent,
            id,
            parent: None,
        },
        tools: offered_tools(),
        gone,
    };
    let start = shim.connect().await.map_err(|gone| gone.to_string())?;
    // Both wait on the same Daemon, so a mute one costs one `CALL_TIMEOUT`, not two.
    let (meta, ()) = tokio::join!(shim.is_door(&start), shim.report_channel(&start));
    if meta {
        shim.tools.push(agent_digest());
        shim.tools.push(checkpoint_write());
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
