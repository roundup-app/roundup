//! `rup mcp <agent-id>`: Todos, Pads and Messages as MCP tools for one Agent, over stdio.
//! Every call reaches the Daemon on its own connection identified as that Agent, so it is a Touch by that Agent.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use contracts::bubble_rule;
use contracts::{Actor, ActorKind, IdentifyParams, agent, checkpoint, terminal, workstream};
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

/// A Todo or Pad call is a few SQLite statements; past this the Daemon is wedged, and a hung tool call would hang the Agent's turn.
pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(10);

/// `ttlMs` and `cacheScope` are required by the client's `tools/list` schema (M4). The tool set is fixed for
/// the life of this process, so the reply is `public` and fresh for an hour.
#[macro_use]
mod agent_tools;
use agent_tools::{
    agent_context, agent_digest, agent_extras, agent_extras_add, agent_set_order, agent_spawn,
    agent_wake, checkpoint_write, workstream_rewind, workstream_rewind_plan,
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

/// The Daemon cannot be spoken to; the call fails with a tool error and the next call connects afresh (M5179).
#[derive(Debug)]
enum Gone {
    /// Nothing was sent.
    Unreachable(String),
}

impl std::fmt::Display for Gone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Gone::Unreachable(why) => f.write_str(why),
        }
    }
}

fn offered<P: JsonSchema>(method: &'static str, description: &'static str) -> Offered {
    let Ok(Value::Object(schema)) = serde_json::to_value(schemars::schema_for!(P)) else {
        unreachable!("a params struct's schema is an object");
    };
    offer(method, description, schema, true)
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
        tool: Tool::new(
            method.replace('.', "_"),
            format!(
                "{description} Agent references accept `me` (you), an exact case-sensitive Rail name, `name:<Rail name>` for collisions, or a canonical id. Owner fields also accept explicit Actors; omitted/null Todo owners remain Unassigned."
            ),
            schema,
        ),
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
    list.retain(|offer| door || !offer.door_only);
    list
}

/// M5: one tool for each method of its first list; the methods left out are in its second, with their reasons (`scenarios/mcp.md`).
macro_rules! push_tool {
    ($list:ident, $wire:literal, none()) => {};
    ($list:ident, $wire:literal, all($($tool:tt)*)) => { push_tool!(@offer $list, $wire, false, $($tool)*); };
    ($list:ident, $wire:literal, door($($tool:tt)*)) => { push_tool!(@offer $list, $wire, true, $($tool)*); };
    (@offer $list:ident, $wire:literal, $door:expr, schema($schema:ty, $description:expr)) => {
        $list.push(Offered { door_only: $door, ..offered::<$schema>($wire, $description) });
    };
    (@offer $list:ident, $wire:literal, $door:expr, empty($description:expr)) => {
        $list.push(Offered { door_only: $door, ..offered_without_params($wire, $description) });
    };
    (@offer $list:ident, $wire:literal, $door:expr, custom($offer:expr)) => {
        $list.push(Offered { door_only: $door, ..$offer });
    };
}
macro_rules! declared_tools {
    ([] $($wire:literal: $params:ty => $result:ty, $handler:ident, $role:ident($($tool:tt)*);)*) => {{
        let mut list = Vec::new();
        $(push_tool!(list, $wire, $role($($tool)*));)*
        list
    }};
}
fn offered_tools() -> Vec<Offered> {
    contracts::all_methods!(declared_tools)
}

// Resolve before actions: discard removes the node, so a lookup after success loses its name.
// These parameters are for rendering; the request keeps the original machine ids.
pub(crate) async fn display_params(
    client: &rpc::Client,
    method: &str,
    params: &Value,
) -> Result<Value, RpcError> {
    if !matches!(method, "agent.discard" | "rail.move") {
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
        // A Door asks the user; only an Agent destination needs a Rail name.
        "agent.context" if result["ask"]["to"].as_str().is_some_and(|to| to != "you") => {
            let nodes = rail_nodes(client).await?;
            result["ask"]["name"] = rail_name(&nodes, &result["ask"]["to"]).into();
        }
        _ => {}
    }
    Ok(result)
}

/// M17: only declared unit replies become acknowledgements; nullable data stays JSON.
pub(crate) fn success_text(method: &str, params: &Value, result: Value) -> String {
    let unit = contracts::methods::METHODS
        .iter()
        .any(|m| m.name == method && m.result == "null");
    if !unit {
        return result.to_string();
    }
    let field = |key: &str| match &params[key] {
        Value::String(text) => text.clone(),
        value => value.to_string(),
    };
    let id = field("id");
    match method {
        "deliverable.remove" => format!("removed publication {id}"),
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
        // M5159a: a silent Daemon fails this call alone; the shim stays up for the next one.
        let Ok(result) =
            tokio::time::timeout(CALL_TIMEOUT, client.request(offer.method, &params)).await
        else {
            return Ok(Err(RpcError::unknown_outcome(format!(
                "{} got no answer from the Daemon within {} s; the work may still finish",
                offer.tool.name,
                CALL_TIMEOUT.as_secs()
            ))));
        };
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
                let mut body = serde_json::to_string(&err)
                    .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;
                // M5179: the request went out and no answer came.
                if err.code == rpc::code::UNKNOWN_OUTCOME {
                    body = format!("{}: {body}; the call may have been applied", request.name);
                }
                Ok(CallToolResult::error(vec![ContentBlock::text(body)]).into())
            }
            Err(gone) => {
                let applied = match gone {
                    Gone::Unreachable(_) => "; the call was not sent",
                };
                Ok(CallToolResult::error(vec![ContentBlock::text(format!(
                    "{}: {gone}{applied}",
                    request.name
                ))])
                .into())
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
    let mut shim = Shim {
        socket,
        actor,
        tools: tools(false),
    };
    let start = shim.connect().await.map_err(|gone| gone.to_string())?;
    // Both wait on the same Daemon, so a mute one costs one `CALL_TIMEOUT`, not two.
    let (meta, ()) = tokio::join!(shim.is_door(&start), shim.report_channel(&start));
    if meta {
        shim.tools = door_tools();
    }
    if let Ok(guide) = std::env::var("ROUNDUP_NAMING_GUIDE") {
        for offer in &mut shim.tools {
            if offer.method == "agent.spawn" {
                let description = offer.tool.description.as_deref().unwrap_or_default();
                offer.tool.description = Some(format!(
                    "{description} Naming guide: {guide} Supply an optional name, trimmed and at most 32 characters; sibling collisions receive a suffix. When name is omitted, the first prompt names the child if Automatic renaming is on, otherwise it keeps its current name."
                ).into());
            }
        }
    }
    drop(start);
    let running = shim
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|err| err.to_string())?;
    running
        .waiting()
        .await
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod c4_policy;
