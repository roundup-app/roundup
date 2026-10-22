//! LK1–LK3: `link.read`, the content now of the object a `roundup://` URL names. Every read goes
//! through the method of that kind as the caller, so a link gives no caller more than that method.

use contracts::link::{LinkContent, LinkUrl};
use contracts::{agent, deliverable, pad, terminal, todo};
use rpc::{RpcError, code, params};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::{Conn, Daemon};

enum Target {
    Deliverable(String),
    Pad(String),
    Todo(u32),
    Agent(String),
    Workstream(String),
    Terminal(String),
}

fn invalid(part: impl std::fmt::Display) -> RpcError {
    RpcError::new(code::INVALID_PARAMS, format!("not a link: {part}"))
}

/// The object a link names, the Project key it carries and, for a Pad, the heading it ends in (LK4).
fn parse(url: &str) -> Result<(Target, String, Option<String>), RpcError> {
    let url =
        url::Url::parse(url).map_err(|err| invalid(format!("the URL does not parse ({err})")))?;
    if url.scheme() != "roundup" {
        return Err(invalid(format!(
            "the scheme is `{}`, not `roundup`",
            url.scheme()
        )));
    }
    let kind = url.host_str().unwrap_or_default().to_owned();
    if !matches!(
        kind.as_str(),
        "pad" | "todo" | "agent" | "workstream" | "terminal" | "deliverable"
    ) {
        return Err(invalid(format!(
            "the kind `{kind}` is not pad, todo, agent, workstream, terminal or deliverable"
        )));
    }
    let mut segments = url.path().strip_prefix('/').unwrap_or_default().split('/');
    let id = segments.next().unwrap_or_default();
    if id.is_empty() {
        return Err(invalid("the id is missing"));
    }
    if segments.next().is_some() {
        return Err(invalid("the path has an extra segment after the id"));
    }
    let id = percent_encoding::percent_decode_str(id)
        .decode_utf8()
        .map_err(|_| invalid("the id is not UTF-8"))?
        .into_owned();
    let mut key = None;
    for (name, value) in url.query_pairs() {
        if name != "project" {
            return Err(invalid(format!("the parameter `{name}` is not `project`")));
        }
        if key.replace(value.into_owned()).is_some() {
            return Err(invalid("`project` is given twice"));
        }
    }
    let key = key
        .filter(|key| !key.is_empty())
        .ok_or_else(|| invalid("the `project` parameter is missing"))?;
    let heading = url
        .fragment()
        .map(|fragment| {
            percent_encoding::percent_decode_str(fragment)
                .decode_utf8()
                .map(std::borrow::Cow::into_owned)
                .map_err(|_| invalid("the fragment is not UTF-8"))
        })
        .transpose()?;
    if let Some(fragment) = heading.as_deref().filter(|_| kind != "pad") {
        return Err(invalid(format!(
            "the fragment `#{fragment}` is only for a pad link"
        )));
    }
    let target = match kind.as_str() {
        "deliverable" => Target::Deliverable(id),
        "pad" => Target::Pad(id),
        "todo" => Target::Todo(
            id.parse()
                .map_err(|_| invalid(format!("the Todo id `{id}` is not a whole number")))?,
        ),
        "agent" => Target::Agent(id),
        "workstream" => Target::Workstream(id),
        _ => Target::Terminal(id),
    };
    Ok((target, key, heading))
}

