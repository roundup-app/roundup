//! E1: the Brief, the text file Claude Code appends to its system prompt. It holds only what is the same
//! for every Agent of a role (E9): that roundup supervises it, the tools `rup mcp` offers and,
//! for a Door, B24's role guidance. A name, Terminal id, parent, peer or Todo changes, so none is
//! written here. A tool is described only once `crates/rup` offers it, and `agent_digest` and `checkpoint_write` only to a Door.

/// What an Agent is to roundup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// Any Agent started by `agent.spawn`.
    Agent,
    /// A Workstream's Door, started by `rail.startDoor`.
    Door,
    /// P11: the one Agent a Pad's Drawer asks; its Brief names the Pad.
    Scribe,
}

/// The tools `rup mcp` offers, with when to use each.
const TOOLS: [(&str, &str); 22] = [
    ("todo_create", "record a piece of work that is not done yet"),
    ("todo_get", "read one Todo before changing it"),
    ("todo_list", "see all the work already recorded"),
    (
        "todo_update",
        "change a Todo's title or body as the work becomes clearer",
    ),
    ("todo_complete", "mark a Todo done once its outcome is real"),
    (
        "todo_setBlockers",
        "replace the Todos that must finish before this one",
    ),
    (
        "pad_create",
        "start a Pad, a named text you own, for notes you want to keep",
    ),
    ("pad_read", "read one Pad"),
    ("pad_list", "see which Pads exist"),
    ("pad_write", "rewrite a Pad you own"),
    ("pad_append", "add text to the end of any Pad"),
    ("pad_setOwner", "give a Pad to another Actor"),
    ("pad_delete", "delete a Pad you no longer need"),
    (
        "checkpoint_list",
        "read the Checkpoints written for a Workstream, oldest first",
    ),
    (
        "agent_context",
        "ask where you stand now: who you report to, whom to ask, your peers and your open Todos, for instance after you were moved",
    ),
    (
        "agent_set_order",
        "replace your own order: a Work order once the ask is clear, or a Clarification order while a question is open",
    ),
    (
        "message_send",
        "send a note, question or request to another Agent or the user; it is delivered when the receiver is next idle",
    ),
    ("message_get", "read one Message you sent or received"),
    ("message_list", "see the Messages you sent or received"),
    (
        "message_pass",
        "hand a question you received on to the next Agent above, when it is not yours to answer",
    ),
    (
        "ask_user",
        "put a question to the user with one to four short answers to pick from, and wait for the one they pick",
    ),
    (
        "agent_spawn",
        "start a child Agent in a folder of this Project, with an optional first prompt; it becomes your child",
    ),
];

/// The tools beyond `TOOLS` that only a Door is offered: B20's digest and M10's `checkpoint_write`.
const DOOR_TOOLS_EXTRA: [(&str, &str); 2] = [
    (
        "agent_digest",
        "ask what each of your direct children did: its Kind, its last line, its open Todos and the Pads it wrote since you were last told",
    ),
    (
        "checkpoint_write",
        "mark a point in the work with a short card of facts for the user, when an Agent's work finishes or merges, the direction changes or a decision is made",
    ),
];

const DOOR: &str = "\
## Your role

You are this Workstream's coordinating Door. Use the Todo tools to record the work and update it as it changes. \
Report the outcome to the user with `message_send` to `you` when the work ends. \
When the user's goal or a taste limit is unclear, ask it with `message_send` to `you` with `kind` `question`, then wait for the reply Message. \
The user reads and answers your Messages in the Workstream's Thread, not your Terminal. \
You have no shell and cannot edit files: your children do the work. \
Start a child with `agent_spawn` and talk to it with `message_send`. \
Give each child a `name` after its task. \
Write a Checkpoint with `checkpoint_write` when the work reaches a point worth marking: an Agent's work finished or merged, a change of direction, a decision made. \
Run `reduce` on every string and lay the Blocks out the `show-me` way, choosing the rows, table, diagram or text that suits what happened. \
Put nothing in a Checkpoint that the Thread's feed already shows.
";

/// P11: what a Scribe is told about its Pad. `pad` is the Pad's name, which the Brief carries.
fn scribe(pad: &str) -> String {
    format!(
        "## Your role\n\n\
         You are the Scribe of the Pad `{pad}`. The user asks you about it or asks you to change it in your prompts. \
         Read it with `pad_read`, rewrite it with `pad_write` when the user asks for an edit, and answer the user with `message_send` to `you`. \
         You may rewrite no other Pad.\n"
    )
}

/// E9: the Brief text for `role`, the same bytes for every Agent of it, so sessions share one
/// prompt cache. The Agent's id reaches it in its Context at start (E3).
pub fn text(role: Role, pad: Option<&str>) -> String {
    let mut text = String::from(
        "# roundup\n\n\
         roundup started you and supervises you; the user can see your Status and your Messages. \
         Your id and where you stand are in the Context you get at start; the id never changes.\n\n\
         ## Tools\n\n\
         The `roundup` MCP server offers these tools:\n\n",
    );
    let door: &[(&str, &str)] = if role == Role::Door {
        &DOOR_TOOLS_EXTRA
    } else {
        &[]
    };
    for &(name, when) in TOOLS.iter().chain(door) {
        text.push_str(&format!("- `{name}`: {when}.\n"));
    }
    if role == Role::Door {
        text.push('\n');
        text.push_str(DOOR);
    }
    if let (Role::Scribe, Some(pad)) = (role, pad) {
        text.push('\n');
        text.push_str(&scribe(pad));
    }
    text
}
