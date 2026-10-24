//! E1: the Brief, the text file Claude Code appends to its system prompt. It holds only what is the same
//! for every Agent of a role (E9): that roundup supervises it, the tools `rup mcp` offers and,
//! for a Door, B24's role guidance. A name, Terminal id, parent, peer or Todo changes, so none is
//! written here. A tool is described only once `crates/rup` offers it, and `agent_digest`, `workstream_handoff`, `checkpoint_write`, `workstream_rewindPlan` and `workstream_rewind` only to a Door.

/// What an Agent is to roundup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// Any Agent started by `agent.spawn`.
    Agent,
    /// A Workstream's Door, started by `rail.startDoor`.
    Door,
    /// LC4: a Subagent started with `scout: true`, which reads and searches only. It takes the
    /// Subagent's Model and Effort, so it is no entry of `ALL`.
    Scout,
}

impl Role {
    /// A36: every Role, the one list a Project's Models are set for.
    pub const ALL: [Role; 2] = [Role::Door, Role::Agent];

    /// A36: the Role's name in `project.get` and `project.setModels`.
    pub fn id(self) -> &'static str {
        match self {
            Role::Door => "door",
            Role::Agent | Role::Scout => "subagent",
        }
    }
}

/// The tools `rup mcp` offers, with when to use each.
const TOOLS: &[(&str, &str)] = &[
    (
        "deliverable_publish",
        "deliberately publish a file, expected Pad incarnation and Revision or current external URL; after an unknown reply replay the identical request and key, never scratch work",
    ),
    (
        "deliverable_list",
        "list published results by Home or maker without reading their retained bytes",
    ),
    (
        "deliverable_get",
        "read one publication by its Project and id, never by title",
    ),
    (
        "deliverable_resolve",
        "retrieve its exact retained revision or current external URL, or its unavailable cause; never substitute another target",
    ),
    (
        "deliverable_move",
        "place a publication you made unless the user has placed it; the user move wins",
    ),
    (
        "deliverable_remove",
        "request publication removal; only the user is authorized, and the id and key cannot be reused",
    ),
    ("todo_create", "record a piece of work that is not done yet"),
    (
        "todo_assign",
        "assign a Todo to an owner, or leave it unassigned",
    ),
    ("todo_get", "read one Todo before changing it"),
    ("todo_list", "see all the work already recorded"),
    (
        "todo_update",
        "change a Todo's title or body as the work becomes clearer",
    ),
    (
        "todo_comment",
        "leave one short plain line on a Todo only when the user must read it, such as a question or a blocker",
    ),
    (
        "todo_addRef",
        "point the user from a Todo to a Pad, or to one section of it with a `#<heading>` link, that they should read",
    ),
    (
        "todo_removeRef",
        "remove such a link from a Todo when it no longer applies",
    ),
    ("todo_complete", "mark a Todo done once its outcome is real"),
    ("todo_reopen", "reopen a done Todo when work remains"),
    (
        "todo_setBlockers",
        "replace the Todos that must finish before this one",
    ),
    (
        "pad_create",
        "start a Pad, a named text you own, for notes you want to keep",
    ),
    ("pad_read", "read one Pad"),
    (
        "link_read",
        "read what a roundup:// link names, as it is now",
    ),
    ("pad_list", "see which Pads exist"),
    ("pad_write", "rewrite a Pad you own"),
    ("pad_append", "add text to the end of any Pad"),
    (
        "pad_appendSection",
        "add text at the end of the section under a Markdown heading of any Pad",
    ),
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
        "agent_wake",
        "ask to be woken when the Agents you name finish, all of them or with `any` the first, then end your turn instead of polling `terminal_read` or `rail_tree`; one note brings each one's Kind and last words; a child in `error` or `needs-you` tells you without asking",
    ),
    (
        "reaction_create",
        "save a named instruction that a declared condition (named Agents finished, a PR's checks passed or one instant) delivers once to a target Agent that is you or in your Reach; it needs an `operation` retry key and an expiry, and to change one you stop it and create another",
    ),
    (
        "reaction_preview",
        "resolve a date, time and UTC offset to the exact `instant` condition `at` and its UTC instant before creating a time reaction; it saves nothing",
    ),
    ("reaction_list", "list the reactions you authorized"),
    (
        "reaction_get",
        "read one reaction you authorized with its firings",
    ),
    (
        "reaction_stop",
        "stop a reaction you authorized so no later firing is accepted",
    ),
    (
        "reaction_run",
        "spend one remaining firing of a reaction you authorized now, with an `operation` retry key",
    ),
    (
        "agent_set_order",
        "replace your own order: a Work order once the ask is clear, or a Clarification order while a question is open",
    ),
    (
        "message_send",
        "send a note, question or request to another Agent or the user; it is delivered when the receiver is next idle",
    ),
    (
        "message_progress",
        "inspect retained instructions, reports, user acceptance and declared verification; reading starts nothing",
    ),
    (
        "message_report",
        "report your own Attempt's result against a submitted instruction delivery and published output; it is only your claim, never user acceptance or verification; retain the same key on retry",
    ),
    (
        "message_acceptResult",
        "record user acceptance of an exact report; only the user may call this",
    ),
    (
        "message_verifyResult",
        "observe one report's declared authoritative condition without a Model call; unsupported, stale or unavailable evidence stays unknown and a publication digest proves only its bytes",
    ),
    (
        "message_resolveResult",
        "only the user may authorize a read-only authoritative receipt source for an unknown external effect; never repeat that effect to check it",
    ),
    (
        "message_reconcileWork",
        "read which retained work is unfinished, confirmed, pending a check or uncertain; reading sends and starts nothing",
    ),
    (
        "message_resumeWork",
        "only the user may resume unfinished work; one decision makes one successor Message and never repeats an uncertain external effect",
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
        "agent_instructions",
        "read exact instruction revisions and Attempt-bound delivery facts for yourself or your Reach; reading sends nothing, and submission is not work completion",
    ),
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
        "project_measurements",
        "read retained measurements and collection coverage",
    ),
    (
        "project_measurementSummary",
        "read a Workstream's exact consumed token subtotals and ranked contributors; later pages require the first page's revision",
    ),
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
        "start a child Agent in a folder of this Project, with an `order` (a `title` of at most six words, the one-sentence ask, the done condition, the limits) and a `prompt` (the working detail); it becomes your child",
    ),
    (
        "agent_run",
        "run a command in a Terminal of your own; the answer holds its terminal_id",
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

/// F8: keeping one rule prevents the three Terminal-start descriptions from drifting.
const BUBBLE_RULE: &str = "; use your own tools for commands; open a Bubble only when the user needs to see its output or will interactively type into it. Routine builds, tests and inspection use your own tools";

/// The tools beyond `TOOLS` that only a Door is offered: B20's digest, A32's handoff and M10's `checkpoint_write`.
const DOOR_TOOLS_EXTRA: [(&str, &str); 8] = [
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
    (
        "agent_extras",
        "list the skills, plugins and servers of the user's setup that a child can be given",
    ),
    (
        "agent_extras_add",
        "give a running child of yours such extras by name; it is relaunched with its conversation",
    ),
    (
        "terminal_show",
        "show a Terminal in your Reach to the user, who sees its owner selected; it reads nothing",
    ),
    (
        "workstream_rewindPlan",
        "read what rewinding your children to one of your Checkpoints would do, changing nothing",
    ),
    (
        "workstream_rewind",
        "take one child or every child back to one of your Checkpoints, choosing whether the files go back too",
    ),
];

/// LC14: the Door's standing instruction; a Door whose bundle lacks the skill has the Brief without it.
const INTENT: &str = "On each new ask from the user, run the `hope:intent` skill first with the user's words, then act on the work order it produces. ";

/// LC14: `text` for a Door, without the standing instruction.
pub fn without_intent(text: &str) -> String {
    text.replace(INTENT, "")
}

const DOOR: &str = "\
## Your role

You are this Workstream's coordinating Door. Use the Todo tools to record the work and update it as it changes. \
The user types to you in your own Terminal. Report the outcome directly in your Terminal when the work ends. \
When the user's goal or a taste limit is unclear, ask directly in your Terminal and wait for their reply there. \
{intent}\
Delegate implementation to children with `agent_spawn`. You cannot execute commands or open or write to a Terminal. \
Start a child with `agent_spawn` and talk to it with `message_send`. \
A note beginning `[decision <id>]` tells you a child opened a permission request or question: read it with `decision_list` and answer it with `decision_answer`, which acts only on the Agents below you. \
Make a Workstream with `rail_createWorkstream` and then `rail_startDoor`; a Workstream is never nested, and its Door asks the user what it is for. \
Open another Project with `project_open`. \
When the user asks to see a child's output, call `terminal_show` with the id of the child's Terminal and read nothing: no `terminal_screen`, `terminal_read`, `terminal_search` or `message_send`. \
Stop or prompt an Agent in your Reach with `agent_stop` and `agent_prompt`. \
Every tool named here acts in your Reach or on the Project, and a call outside it fails `FORBIDDEN`. \
For each ask, choose a standing specialist child or a new job-sized child, using your judgment. \
A standing specialist is a scout for one kind of reading: pass `scout: true` and `specialist: \"<name>\"` to `agent_spawn`; one lives per Workstream and specialist name. \
The Daemon replaces a specialist at 160k tokens after asking it for a summary of at most 600 bytes. \
Give a job-sized child a whole job that finishes under 160k tokens and expect its summary at the end. \
Give each child a `name` after its task. \
Pass `scout: true` for a child that only reads and searches. A child starts with the tools its job needs and nothing of the user's other setup; when it needs a skill, plugin or server of the user's, read `agent_extras` and pass `extras` to `agent_spawn`. \
Pass `model` as the smallest Model that does the child's job (`haiku`, `sonnet`, `opus` or `fable`); omit it to take the Project's. \
Give each child an `order`: a `title` of at most six words, the one-sentence ask, how it knows it is done, and its limits. Put the working detail in `prompt`. \
When the user gives you the words of a task, write its `order` yourself, call `agent_spawn` with that `order` and the user's words exactly as typed in `prompt`, and then report directly in your Terminal: name the new Agent and give its ask in one sentence. \
You write orders only for the Agents you spawn; an Agent the user started writes its own. \
Write a Checkpoint with `checkpoint_write` when the work reaches a point worth marking: an Agent's work finished or merged, a change of direction, a decision made. \
Run `reduce` on every string and lay the Blocks out the `show-me` way, choosing the rows, table, diagram or text that suits what happened. \
Keep each Checkpoint to the facts needed to understand that point in the work.
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

Write every reply, including direct Terminal prose, in hold:Plain regardless of recipient or tool. \
Write every Work order, Message to `you`, `ask_user` question, Digest and Pad reply in the output style below. \
Write each limit of a Work order as a rule that reads on its own, such as \"Change no file in the repo\".

";

/// LC3: Plain's rules in the Door's own words; the Door reads no user `CLAUDE.md` and a Project's
/// stays in force, so nothing here overrides it or forces a status table.
const DOOR_PLAIN: &str = "\
## Output style

Write plainly, action first: the first line is the next action or the answer, the last line is the real next action, and what the reader would not miss is left out. \
Keep prose to a few short lines and put rows in a table. \
Where the Project's `CLAUDE.md` asks for something else, follow it.

";

/// LC4: what a scout is told.
const SCOUT: &str = "\
## Your role

You are a scout: you read and search, and you change nothing. Answer the ask that started you in a few lines and send it to your parent with `message_send`.
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

/// M2219: the `rup` command for tool `name`: `noun_verbName` is `rup noun verb-name`, and `ask_user` is `rup agent ask`, and the two ref tools are `rup todo ref add|remove`.
fn command(name: &str) -> String {
    match name {
        "ask_user" => return "rup agent ask".into(),
        // T28: the one pair of commands with a group word between noun and verb.
        "todo_addRef" => return "rup todo ref add".into(),
        "todo_removeRef" => return "rup todo ref remove".into(),
        _ => {}
    }
    let (noun, verb) = name.split_once('_').unwrap_or((name, ""));
    let mut text = format!("rup {noun} ");
    for c in verb.chars() {
        if c.is_ascii_uppercase() {
            text.push('-');
        }
        text.push(if c == '_' {
            '-'
        } else {
            c.to_ascii_lowercase()
        });
    }
    text.trim_end().to_owned()
}

/// E9: the Brief text for `role`, the same bytes for every Agent of it, so sessions share one
/// prompt cache. The Agent's id reaches it in its Context at start (E3). `mcp` is whether the
/// roundup MCP server is launched (M2219); with it off the Brief names `rup` commands instead.
pub fn text(role: Role, mcp: bool) -> String {
    let brief = with_tools(role, mcp);
    if mcp {
        return brief;
    }
    let door: &[(&str, &str)] = if role == Role::Door {
        &DOOR_TOOLS_EXTRA
    } else {
        &[]
    };
    TOOLS.iter().chain(door).fold(brief, |brief, &(name, _)| {
        brief.replace(&format!("`{name}`"), &format!("`{}`", command(name)))
    })
}

pub(super) fn door_tools() -> impl Iterator<Item = &'static str> {
    TOOLS
        .iter()
        .chain(&DOOR_TOOLS_EXTRA)
        .map(|(name, _)| *name)
        .filter(|name| !matches!(*name, "agent_run" | "terminal_spawn" | "terminal_open"))
}

