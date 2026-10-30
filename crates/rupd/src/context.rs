//! E2, E3: what an Agent is told about where it stands. The Daemon composes it here from the Rail
//! and the Todos, which only it holds together; `agents` owns the vendor's words for the text.

use contracts::agent::{
    Context, ContextAsk, ContextParent, ContextPeer, ContextSelf, ContextTodo, NodeKind,
    ParentNode, RailNode,
};
use contracts::todo::Todo;
use contracts::{Actor, ActorKind, Kind};
use rpc::RpcError;

/// An Agent, or a Workstream whose Door has run: only these have a Context.
fn is_agent(node: &RailNode) -> bool {
    match node.kind {
        NodeKind::Agent => true,
        NodeKind::Workstream => node.attempt.is_some(),
    }
}

/// E2: the Context of Agent `id`. `nodes` is `rail.tree`, in Rail order.
pub(crate) fn compose(nodes: &[RailNode], todos: &[Todo], id: &str) -> Result<Context, RpcError> {
    let node = nodes
        .iter()
        .find(|node| node.id == id && is_agent(node))
        .ok_or_else(|| RpcError::not_found("an Agent that is gone"))?;
    let status = |node: &RailNode| {
        node.status
            .clone()
            .ok_or_else(|| RpcError::internal(format!("{} has no Status", node.name)))
    };
    let parent = node
        .parent
        .as_deref()
        .and_then(|parent| nodes.iter().find(|candidate| candidate.id == parent));
    let ask = match parent {
        Some(parent) if is_agent(parent) => parent.id.clone(),
        _ => Actor::user().id,
    };
    let peers = nodes
        .iter()
        .filter(|peer| peer.parent == node.parent && peer.id != node.id && is_agent(peer))
        .map(|peer| {
            Ok(ContextPeer {
                id: peer.id.clone(),
                name: peer.name.clone(),
                status: status(peer)?,
            })
        })
        .collect::<Result<_, RpcError>>()?;
    let todos = todos
        .iter()
        .filter(|todo| {
            let is_node = |actor: &Actor| actor.kind == ActorKind::Agent && actor.id == node.id;
            !todo.done
                && match &todo.owner {
                    Some(owner) => is_node(owner),
                    None => is_node(&todo.creator),
                }
        })
        .map(|todo| ContextTodo {
            id: todo.id,
            title: todo.title.clone(),
            blocked: todo.blocked,
        })
        .collect();
    Ok(Context {
        this: ContextSelf {
            id: node.id.clone(),
            name: node.name.clone(),
            status: status(node)?,
            order: node.work.clone(),
        },
        parent: parent.map(|parent| ContextParent {
            id: parent.id.clone(),
            name: parent.name.clone(),
            node: if is_agent(parent) {
                ParentNode::Agent
            } else {
                ParentNode::Group
            },
        }),
        ask: ContextAsk { to: ask },
        peers,
        todos,
    })
}

fn kind_word(kind: Kind) -> &'static str {
    match kind {
        Kind::Error => "error",
        Kind::NeedsYou => "needs-you",
        Kind::Blocked => "blocked",
        Kind::Working => "working",
        Kind::Idle => "idle",
        Kind::Done => "done",
    }
}

/// E3, E9: `context` in words, the Rail name, then one line each for the parent, whom to ask, every peer and every Todo.
/// `door` is whether the Agent to ask is a Workstream's Door; any other Agent is only its parent.
fn words(context: &Context, door: bool) -> String {
    let mut lines = vec![format!(
        "Your Rail name is {}. Say it, never an id, when you speak of yourself or another Agent.",
        context.this.name
    )];
    lines.push(match &context.parent {
        Some(parent) => match parent.node {
            ParentNode::Agent => format!(
                "Parent: {} (message_send {{to}} value: \"{}\"), an Agent.",
                parent.name, parent.id
            ),
            ParentNode::Group => format!("Parent: {}, a Workstream.", parent.name),
        },
        None => "Parent: none, you are at the Project root.".to_owned(),
    });
    if context.ask.to == Actor::user().id {
        lines.push("Ask: the user, with message_send to \"you\".".to_owned());
    } else if let Some(parent) = &context.parent {
        let who = if door { "your Door" } else { "your parent" };
        lines.push(format!(
            "Ask: {}, {who}, using the destination above.",
            parent.name
        ));
    }
    if context.peers.is_empty() {
        lines.push("Peers: none.".to_owned());
    }
    for peer in &context.peers {
        lines.push(format!(
            "Peer: {} (message_send {{to}} value: \"{}\"), {}.",
            peer.name,
            peer.id,
            kind_word(peer.status.kind)
        ));
    }
    if context.todos.is_empty() {
        lines.push("Todos: none open.".to_owned());
    }
    for todo in &context.todos {
        let blocked = if todo.blocked { " (blocked)" } else { "" };
        lines.push(format!("Todo {}: {}{blocked}.", todo.id, todo.title));
    }
    lines.join("\n")
}

