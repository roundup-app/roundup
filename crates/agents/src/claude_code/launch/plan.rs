//! What a launch is: the argv, the files and the permission mode, decided from facts already
//! read. Nothing here touches the disk, the environment or the clock; `write` reads the facts and
//! then writes the plan.
#![deny(clippy::fn_params_excessive_bools, clippy::too_many_lines)]

use crate::id::AgentId;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use rpc::RpcError;
use serde_json::{Map, Value, json};
use shlex::try_quote;

use super::super::models::{LaunchFacts, LaunchMode, Lean, Permission, permission_mode};
use super::super::profiles::profile;
use super::super::{brief, extras};
use super::paths::Paths;
use super::{INTENT_MISSING, Launcher, STATE_EVENTS};
use brief::Role;

/// The facts of one launch that `write` reads before the plan is made.
pub(super) struct Facts {
    /// The user's and Project's settings, with the output style defaulted.
    pub carried: Value,
    pub missing_intent: bool,
    pub delivery: extras::Delivery,
    /// The Write|Edit guard a Door or Scout adds to `PreToolUse`.
    pub memory_hooks: Vec<Value>,
    /// The Agent's `PATH`.
    pub path: OsString,
    /// The Project's `CLAUDE.md` files a lean Brief carries, as read.
    pub instructions: Vec<String>,
    /// LC5: the user's global `CLAUDE.md`, as read.
    pub global_instructions: Option<String>,
    /// The mode Claude Code takes when none is chosen.
    pub inherited_mode: String,
    pub socket: PathBuf,
}

/// Who is launched, where and how.
pub(super) struct Spec<'a> {
    pub launcher: &'a Launcher,
    pub id: AgentId,
    pub attempt: &'a str,
    pub role: Role,
    pub lean: Option<Lean>,
    pub resume: Option<&'a str>,
    pub facts: &'a LaunchFacts,
    pub paths: &'a Paths,
}

/// Everything `write` puts on disk and returns, in the order it does.
pub(super) struct Plan {
    pub settings: Value,
    pub mcp_config: Option<Value>,
    pub brief: String,
    /// The extras' skills a plugin folder of their own links.
    pub skills: Vec<(String, PathBuf)>,
    /// `None` clears the Agent's note: bypass wins over any set mode.
    pub mode: Option<LaunchMode>,
    /// The socket the Agent's messaging endpoint is made at; a stale one is removed first.
    pub socket: PathBuf,
    pub argv: Vec<String>,
}

impl Spec<'_> {
    fn mcp(&self) -> bool {
        !self.facts.mcp_off
    }
}

pub(super) fn plan(spec: &Spec<'_>, facts: Facts) -> Result<Plan, RpcError> {
    let settings = settings(spec, &facts)?;
    let mcp_config = mcp_config(spec, &facts);
    let brief = brief(spec, &facts);
    let mode = mode(spec, &facts);
    let argv = argv(spec, &facts, mcp_config.is_some(), mode.as_ref());
    Ok(Plan {
        settings,
        mcp_config,
        brief,
        skills: facts.delivery.skills,
        mode,
        socket: facts.socket,
        argv,
    })
}

fn settings(spec: &Spec<'_>, facts: &Facts) -> Result<Value, RpcError> {
    let mut own = settings_json(spec, facts)?;
    own["hooks"]["PreToolUse"]
        .as_array_mut()
        .expect("state hooks")
        .extend(facts.memory_hooks.iter().cloned());
    if spec.role == Role::Door && spec.mcp() {
        own["permissions"]["allow"] = json!(
            brief::door_tools()
                .filter(|name| *name != "terminal_write")
                .map(|name| format!("mcp__roundup__{name}"))
                .collect::<Vec<_>>()
        );
    }
    if spec.lean.is_some() {
        // LC17: the Brief carries each `CLAUDE.md` as LC1 lists it; Claude Code loads none.
        own["env"]["CLAUDE_CODE_DISABLE_CLAUDE_MDS"] = json!("1");
    }
    for (key, value) in spec.facts.env() {
        own["env"][key] = json!(value);
    }
    if spec.lean.is_none() {
        let command = own["hooks"]["SessionStart"][0]["hooks"][1]["command"]
            .as_str()
            .expect("context command");
        let brief =
            spec.paths.brief.to_str().ok_or_else(|| {
                RpcError::new(rpc::code::INVALID_PARAMS, "Brief path is not UTF-8")
            })?;
        own["hooks"]["SessionStart"][0]["hooks"][1]["command"] = json!(format!(
            "ROUNDUP_BRIEF_FILE={} {command}",
            try_quote(brief).map_err(RpcError::internal)?
        ));
    }
    let mut settings = facts.carried.clone();
    super::super::launch_files::merge_settings(&mut settings, own);
    if spec.facts.permission == Permission::Bypass {
        settings["skipDangerousModePermissionPrompt"] = json!(true);
        // Roundup has already checked its Route and actor authority. Claude's
        // inbox class vocabulary differs from the launch-mode label on our notes.
        settings["crossSessionInbound"] = json!("accept");
    }
    Ok(settings)
}

