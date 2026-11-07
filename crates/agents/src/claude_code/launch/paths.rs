//! Where an Agent's launch files live.
#![deny(clippy::fn_params_excessive_bools)]

use super::*;
use crate::id::AgentId;

/// Every file one Agent's launch owns, under the Project's data folder `dir`.
pub(in crate::claude_code) struct Paths {
    pub agents: PathBuf,
    pub settings: PathBuf,
    pub mcp_config: PathBuf,
    pub brief: PathBuf,
    pub shims: PathBuf,
    pub extras: PathBuf,
}

impl Paths {
    pub fn new(dir: &Path, id: AgentId) -> Self {
        Self {
            agents: agents_dir(dir),
            settings: settings_path(dir, id),
            mcp_config: mcp_config_path(dir, id),
            brief: brief_path(dir, id),
            shims: shim_dir(dir, id),
            extras: extras_dir(dir, id),
        }
    }
}

pub(in crate::claude_code) fn agents_dir(dir: &Path) -> PathBuf {
    dir.join("agents")
}

pub(in crate::claude_code) fn settings_path(dir: &Path, id: AgentId) -> PathBuf {
    agents_dir(dir).join(format!("{id}.settings.json"))
}

pub(in crate::claude_code) fn mcp_config_path(dir: &Path, id: AgentId) -> PathBuf {
    agents_dir(dir).join(format!("{id}.mcp.json"))
}

pub(in crate::claude_code) fn shim_dir(dir: &Path, id: AgentId) -> PathBuf {
    agents_dir(dir).join(format!("{id}.bin"))
}

/// The first command-line word of a Door's Claude Code names this file, so a process table row
/// that holds it is that Door's program (F5).
pub fn settings_marker(dir: &Path, id: &str) -> Option<PathBuf> {
    let dir = dir.canonicalize().ok()?;
    Some(settings_path(&dir, AgentId::parse(id)?))
}

/// One executable in `shims` for each program name an Adapter supplies, each failing loud.
pub(in crate::claude_code) fn write_shims(shims: &Path) -> std::io::Result<()> {
    for program in super::super::programs() {
        let script = format!(
            "#!/bin/sh\necho {} >&2\nexit 1\n",
            try_quote(SHIM_MESSAGE).expect("shim message has no NUL")
        );
        let path = shims.join(program);
        replace_text(&path, &script)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

pub(in crate::claude_code) fn remove_shims(dir: &Path, id: AgentId) -> std::io::Result<()> {
    match std::fs::remove_dir_all(shim_dir(dir, id)) {
        Err(err) if err.kind() != ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}

pub(in crate::claude_code) fn lean_path(dir: &Path, id: AgentId) -> PathBuf {
    agents_dir(dir).join(format!("{id}.lean.json"))
}

pub(in crate::claude_code) fn extras_dir(dir: &Path, id: AgentId) -> PathBuf {
    agents_dir(dir).join(format!("{id}.extras"))
}

/// LC1, LC6: how `role`'s child launches: lean for a Door and for the child of a Door or an Agent,
/// the user's full setup for an Agent the user started.
pub(in crate::claude_code) fn lean_of(role: Role, pair: &LaunchFacts) -> Option<Lean> {
    match (role, &pair.lean) {
        (_, Some(lean)) => Some(lean.clone()),
        (Role::Door, None) => Some(Lean::default()),
        _ => None,
    }
}

pub(in crate::claude_code) fn brief_path(dir: &Path, id: AgentId) -> PathBuf {
    agents_dir(dir).join(format!("{id}.brief.md"))
}

pub(in crate::claude_code) fn enabled_plugin<'a>(
    settings: &'a Value,
    name: &str,
) -> Option<&'a str> {
    settings
        .get("enabledPlugins")?
        .as_object()?
        .iter()
        .find(|(key, value)| key.split('@').next() == Some(name) && value.as_bool() == Some(true))
        .map(|(key, _)| key.as_str())
}
