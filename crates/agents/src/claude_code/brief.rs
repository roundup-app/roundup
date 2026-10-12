//! E1: the Brief, the text file Claude Code appends to its system prompt. It holds only what is the same
//! for every Agent of a role (E9): that roundup supervises it, the tools `rup mcp` offers and,
//! for a Door, B24's role guidance. A name, Terminal id, parent, peer or Todo changes, so none is
//! written here. A tool is described only once `crates/rup` offers it, and `agent_digest`, `workstream_handoff` and `checkpoint_write` only to a Door.

/// What an Agent is to roundup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// Any Agent started by `agent.spawn`.
    Agent,
    /// A Workstream's Door, started by `rail.startDoor`.
    Door,
}

impl Role {
    /// A36: every Role, the one list a Project's Models are set for.
    pub const ALL: [Role; 2] = [Role::Door, Role::Agent];

    /// A36: the Role's name in `project.get` and `project.setModels`.
    pub fn id(self) -> &'static str {
        match self {
            Role::Door => "door",
            Role::Agent => "subagent",
        }
    }
}

/// The tools `rup mcp` offers, with when to use each.
const TOOLS: &[(&str, &str)] = &[
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
        "decision_list",
        "see the open permission requests and `ask_user` questions of the Agents below you",
    ),
    (
        "decision_answer",
        "answer one of those Decisions with `allow` or `deny`, or with one of the listed answers; never your own, never one outside the Agents below you",
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
        "put a decision to the user with up to four answers, each with its tradeoff and a preview, and wait for the answer or the note they give back",
    ),
    (
        "todo_move",
        "move a Todo into a Workstream, or out of every Workstream",
    ),
    (
        "todo_reorder",
        "put a Todo before another in the Todo order, or last",
    ),
    ("todo_delete", "delete a Todo that should not exist"),
    (
        "pad_export",
        "write a Pad's text to a file at an absolute path",
    ),
    (
        "pad_setStorage",
        "choose whether the Project mirrors its Pads to files",
    ),
    (
        "rail_tree",
        "read the Rail: every Workstream, Agent and Terminal with its Status",
    ),
    (
        "rail_createWorkstream",
        "make a Workstream at the Project root with `parent` null; Workstreams never nest, and `rail_startDoor` starts its Door next",
    ),
    (
        "rail_startDoor",
        "start the Door of a Workstream you made or one in your Reach; the Door asks the user what the Workstream is for",
    ),
    ("rail_rename", "rename yourself or a node in your Reach"),
    (
        "rail_move",
        "move a node in your Reach; a Workstream moves only to the root",
    ),
    ("rail_remove", "remove a node in your Reach, never yourself"),
    ("agent_stop", "stop an Agent in your Reach, never yourself"),
    (
        "agent_interrupt",
        "interrupt the turn of an Agent in your Reach",
    ),
    (
        "agent_prompt",
        "send a prompt to an Agent in your Reach as the user would",
    ),
    (
        "agent_resume",
        "resume a stopped Agent in your Reach from its saved conversation",
    ),
    (
        "agent_discard",
        "discard the Worktree of an Agent in your Reach with its changes",
    ),
    (
        "agent_land",
        "land the Worktree of an Agent in your Reach on the Base branch",
    ),
    (
        "agent_worktreeState",
        "read what a Worktree holds and whether it can land; yours or one in your Reach",
    ),
    (
        "route_list",
        "see the Routes: whom each Agent's questions go to",
    ),
    ("project_get", "read the Project's settings"),
    (
        "project_setWorktrees",
        "turn Worktrees on or off for the Project and set the command Landing runs",
    ),
    (
        "provenance_history",
        "list the Touches on one item, such as `todo:3` or `rail:5`",
    ),
    ("provenance_touched", "list the Touches one Actor made"),
    (
        "project_open",
        "ask the App to open the Project at an absolute folder path; the answer means asked, not done",
    ),
    (
        "project_rename",
        "ask the App to give this Project another name; the answer means asked, not done",
    ),
    (
        "agent_spawn",
        "start a child Agent in a folder of this Project, with an `order` (the one-sentence ask, the done condition, the limits) and a `prompt` (the working detail); it becomes your child",
    ),
    (
        "agent_run",
        "run a command in a Terminal of your own, shown to the user as a bubble; the answer holds its terminal_id",
    ),
    (
        "terminal_screen",
        "read a Terminal's screen as it is now, as plain text, with the `offset` to read from next",
    ),
    (
        "terminal_read",
        "read a Terminal's output from the `after` offset you got last, as plain text; its `next` is the offset to give the next time",
    ),
    (
        "terminal_search",
        "search a Terminal's output for a regular expression and get only the matching lines with their offsets",
    ),
    (
        "route_set",
        "set where Messages from one Agent to another go (`auto`, `ask-first`, `drop`); it acts on others, never on you, and never over a Route the user set",
    ),
    (
        "terminal_spawn",
        "start a program in a Terminal of your own; close it with `terminal_close` when you are done",
    ),
    (
        "terminal_open",
        "start a login shell in a Terminal owned by a Workstream of yours",
    ),
    (
        "terminal_close",
        "stop a Terminal you or your Reach own and forget it",
    ),
    (
        "terminal_write",
        "type base64 `data` into a Terminal you or your Reach own",
    ),
    ("terminal_resize", "resize a Terminal you or your Reach own"),
    (
        "terminal_kill",
        "stop the program of a Terminal you or your Reach own",
    ),
];

