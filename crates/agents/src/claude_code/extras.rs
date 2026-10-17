//! LC7: the skills, plugins and MCP servers of the user's setup that a Door may give a child, found
//! where Claude Code keeps them, and how a chosen one joins the child's start.

use std::path::{Path, PathBuf};

use contracts::agent::Extras;
use rpc::{RpcError, code};
use serde_json::{Map, Value};

/// Where the names are read: the user's Claude folder and config file, and the Project folder.
pub struct Sources<'a> {
    pub claude_dir: &'a Path,
    pub claude_json: &'a Path,
    pub project: &'a Path,
}

/// What a chosen set of extras adds to a child's start.
#[derive(Default)]
pub struct Delivery {
    /// Skill folders to list, by name.
    pub skills: Vec<(String, PathBuf)>,
    /// Installed plugin folders, for `--plugin-dir`.
    pub plugins: Vec<PathBuf>,
    /// Server entries for the child's MCP config, by name.
    pub servers: Map<String, Value>,
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn skill_folders(root: &Path) -> Vec<(String, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| Some((entry.file_name().into_string().ok()?, entry.path())))
        .collect()
}

fn skills(src: &Sources<'_>) -> Vec<(String, PathBuf)> {
    // The Project's skill shadows the user's of the same name.
    let mut found = skill_folders(&src.project.join(".claude/skills"));
    for (name, path) in skill_folders(&src.claude_dir.join("skills")) {
        if !found.iter().any(|(taken, _)| *taken == name) {
            found.push((name, path));
        }
    }
    found
}

/// `(key, install folder)` of each installed plugin; a plugin is also named by the part of its key before `@`.
fn plugins(src: &Sources<'_>) -> Vec<(String, PathBuf)> {
    let installed = read_json(&src.claude_dir.join("plugins/installed_plugins.json"));
    let Some(Value::Object(plugins)) = installed.as_ref().and_then(|v| v.get("plugins")) else {
        return Vec::new();
    };
    plugins
        .iter()
        .filter_map(|(key, installs)| {
            let path = installs.get(0)?.get("installPath")?.as_str()?;
            Some((key.clone(), PathBuf::from(path)))
        })
        .collect()
}

fn servers(src: &Sources<'_>) -> Map<String, Value> {
    let mut found = Map::new();
    let config = read_json(src.claude_json);
    let project = config.as_ref().and_then(|config| {
        let key = src.project.to_string_lossy();
        config.get("projects")?.get(key.as_ref())
    });
    let file = read_json(&src.project.join(".mcp.json"));
    for from in [file.as_ref(), project, config.as_ref()]
        .into_iter()
        .flatten()
    {
        if let Some(Value::Object(map)) = from.get("mcpServers") {
            for (name, server) in map {
                found.entry(name.clone()).or_insert_with(|| server.clone());
            }
        }
    }
    // roundup's own server is the child's already.
    found.remove("roundup");
    found
}

/// The names that exist, by kind (`agent.extras`).
pub fn available(src: &Sources<'_>) -> Extras {
    let named = |mut names: Vec<String>| {
        names.sort();
        names
    };
    Extras {
        skills: named(skills(src).into_iter().map(|(name, _)| name).collect()),
        plugins: named(plugins(src).into_iter().map(|(key, _)| key).collect()),
        mcp: named(servers(src).into_iter().map(|(name, _)| name).collect()),
    }
}

/// Resolve `extras` against what exists. Every unknown name fails the call as `INVALID_PARAMS`,
/// naming each with its kind.
pub fn resolve(src: &Sources<'_>, extras: &Extras) -> Result<Delivery, RpcError> {
    let mut delivery = Delivery::default();
    let mut unknown = Vec::new();
    // Each source is read only when a name needs it: most launches name no extra.
    let known_skills = if extras.skills.is_empty() {
        Vec::new()
    } else {
        skills(src)
    };
    let known_plugins = if extras.plugins.is_empty() {
        Vec::new()
    } else {
        plugins(src)
    };
    let known_servers = if extras.mcp.is_empty() {
        Map::new()
    } else {
        servers(src)
    };
    for name in &extras.skills {
        match known_skills.iter().find(|(known, _)| known == name) {
            Some(found) => delivery.skills.push(found.clone()),
            None => unknown.push(format!("skill {name}")),
        }
    }
    for name in &extras.plugins {
        let found = known_plugins
            .iter()
            .find(|(key, _)| key == name || key.split('@').next() == Some(name));
        match found {
            Some((_, path)) => delivery.plugins.push(path.clone()),
            None => unknown.push(format!("plugin {name}")),
        }
    }
    for name in &extras.mcp {
        match known_servers.get(name) {
            Some(server) => {
                delivery.servers.insert(name.clone(), server.clone());
            }
            None => unknown.push(format!("mcp server {name}")),
        }
    }
    if unknown.is_empty() {
        Ok(delivery)
    } else {
        Err(RpcError::new(
            code::INVALID_PARAMS,
            format!(
                "unknown extras, nothing started: {}; read `agent_extras` for the names",
                unknown.join(", ")
            ),
        ))
    }
}

/// `a` and then the names of `b` it lacks.
pub fn merged(a: &Extras, b: &Extras) -> Extras {
    let join = |a: &[String], b: &[String]| {
        let mut all = a.to_vec();
        all.extend(b.iter().filter(|name| !a.contains(name)).cloned());
        all
    };
    Extras {
        skills: join(&a.skills, &b.skills),
        plugins: join(&a.plugins, &b.plugins),
        mcp: join(&a.mcp, &b.mcp),
    }
}