/// Naming instructions belong beside the live Rail identity, never in a shared Brief file.
pub(crate) fn naming(
    text: String,
    settings: &contracts::project::NamingSettings,
    settled: bool,
) -> String {
    let action = if !settings.automatic_renaming {
        "Automatic self-naming is off. Keep your current name; do not rename yourself automatically."
    } else if settled {
        "Automatic self-naming is on. Your name is already chosen: keep it. Never replace an explicit or user-entered name."
    } else {
        "Automatic self-naming is on. Choose your own task name with rail_rename, following the naming guide. Never replace an explicit or user-entered name, including a later user rename."
    };
    let (name, rest) = text.split_once('\n').unwrap_or((&text, ""));
    format!(
        "{name}\n{action}\nNaming guide: {}\n{rest}",
        settings.naming_guide
    )
}

/// E3: what `rup context` prints for `context`'s Agent, in the vendor's own shape.
#[cfg(test)]
pub(crate) fn brief(nodes: &[RailNode], context: &Context) -> contracts::agent::Brief {
    contracts::agent::Brief {
        stdout: agents::claude_code::session_start_context(&text(nodes, context)),
    }
}

pub(crate) fn text(nodes: &[RailNode], context: &Context) -> String {
    let door = nodes
        .iter()
        .any(|node| node.id == context.ask.to && node.kind == NodeKind::Workstream);
    words(context, door)
}

#[cfg(test)]
mod tests {
    use contracts::Status;
    use serde_json::json;

    use super::*;

    fn status(kind: Kind) -> Option<Status> {
        Some(Status {
            kind,
            label: "x".into(),
            since: 1,
            finished: "0".into(),
        })
    }

    fn node(id: &str, kind: NodeKind, name: &str, parent: Option<&str>, door: bool) -> RailNode {
        RailNode {
            id: id.into(),
            auto: (kind == NodeKind::Workstream).then_some(false),
            opening_prompt: None,
            kind,
            name: name.into(),
            parent: parent.map(str::to_owned),
            order: 0,
            status: status(Kind::Idle),
            attempt: (kind == NodeKind::Agent || door).then(|| "1".into()),
            status_revision: None,
            terminal_id: None,
            worktree: None,
            can_resume: false,
            yolo: false,
            channel: None,
            stray: Vec::new(),
            model: None,
            effort: None,
            inbox: None,
            tool_call: None,
            overview: None,
            work: Some(contracts::agent::Order::clarification("?")),
        }
    }

    fn todo(id: u32, creator: &str, done: bool, blockers: Vec<u32>, blocked: bool) -> Todo {
        Todo {
            id,
            title: format!("todo {id}"),
            body: String::new(),
            done,
            blockers,
            blocked,
            created_at: 0,
            updated_at: 0,
            creator: Actor {
                kind: ActorKind::Agent,
                id: creator.into(),
                parent: None,
            },
            home: None,
            owner: None,
            refs: vec![],
            estimate_minutes: None,
            priority: None,
        }
    }

    /// Door `m` (a Workstream with a Door) holding `a` and `b`; plain Workstream `g` holding `c`; a
    /// sibling Door `n` beside `m`.
    fn rail() -> Vec<RailNode> {
        vec![
            node("1", NodeKind::Workstream, "m", None, true),
            node("2", NodeKind::Agent, "a", Some("1"), false),
            node("3", NodeKind::Agent, "b", Some("1"), false),
            node("5", NodeKind::Workstream, "g", None, false),
            node("6", NodeKind::Agent, "c", Some("5"), false),
            node("7", NodeKind::Workstream, "n", None, true),
        ]
    }