fn with_tools(role: Role, mcp: bool) -> String {
    // M11: the tools to load together on the first turn.
    let first_turn = match (mcp, role) {
        (true, Role::Door) => {
            "Load `agent_context`, `message_list`, `agent_digest` and `ask_user` together first."
        }
        (true, _) => "Load `agent_context` and `todo_list` together first.",
        (false, Role::Door) => {
            "Run `agent_context`, `message_list`, `agent_digest` and `ask_user` first."
        }
        (false, _) => "Run `agent_context` and `todo_list` first.",
    };
    let (heading, help, tools) = if mcp {
        (
            "Tools",
            "which does everything the tools below do",
            "The `roundup` MCP server offers these tools. They are deferred: load a tool before its first call with `ToolSearch` and the query `select:mcp__roundup__<name>,…`, naming every tool you need in one call. ",
        )
    } else {
        (
            "Commands",
            "which lists the commands below",
            "You act through these `rup` commands, run from your shell. ",
        )
    };
    let mut text = format!(
        "# roundup\n\n\
         roundup started you and supervises you; the user can see your Status and your Messages. \
         Your Rail name and where you stand are in the Context you get at start. \
         Refer to yourself and other Agents by Rail name, never by id. \
         Your shell sets `ROUNDUP_AGENT_ID` for machine addressing, and `rup` is on your `PATH`: run `rup help` to learn its command line, {help}.\n\n\
         ## {heading}\n\n\
         {tools}{first_turn}\n\n",
    );
    let door: &[(&str, &str)] = if role == Role::Door {
        &DOOR_TOOLS_EXTRA
    } else {
        &[]
    };
    for &(name, when) in TOOLS.iter().chain(door) {
        // M16: a Door is offered no tool that starts a Terminal.
        if role == Role::Door && !door_tools().any(|allowed| allowed == name) {
            continue;
        }
        let when = if role == Role::Door && name == "message_send" {
            "send a note, question or request to another Agent; it is delivered when the receiver is next idle; speak to the user directly in your own Terminal"
        } else {
            when
        };
        let bubble = if matches!(name, "agent_run" | "terminal_spawn" | "terminal_open") {
            BUBBLE_RULE
        } else {
            ""
        };
        text.push_str(&format!("- `{name}`: {when}{bubble}.\n"));
    }
    text.push('\n');
    text.push_str(TERMINAL_HABIT);
    // LC3, LC5: the vendored body is the worker's; the Door states the rules in its own words and a
    // scout, which writes only to its parent, needs none.
    match role {
        Role::Door => text.push_str(DOOR_PLAIN),
        Role::Scout => {}
        Role::Agent => {
            text.push_str(PLAIN_RULE);
            text.push_str(HOLD_PLAIN);
            text.push('\n');
        }
    }
    text.push_str(ASK_RULE);
    text.push_str(REDUCE_RULE);
    text.push_str(REDUCE);
    text.push('\n');
    text.push_str(SHOW_ME);
    if role == Role::Door {
        text.push('\n');
        text.push_str(&DOOR.replace("{intent}", INTENT));
        text.push_str(DOOR_QUESTIONS);
    }
    if role == Role::Scout {
        text.push('\n');
        text.push_str(SCOUT);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o9_the_brief_and_the_tool_description_name_order_and_prompt() {
        let brief = text(Role::Door, true);
        assert!(
            brief.contains("`order`") && brief.contains("`prompt`"),
            "{brief}"
        );
    }

    #[test]
    fn i8_every_brief_says_to_run_rup_help() {
        for role in [Role::Agent, Role::Door] {
            assert!(text(role, true).contains("run `rup help`"), "{role:?}");
        }
    }

    #[test]
    fn o12_the_brief_names_the_typed_prompt_flow() {
        let brief = text(Role::Door, true);
        assert!(
            brief.contains("`prompt`")
                && brief.contains("`order`")
                && brief.contains("name the new Agent"),
            "{brief}"
        );
    }
}