/// A20: the hook command, not the program, carries the launch's Attempt.
/// A43: `path` is the Agent's `PATH` in Claude Code's `env`, and `ROUNDUP_AGENT_ID` its id.
fn settings_json(spec: &Spec<'_>, facts: &Facts) -> Result<Value, RpcError> {
    let launcher = spec.launcher;
    let agent_id = spec.id.to_string();
    let rup = try_quote(
        launcher
            .rup
            .to_str()
            .ok_or_else(|| RpcError::internal("rup path is not UTF-8"))?,
    )
    .map_err(RpcError::internal)?;
    let id = try_quote(&agent_id).expect("numeric Agent id");
    let attempt = try_quote(spec.attempt).map_err(RpcError::internal)?;
    let signal = json!([{ "hooks": [{
        "type": "command",
        "command": format!("ROUNDUP_ATTEMPT={attempt} {rup} signal {id}"),
        "timeout": 5,
    }] }]);
    let session_start = json!([{ "hooks": [
        signal[0]["hooks"][0].clone(),
        { "type": "command", "command": format!("{rup} context {id}"), "timeout": 5 },
    ] }]);
    let hooks: Map<String, Value> = STATE_EVENTS
        .iter()
        .chain(&super::super::background::BACKGROUND_EVENTS)
        .map(|event| {
            let hook = match *event {
                "SessionStart" => &session_start,
                _ => &signal,
            };
            ((*event).to_owned(), hook.clone())
        })
        .collect();
    let mut settings = json!({ "hooks": hooks });
    if spec.mcp() {
        settings["permissions"] = json!({ "allow": ["mcp__roundup__*"] });
    }
    // LC14: Claude Code's status line keeps the one line on screen for the whole session.
    if facts.missing_intent {
        settings["statusLine"] = json!({
            "type": "command",
            "command": format!("printf %s {}", try_quote(INTENT_MISSING).expect("status line has no NUL")),
        });
    }
    settings["env"] = Value::Object(env(spec, facts, agent_id));
    Ok(settings)
}

/// User env wins over defaults; identity, PATH and the named lean exclusion are explicit.
fn env(spec: &Spec<'_>, facts: &Facts, agent_id: String) -> Map<String, Value> {
    let mut env = Map::new();
    for (key, default) in [
        ("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", "1"),
        ("CLAUDE_CODE_PLUGIN_DIR_WATCH", "0"),
        ("ENABLE_TOOL_SEARCH", "true"),
    ] {
        if facts.carried["env"].get(key).is_none() && !spec.launcher.user_defaults.contains(key) {
            env.insert(key.into(), default.into());
        }
    }
    env.insert("ROUNDUP_AGENT_ID".into(), agent_id.into());
    env.insert("PATH".into(), facts.path.to_string_lossy().into());
    env
}

/// `RUPD_SOCKET` is left out: Claude Code's environment, which the server inherits, has it.
fn mcp_config(spec: &Spec<'_>, facts: &Facts) -> Option<Value> {
    let mut servers = Map::new();
    if spec.mcp() {
        servers.insert(
            "roundup".into(),
            json!({
                "type": "stdio",
                "command": spec.launcher.rup.to_string_lossy(),
                "args": ["mcp", spec.id.to_string()],
            }),
        );
        if let Some(guide) = &spec.facts.naming_guide {
            servers["roundup"]["env"] = json!({"ROUNDUP_NAMING_GUIDE": guide});
        }
    }
    servers.extend(facts.delivery.servers.clone());
    (!servers.is_empty()).then(|| json!({ "mcpServers": servers }))
}