    #[test]
    fn a26_parent_node_names_no_meta_agent() {
        let context = compose(&rail(), &[], "2").unwrap();

        assert_eq!(
            serde_json::to_value(&context).unwrap(),
            json!({
                "self": {"id": "2", "name": "a", "status": {"kind": "idle", "label": "x", "since": 1,"finished":"0"}, "order": {"kind": "clarification", "question": "?"}},
                "parent": {"id": "1", "name": "m", "node": "agent"},
                "ask": {"to": "1"},
                "peers": [{"id": "3", "name": "b", "status": {"kind": "idle", "label": "x", "since": 1,"finished":"0"}}],
                "todos": [],
            })
        );
    }

    #[test]
    fn e2_an_agent_in_a_plain_group_asks_the_user_and_has_no_peers() {
        let context = compose(&rail(), &[], "6").unwrap();

        assert_eq!(context.ask.to, "you");
        assert!(context.peers.is_empty());
        let parent = context.parent.unwrap();
        assert_eq!((parent.id.as_str(), parent.node), ("5", ParentNode::Group));
    }

    #[test]
    fn e2_an_agent_at_the_project_root_has_no_parent_and_asks_the_user() {
        let mut nodes = rail();
        nodes.push(node("8", NodeKind::Agent, "r", None, false));

        let context = compose(&nodes, &[], "8").unwrap();

        assert_eq!(context.parent, None);
        assert_eq!(context.ask.to, "you");
        // A sibling Door at the root is a peer; a plain Group and a Terminal are not.
        let peers: Vec<_> = context.peers.iter().map(|peer| peer.id.as_str()).collect();
        assert_eq!(peers, ["1", "7"]);
    }

    #[test]
    fn e2_the_todos_are_the_open_ones_the_agent_created() {
        let todos = [
            todo(1, "2", false, vec![], false),
            todo(2, "2", true, vec![], false),
            todo(3, "3", false, vec![], false),
            todo(4, "2", false, vec![1], true),
        ];

        let context = compose(&rail(), &todos, "2").unwrap();

        let seen: Vec<_> = context
            .todos
            .iter()
            .map(|todo| (todo.id, todo.blocked))
            .collect();
        assert_eq!(seen, [(1, false), (4, true)]);
    }

    #[test]
    fn e2_lists_todos_an_agent_owns() {
        let agent = |id: &str| Actor {
            kind: ActorKind::Agent,
            id: id.into(),
            parent: None,
        };
        let mut todos = [
            todo(1, "3", false, vec![], false),
            todo(2, "3", false, vec![], false),
            todo(3, "2", false, vec![], false),
            todo(4, "3", true, vec![], false),
        ];
        todos[0].owner = Some(agent("2"));
        todos[1].owner = Some(Actor::user());
        todos[2].owner = Some(agent("3"));
        todos[3].owner = Some(agent("2"));

        let context = compose(&rail(), &todos, "2").unwrap();

        let seen: Vec<_> = context.todos.iter().map(|todo| todo.id).collect();
        assert_eq!(seen, [1]);
    }

    #[test]
    fn e2_lists_its_unassigned_creations() {
        let mut todos = [
            todo(1, "2", false, vec![], false),
            todo(2, "2", false, vec![], false),
        ];
        todos[1].owner = Some(Actor::user());

        let context = compose(&rail(), &todos, "2").unwrap();

        let seen: Vec<_> = context.todos.iter().map(|todo| todo.id).collect();
        assert_eq!(seen, [1]);
    }

    #[test]
    fn e3_a_subagent_is_told_to_ask_its_parent_not_a_door() {
        let mut nodes = rail();
        nodes.push(node("8", NodeKind::Agent, "s", Some("2"), false));
        let context = compose(&nodes, &[], "8").unwrap();

        let text = words(&context, false);

        assert!(
            text.contains("Parent: a (message_send {to} value: \"2\"), an Agent."),
            "{text}"
        );
        assert!(
            text.contains("Ask: a, your parent, using the destination above."),
            "{text}"
        );
        let stdout = brief(&nodes, &context).stdout;
        assert!(!stdout.contains("Door"), "{stdout}");
    }