impl Daemon {
    pub(crate) async fn link_read(&self, conn: &mut Conn, args: Value) -> Result<Value, RpcError> {
        let LinkUrl { url } = params(args)?;
        let (target, key, heading) = parse(&url)?;
        // Publications carry their stored Project identity; their reader checks it rather than
        // the current-content link key, so neither identity can substitute for the other.
        if !matches!(&target, Target::Deliverable(_)) && key != self.project_key {
            return Err(RpcError::new(
                code::NOT_FOUND,
                format!("the link belongs to another Project, `{key}`"),
            ));
        }
        let content = match target {
            Target::Deliverable(id) => {
                let args = json!({ "project": key, "id": id });
                let record: deliverable::Deliverable = self
                    .read_as(conn, "deliverable", &id, "deliverable.get", args.clone())
                    .await?;
                let resolution: deliverable::Resolution = self
                    .read_as(conn, "deliverable", &id, "deliverable.resolve", args)
                    .await?;
                LinkContent::Deliverable { record, resolution }
            }
            Target::Pad(id) => {
                let pad: pad::Pad = self
                    .read_as(conn, "pad", &id, "pad.read", json!({ "name": id }))
                    .await?;
                let section = heading
                    .map(|heading| {
                        pads::section::find(&pad.text, &pads::section::wanted(&heading))
                            .map(|found| contracts::link::Section {
                                heading: found.heading,
                                text: found.text,
                            })
                            .ok_or_else(|| {
                                RpcError::new(
                                    code::NOT_FOUND,
                                    format!("not found: pad {id} has no heading \"{heading}\""),
                                )
                            })
                    })
                    .transpose()?;
                LinkContent::Pad { id, pad, section }
            }
            Target::Todo(number) => {
                let id = number.to_string();
                let todo: todo::Todo = self
                    .read_as(conn, "todo", &id, "todo.get", json!({ "id": number }))
                    .await?;
                LinkContent::Todo { id, todo }
            }
            Target::Terminal(id) => {
                let screen: terminal::Screen = self
                    .read_as(conn, "terminal", &id, "terminal.screen", json!({ "id": id }))
                    .await
                    .map_err(|err| {
                        if matches!(err.code, code::NOT_FOUND | code::INVALID_PARAMS) {
                            RpcError::new(
                                code::NOT_FOUND,
                                format!("terminal {id} not found: a Terminal ends with the Daemon, so a link to one does not outlive it"),
                            )
                        } else {
                            err
                        }
                    })?;
                LinkContent::Terminal { id, screen }
            }
            Target::Agent(id) => {
                let node = self.node(&id, false).await?;
                let digest = match self
                    .read_as(conn, "agent", &id, "agent.digest", json!({ "id": id }))
                    .await
                {
                    Ok(digest) => Some(digest),
                    Err(err) if err.code == code::CONFLICT => None,
                    Err(err) => return Err(err),
                };
                LinkContent::Agent { id, node, digest }
            }
            Target::Workstream(id) => {
                let node = self.node(&id, true).await?;
                let children = self
                    .rail()
                    .await?
                    .into_iter()
                    .filter(|child| child.parent.as_deref() == Some(&id))
                    .map(|child| child.id)
                    .collect();
                LinkContent::Workstream { id, node, children }
            }
        };
        rpc::reply(&content)
    }

    /// The Rail row of `id`, when it is a Workstream (`workstream`) or an Agent.
    async fn node(&self, id: &str, workstream: bool) -> Result<agent::RailNode, RpcError> {
        let is_workstream = |node: &agent::RailNode| node.kind == agent::NodeKind::Workstream;
        self.rail()
            .await?
            .into_iter()
            .find(|node| node.id == id && is_workstream(node) == workstream)
            .ok_or_else(|| {
                let kind = if workstream { "workstream" } else { "agent" };
                RpcError::new(code::NOT_FOUND, format!("not found: {kind} {id}"))
            })
    }

    /// Call `method` for the caller, naming the `kind` and `id` when it is not found.
    async fn read_as<T: DeserializeOwned>(
        &self,
        conn: &mut Conn,
        kind: &str,
        id: &str,
        method: &str,
        args: Value,
    ) -> Result<T, RpcError> {
        let value = Box::pin(self.route(conn, method, args))
            .await
            .map_err(|err| {
                if err.code == code::NOT_FOUND && !err.message.contains(kind) {
                    RpcError::new(code::NOT_FOUND, format!("not found: {kind} {id}"))
                } else {
                    err
                }
            })?;
        serde_json::from_value(value).map_err(RpcError::internal)
    }
}