fn brief(spec: &Spec<'_>, facts: &Facts) -> String {
    let mut brief = brief::text(spec.role, spec.mcp());
    if facts.missing_intent {
        brief = brief::without_intent(&brief);
    }
    if profile(spec.role).global_instructions
        && let Some(text) = &facts.global_instructions
    {
        brief.push_str("\n## The user's global instructions (read-only)\n\n");
        brief.push_str(text);
        brief.push('\n');
    }
    for text in &facts.instructions {
        brief.push_str("\n## The Project's instructions (read-only)\n\n");
        brief.push_str(text);
        brief.push('\n');
    }
    brief
}

/// A note names the same selected or inherited mode as this launch.
fn mode(spec: &Spec<'_>, facts: &Facts) -> Option<LaunchMode> {
    match spec.facts.permission {
        Permission::Bypass => None,
        Permission::Selected(mode) => Some(LaunchMode {
            effective: permission_mode(mode).to_owned(),
            selected: Some(mode),
        }),
        Permission::Inherit => Some(LaunchMode {
            effective: facts.inherited_mode.clone(),
            selected: None,
        }),
    }
}

fn argv(
    spec: &Spec<'_>,
    facts: &Facts,
    has_config: bool,
    mode: Option<&LaunchMode>,
) -> Vec<String> {
    let path = |path: &Path| path.to_string_lossy().into_owned();
    let paths = spec.paths;
    let mut argv = vec![
        spec.launcher.bin.clone(),
        "--settings".into(),
        path(&paths.settings),
    ];
    if has_config {
        argv.extend(["--mcp-config".into(), path(&paths.mcp_config)]);
    }
    argv.extend(lean_args(spec, facts));
    for (flag, value) in [
        ("--model", &spec.facts.model),
        ("--effort", &spec.facts.effort),
    ] {
        if let Some(value) = value {
            argv.extend([flag.into(), value.clone()]);
        }
    }
    argv.extend(["--messaging-socket-path".into(), path(&facts.socket)]);
    match (spec.facts.permission, mode) {
        (Permission::Bypass, _) => argv.extend(
            [
                "--permission-mode",
                "bypassPermissions",
                "--dangerously-skip-permissions",
            ]
            .map(String::from),
        ),
        (Permission::Selected(_), Some(mode)) => {
            argv.extend(["--permission-mode".into(), mode.effective.clone()]);
        }
        _ => {}
    }
    if let Some(conversation_id) = spec.resume {
        argv.extend(["--resume".into(), conversation_id.to_owned()]);
        argv.extend(
            spec.launcher
                .fork_session
                .then(|| "--fork-session".to_owned()),
        );
    }
    argv
}

/// The flags only a lean launch takes: its Brief, tools, plugins and switches.
fn lean_args(spec: &Spec<'_>, facts: &Facts) -> Vec<String> {
    let Some(lean) = &spec.lean else {
        return Vec::new();
    };
    let path = |path: &Path| path.to_string_lossy().into_owned();
    let mut argv = vec![
        "--append-system-prompt-file".to_owned(),
        path(&spec.paths.brief),
    ];
    if let Some((with, without)) = profile(spec.role).tools {
        argv.extend([
            "--tools".into(),
            if spec.mcp() { with } else { without }.into(),
        ]);
    }
    if !facts.delivery.skills.is_empty() {
        argv.extend(["--plugin-dir".into(), path(&spec.paths.extras)]);
    }
    for plugin in &facts.delivery.plugins {
        argv.extend(["--plugin-dir".into(), path(plugin)]);
    }
    if facts.delivery.computer_use {
        argv.push(extras::COMPUTER_USE_SWITCH.into());
    }
    if lean.fresh_brief && spec.resume.is_some() {
        argv.extend(["--system-prompt-snapshot", "off"].map(String::from));
    }
    argv
}