    #[test]
    fn e2_a_terminal_a_plain_group_and_a_missing_id_are_not_found() {
        for id in ["4", "5", "99"] {
            let err = compose(&rail(), &[], id).unwrap_err();
            assert_eq!(err.code, rpc::code::NOT_FOUND, "{id}");
        }
    }

    #[test]
    fn e3_the_brief_is_the_vendors_shape_around_one_line_each() {
        let todos = [
            todo(1, "2", false, vec![], false),
            todo(4, "2", false, vec![1], true),
        ];
        let context = compose(&rail(), &todos, "2").unwrap();

        let stdout = brief(&rail(), &context).stdout;

        let shaped: serde_json::Value = serde_json::from_str(&stdout).unwrap();
        assert_eq!(
            shaped["hookSpecificOutput"]["hookEventName"],
            "SessionStart"
        );
        let text = shaped["hookSpecificOutput"]["additionalContext"]
            .as_str()
            .unwrap();
        assert!(text.contains("Todo 1: todo 1."), "{text}");
        assert!(text.contains("Todo 4: todo 4 (blocked)."), "{text}");
    }

    #[test]
    fn e9_the_context_text_starts_with_the_name_line() {
        for kind in [NodeKind::Agent, NodeKind::Workstream] {
            let nodes = [node("7013", kind, "sad", None, true)];
            let context = compose(&nodes, &[], "7013").unwrap();
            let text = words(&context, false);
            assert!(text.starts_with("Your Rail name is sad. Say it, never an id, when you speak of yourself or another Agent.\n"));
            assert!(!text.contains("7013") && !text.contains("Agent id"));
        }
    }

    #[test]
    fn e3_the_brief_of_a_lone_agent_says_so_in_words() {
        let context = compose(&rail(), &[], "6").unwrap();

        let text = words(&context, false);

        assert_eq!(
            text,
            "Your Rail name is c. Say it, never an id, when you speak of yourself or another Agent.\n\
             Parent: g, a Workstream.\n\
             Ask: the user, with message_send to \"you\".\n\
             Peers: none.\n\
             Todos: none open."
        );
    }
    #[test]
    fn e2704a_destinations_follow_names_once() {
        for (kind, who) in [
            (NodeKind::Agent, "your parent"),
            (NodeKind::Workstream, "your Door"),
        ] {
            let nodes = [
                node("7013", NodeKind::Agent, "sad", Some("7014"), false),
                node("7014", kind, "parent", None, true),
                node("7015", NodeKind::Agent, "peer", Some("7014"), false),
            ];
            let words = text(&nodes, &compose(&nodes, &[], "7013").unwrap());
            assert!(!words.contains("7013"), "{words}");
            for (name, id) in [("parent", "7014"), ("peer", "7015")] {
                assert_eq!(words.matches(id).count(), 1, "{words}");
                assert!(
                    words.contains(&format!("{name} (message_send {{to}} value: \"{id}\")")),
                    "{words}"
                );
            }
            assert!(words.contains("Peer: peer (message_send {to} value: \"7015\"), idle."));
            assert!(words.contains(&format!("Ask: parent, {who}, using the destination above.")));
            assert!(!words.contains("Agent id"));
        }
    }

    #[test]
    fn e2704a_root_asks_the_user() {
        let nodes = [node("7013", NodeKind::Agent, "sad", None, false)];
        let text = words(&compose(&nodes, &[], "7013").unwrap(), false);
        assert!(text.contains("Parent: none, you are at the Project root."));
        assert!(text.contains("Ask: the user, with message_send to \"you\"."));
        assert!(!text.contains("7013"));
    }
    #[test]
    fn e2704a_context_digest_and_wake_errors_use_names() {
        let mut nodes = [node("7013", NodeKind::Agent, "sad", None, false)];
        let gone = compose(&nodes, &[], "7014").unwrap_err();
        assert_eq!(gone.code, rpc::code::NOT_FOUND);
        assert_eq!(gone.message, "not found: an Agent that is gone");
        nodes[0].status = None;
        let missing_status = compose(&nodes, &[], "7013").unwrap_err();
        assert_eq!(missing_status.code, rpc::code::INTERNAL);
        assert_eq!(missing_status.message, "sad has no Status");
    }
}
