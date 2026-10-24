//! The tools and instructions each lean Role receives.

use super::Role;

/// F2, M11: the only tools a Door is started with; `ToolSearch` is there because its Brief tells it to load the deferred roundup tools with it, and `Skill` because its Brief tells it to run `hope:intent` on each ask (LC14), and `AskUserQuestion` because the user answers the Door's questions natively in its Terminal (A3564a). Every other tool Claude Code has, `Bash`, `Edit`,
/// `Write` and `Agent` among them, is absent; the MCP servers' tools stay (F1).
pub const DOOR_TOOLS: &str = "Read,Grep,Glob,ToolSearch,Skill,AskUserQuestion";

/// M2219: a Door's tools with no roundup server; its Brief no longer tells it to load tools, so `ToolSearch` goes.
pub const DOOR_TOOLS_NO_MCP: &str = "Read,Grep,Glob,Skill,AskUserQuestion";

/// LC1: a scout's tools; it reads and searches, and `Bash` is how it searches a repository.
pub const SCOUT_TOOLS: &str = "Read,Grep,Glob,Bash,ToolSearch,AskUserQuestion";

/// M2219 for a scout.
pub const SCOUT_TOOLS_NO_MCP: &str = "Read,Grep,Glob,Bash,AskUserQuestion";

/// LC1: what a Role's child starts with, on top of the user's setup (LC2).
pub struct Profile {
    /// `--tools` with roundup's MCP server and without it; `None` is every tool.
    pub tools: Option<(&'static str, &'static str)>,
    /// The bundled plugins passed with `--plugin-dir`, by name (LC5, LC14).
    pub bundled_plugins: &'static [&'static str],
    /// The user's global `CLAUDE.md` is appended to the Brief file (LC5).
    pub global_instructions: bool,
}

/// LC1: the one table of launch profiles, a row for each lean Role.
pub const PROFILES: [(Role, Profile); 3] = [
    (
        Role::Door,
        Profile {
            tools: Some((DOOR_TOOLS, DOOR_TOOLS_NO_MCP)),
            // A41: a `/command` sent to a Door runs there.
            bundled_plugins: &["hope", "hunch", "hold"],
            global_instructions: true,
        },
    ),
    (
        Role::Scout,
        Profile {
            tools: Some((SCOUT_TOOLS, SCOUT_TOOLS_NO_MCP)),
            bundled_plugins: &["hope", "hunch", "hold"],
            global_instructions: true,
        },
    ),
    (
        Role::Agent,
        Profile {
            tools: None,
            bundled_plugins: &["hope", "hunch", "hold"],
            global_instructions: true,
        },
    ),
];

/// LC1: `role`'s row.
pub fn profile(role: Role) -> &'static Profile {
    &PROFILES
        .iter()
        .find(|(row, _)| *row == role)
        .expect("PROFILES has a row for every Role")
        .1
}