/// The tools beyond `TOOLS` that only a Door is offered: B20's digest, A32's handoff and M10's `checkpoint_write`.
const DOOR_TOOLS_EXTRA: [(&str, &str); 3] = [
    (
        "agent_digest",
        "ask what each of your direct children did: its Kind, its last line, its open Todos and the Pads it wrote since you were last told",
    ),
    (
        "workstream_handoff",
        "answer the user clearing your Workstream: what happened and why, and the Todos and Pads to keep, only when asked to",
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
You have none of Claude Code's own shell or file tools and reach a shell only through `terminal_spawn`: your children do the work. \
Start a child with `agent_spawn` and talk to it with `message_send`. \
A note beginning `[decision <id>]` tells you a child opened a permission request or question: read it with `decision_list` and answer it with `decision_answer`, which acts only on the Agents below you. \
Make a Workstream with `rail_createWorkstream` and then `rail_startDoor`; a Workstream is never nested, and its Door asks the user what it is for. \
Open another Project with `project_open`. \
Stop or prompt an Agent in your Reach with `agent_stop` and `agent_prompt`. \
Every tool named here acts in your Reach or on the Project, and a call outside it fails `FORBIDDEN`. \
Give each child a `name` after its task. \
Read `agent_context` for the Models you may start a child on, and pass `model` as the smallest one that does the child's job; omit it to take the Project's. \
Give each child an `order`: the one-sentence ask, how it knows it is done, and its limits. Put the working detail in `prompt`. \
Write a Checkpoint with `checkpoint_write` when the work reaches a point worth marking: an Agent's work finished or merged, a change of direction, a decision made. \
Run `reduce` on every string and lay the Blocks out the `show-me` way, choosing the rows, table, diagram or text that suits what happened. \
Put nothing in a Checkpoint that the Thread's feed already shows.
";

/// M13: how to read a Terminal without flooding the context.
const TERMINAL_HABIT: &str = "\
To read a Terminal of your Runs or your Workstream, search first with `terminal_search` for a pattern, \
read what is new with `terminal_read` and the `next` of your last read, and look at what is on screen now with `terminal_screen`. \
Never read from 0 again; every answer is capped, and says `truncated` when more is left.

";

/// Q1: `hold/output-styles/plain.md` of `saadshahd/moo.md` commit 595eda0e3b477d1af1daad82f395073d4f912c8d
/// (plugin `hold` 0.0.9), vendored byte for byte.
const HOLD_PLAIN: &str = include_str!("../../assets/hold-plain.md");

/// Q1: the text that puts every generated text into `HOLD_PLAIN`'s style.
const PLAIN_RULE: &str = "\
## Output style

Write every Work order, Message to `you`, `ask_user` question, Digest and Pad reply in the output style below. \
Write each limit of a Work order as a rule that reads on its own, such as \"Change no file in the repo\".

";

/// Q6: `hope/skills/reduce/SKILL.md` of `saadshahd/moo.md` commit 595eda0e3b477d1af1daad82f395073d4f912c8d,
/// vendored byte for byte.
const REDUCE: &str = include_str!("../../assets/reduce.md");

/// Q6: `plugins/show-me/skills/show-me/SKILL.md` of `humanlayer/skills` commit
/// 653b6411c1f70c275a18e37673b042ff99f67ceb, vendored byte for byte.
const SHOW_ME: &str = include_str!("../../assets/show-me.md");

/// H14b: how to ask with `ask_user`.
const ASK_RULE: &str = "\
## Asking the user

When you call `ask_user`:

- The question is one line: the decision.
- The context is at most 3 lines, only what the pick turns on, and you run `reduce` on it.
- The answers are 2 to 4, the recommended one first and its label ending ` (recommended)`.
- A label is at most 5 words.
- A description is the tradeoff: what the pick gains and what it costs.
- A preview is the smallest `show-me` sketch of what the pick builds, and is required when the user has not met its terms.
- An open question the user answers in their own words takes no answers.
- Never ask what you can answer by looking, and never ask `you` in a Message what `ask_user` asks.
- The reply is `{answer, note}`: `answer` is the label picked, or null for the user's own answer, and `note` is their text.

";

/// Q6 and Q7: what to do with the two skills below, and which of `show-me`'s views the App draws.
const REDUCE_RULE: &str = "\
## Reduce and show

Run `reduce` on every Work order, Message to `you`, `ask_user` question, Digest, Pad reply and Todo title before you write it, \
and lay it out as `show-me` does. Both skills follow. \
When the text explains structure, a flow or a comparison, pick the smallest view that makes the point, and only a view the App draws:

- a table, in any of that text;
- a code-shape sketch, call tree, file tree or `diff` in a fenced block, in any of that text;
- a Mermaid diagram only in a Pad, written with `pad_write` or `pad_append`: \
a Message, `ask_user` question, Digest, Work order or Todo title never holds one, so write the diagram in a Pad and send the Pad's name;
- no HTML artifact: write no HTML file and never `open` one.

";

/// Q9: B24's additions for a Door's own questions to `you`.
const DOOR_QUESTIONS: &str = "\
Open a question with the question. State a guess once, as a choice to confirm. \
Write a list as the choices and nothing around them. \
Leave out an acknowledgment such as \"On it.\", a connective such as \"Separately:\" and a list item that restates its question.
";

/// E9: the Brief text for `role`, the same bytes for every Agent of it, so sessions share one
/// prompt cache. The Agent's id reaches it in its Context at start (E3).
pub fn text(role: Role) -> String {
    // M11: the tools to load together on the first turn.
    let first_turn = if role == Role::Door {
        "Load `agent_context`, `message_list`, `agent_digest` and `ask_user` together first."
    } else {
        "Load `agent_context` and `todo_list` together first."
    };
    let mut text = format!(
        "# roundup\n\n\
         roundup started you and supervises you; the user can see your Status and your Messages. \
         Your id and where you stand are in the Context you get at start; the id never changes.\n\n\
         ## Tools\n\n\
         The `roundup` MCP server offers these tools. They are deferred: load a tool before its first call with `ToolSearch` and the query `select:mcp__roundup__<name>,…`, naming every tool you need in one call. \
         {first_turn}\n\n",
    );
    let door: &[(&str, &str)] = if role == Role::Door {
        &DOOR_TOOLS_EXTRA
    } else {
        &[]
    };
    for &(name, when) in TOOLS.iter().chain(door) {
        text.push_str(&format!("- `{name}`: {when}.\n"));
    }
    text.push('\n');
    text.push_str(TERMINAL_HABIT);
    text.push_str(PLAIN_RULE);
    text.push_str(HOLD_PLAIN);
    text.push('\n');
    text.push_str(ASK_RULE);
    text.push_str(REDUCE_RULE);
    text.push_str(REDUCE);
    text.push('\n');
    text.push_str(SHOW_ME);
    if role == Role::Door {
        text.push('\n');
        text.push_str(DOOR);
        text.push_str(DOOR_QUESTIONS);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o9_the_brief_and_the_tool_description_name_order_and_prompt() {
        let brief = text(Role::Door);
        assert!(
            brief.contains("`order`") && brief.contains("`prompt`"),
            "{brief}"
        );
    }
}
