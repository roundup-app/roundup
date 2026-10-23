//! What an Agent's Claude Code is started with: a per-Agent settings file whose command hook is
//! `rup signal <agent-id>`, a per-Agent MCP config that runs `rup mcp <agent-id>`, and a pre-trusted
//! working directory (no hook fires for the trust dialog).

use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::io::ErrorKind;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use rpc::{OpenError, RpcError, code};
use serde_json::{Map, Value, json};
use tokio::sync::OnceCell;
use unicode_normalization::UnicodeNormalization;

use super::brief::{self, Role};
use super::extras;
use super::launch_files::{
    ConfigLock, is_symlink, landing, merge_settings, replace_file, replace_text, shell_quote,
    socket_folder, user_settings,
};
use super::models::{Lean, Pair};
use super::plugins;
use super::profiles::profile;

/// LC14: the one line a Door shows when its bundle lacks the `intent` skill.
pub const INTENT_MISSING: &str =
    "roundup: hope's intent skill is missing; this Door runs without it.";

/// F4: what the shim for a vendor program prints on stderr before it exits 1.
const SHIM_MESSAGE: &str = "roundup: start an agent with agent_spawn (a Door) or ask the user";

/// The hook events that carry state. Notification and SubagentStop are left out on purpose: the
/// first arrives about 6 s late, the second fires spuriously (ADR 0006). H15's replay rule would
/// also drop an event here when removing its Signal from every fixture in
/// `spikes/hooks-state/log*.jsonl` and from D2, replayed with the fixture's titles alongside what
/// is left, leaves every Status unchanged; `crates/agents/tests/state_events.rs` checks the rule
/// against this list itself and finds no event prunable, since A2's star hold reads `PreToolUse`
/// to tell a star that may precede a dialog from one that may not (`mod.rs`). H15's saving is a
/// current-thread tokio runtime for `rup signal` alone (`crates/rup/src/main.rs`).
/// It is `pub` only so `crates/agents/tests/state_events.rs` can read it.
pub const STATE_EVENTS: [&str; 9] = [
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

/// One thread at a time takes Claude's config lock: two that both found it stale would each
/// break it, and the second break would remove the lock the first had just taken.
static TRUSTING: Mutex<()> = Mutex::new(());

#[cfg(any(test, feature = "test-support"))]
pub type ImportObserver = Arc<dyn Fn(&Path, &'static str, u64) + Send + Sync>;

#[derive(Clone)]
pub struct Launcher {
    pub(super) bin: String,
    /// Claude Code's own config file, where it remembers which folders are trusted.
    claude_json: PathBuf,
    pub(super) conversation_dir: PathBuf,
    /// U3016h: the vendor's account usage endpoint when not its own, and the last answer.
    usage_url: Option<String>,
    usage: super::usage::Cache,
    /// Filesystem observer for isolated import tests; absent from production builds.
    #[cfg(any(test, feature = "test-support"))]
    pub import_observer: Option<ImportObserver>,
    // One active discovery reader per Project, shared by worker clones. A newer scan
    // invalidates the older reader at its next record boundary (U3037d).
    pub(super) discovery: (
        Arc<std::sync::atomic::AtomicU64>,
        Arc<tokio::sync::Mutex<()>>,
    ),
    /// The `rup` the hooks run, by absolute path: a hook's PATH is not ours to trust.
    rup: PathBuf,
    /// The user's home folder, never trusted: Claude never saves trust for it, and a saved one
    /// would trust every non-git folder below it.
    home: Option<PathBuf>,
    /// User shell values take precedence over roundup defaults.
    user_defaults: BTreeSet<&'static str>,
    /// LC14: true only for a Launcher made `without_intent_skill`; the bundle is read at a Door's start.
    lacks_intent: bool,
    plugins: Arc<OnceCell<Delivery>>,
    /// B50: the private folder each Agent's messaging socket is made in, made at the first
    /// launch; gone with the Launcher.
    sockets: Arc<std::sync::OnceLock<tempfile::TempDir>>,
    /// B2706: the permission mode each Agent's latest normal Attempt runs in, for its notes.
    pub(super) modes: Arc<Mutex<std::collections::HashMap<String, super::models::LaunchMode>>>,
}

struct Delivery {
    data: PathBuf,
    plugins: plugins::Plugins,
    runtime: plugins::Runtime,
}

// Equality describes launch configuration, independent of the cached runtime probe.
impl PartialEq for Launcher {
    fn eq(&self, other: &Self) -> bool {
        (
            &self.bin,
            &self.claude_json,
            &self.conversation_dir,
            &self.rup,
            &self.home,
            &self.user_defaults,
        ) == (
            &other.bin,
            &other.claude_json,
            &other.conversation_dir,
            &other.rup,
            &other.home,
            &other.user_defaults,
        )
    }
}
impl Eq for Launcher {}
impl std::fmt::Debug for Launcher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Launcher")
            .field("bin", &self.bin)
            .field("claude_json", &self.claude_json)
            .field("rup", &self.rup)
            .finish_non_exhaustive()
    }
}

/// The Project folder, which bounds the trusted working directory, and the Project's data folder
/// (N1), where the launch files go.
#[derive(Clone, Copy)]
pub struct Folders<'a> {
    pub project: &'a Path,
    pub data: &'a Path,
}

impl Launcher {
    /// A39 uses the same binary as every launch, through its own Placement seam.
    pub fn placement(&self) -> super::PlacementCall {
        super::PlacementCall {
            launcher: self.clone(),
            project: None,
        }
    }

    pub(super) fn placement_settings(&self, project: &Path) -> Result<Value, String> {
        user_settings(&self.conversation_dir, project).map_err(|err| err.to_string())
    }

    pub fn new(
        bin: impl Into<String>,
        claude_json: PathBuf,
        rup: PathBuf,
        home: Option<PathBuf>,
    ) -> Self {
        let conversation_dir = match &home {
            Some(home) if claude_json == home.join(".claude.json") => home.join(".claude"),
            _ => claude_json.parent().unwrap_or(Path::new(".")).to_path_buf(),
        };
        Self {
            conversation_dir,
            usage_url: None,
            usage: super::usage::Cache::default(),
            #[cfg(any(test, feature = "test-support"))]
            import_observer: None,
            discovery: (
                Arc::new(std::sync::atomic::AtomicU64::new(0)),
                Arc::new(tokio::sync::Mutex::new(())),
            ),
            bin: bin.into(),
            claude_json,
            rup,
            home,
            user_defaults: BTreeSet::new(),
            lacks_intent: false,
            plugins: Arc::new(OnceCell::new()),
            sockets: Arc::new(std::sync::OnceLock::new()),
            modes: Arc::default(),
        }
    }

    /// LC14: this Launcher for a bundle without `hope`'s `intent` skill. The pinned bundle holds
    /// it, so this is how a Door's start without it is reached.
    #[must_use]
    pub fn without_intent_skill(mut self) -> Self {
        self.lacks_intent = true;
        self
    }

    fn door_lacks_intent(&self, role: Role) -> bool {
        role == Role::Door && (self.lacks_intent || !plugins::has_intent())
    }

    pub fn from_env() -> Result<Self, OpenError> {
        Self::from_vars(|name| std::env::var_os(name), &std::env::current_exe()?)
    }

    /// `ROUNDUP_CLAUDE_BIN` names the program (default `claude`); `CLAUDE_CONFIG_DIR`, else `HOME`,
    /// says where its config lives; `ROUNDUP_RUP_BIN`, else the `rup` beside `exe` (the running
    /// Daemon), is what the hooks run. A variable set to nothing counts as unset.
    pub fn from_vars(
        var: impl Fn(&str) -> Option<OsString>,
        exe: &Path,
    ) -> Result<Self, OpenError> {
        let var = |name: &str| var(name).filter(|value| !value.is_empty());
        let bin = var("ROUNDUP_CLAUDE_BIN")
            .map_or_else(|| "claude".into(), |bin| bin.to_string_lossy().into_owned());
        let home = var("HOME").map(PathBuf::from);
        let config_dir = var("CLAUDE_CONFIG_DIR").map(PathBuf::from);
        let claude_json = match (&config_dir, &home) {
            (Some(dir), _) => dir.join(".claude.json"),
            (None, Some(home)) => home.join(".claude.json"),
            (None, None) => return Err("neither CLAUDE_CONFIG_DIR nor HOME is set".into()),
        };
        let rup = var("ROUNDUP_RUP_BIN").map_or_else(|| exe.with_file_name("rup"), PathBuf::from);
        let mut launcher = Self::new(bin, claude_json, rup, home);
        if let Some(dir) = config_dir {
            launcher.conversation_dir = dir;
        }
        launcher.user_defaults = [
            "ENABLE_TOOL_SEARCH",
            "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS",
            "CLAUDE_CODE_PLUGIN_DIR_WATCH",
        ]
        .into_iter()
        .filter(|name| var(name).is_some())
        .collect();
        launcher.usage_url =
            var("ROUNDUP_CLAUDE_USAGE_URL").map(|url| url.to_string_lossy().into_owned());
        Ok(launcher)
    }

    /// Delete what `prepare` wrote for Agent `id`, for an Agent that never started.
    pub fn discard(dir: &Path, id: &str) -> std::io::Result<()> {
        // `prepare` writes nothing for an id that is not a node id.
        let Some(id) = parse_id(id) else {
            return Ok(());
        };
        for file in [
            settings_path(dir, id),
            mcp_config_path(dir, id),
            brief_path(dir, id),
            lean_path(dir, id),
        ] {
            match std::fs::remove_file(file) {
                Err(err) if err.kind() != ErrorKind::NotFound => return Err(err),
                _ => {}
            }
        }
        match std::fs::remove_dir_all(extras_dir(dir, id)) {
            Err(err) if err.kind() != ErrorKind::NotFound => return Err(err),
            _ => {}
        }
        remove_shims(dir, id)
    }

    /// LC4, LC7: remember that Agent `id` launches lean as `lean` says, for every launch after.
    pub fn save_lean(dir: &Path, id: &str, lean: &Lean) -> Result<(), RpcError> {
        let id = parse_id(id).ok_or_else(|| RpcError::internal("not a node id"))?;
        let value = serde_json::to_value(lean).map_err(RpcError::internal)?;
        replace_file(&lean_path(dir, id), &value).map_err(RpcError::internal)
    }

    /// What `save_lean` kept; `None` for an Agent that launches with the user's full setup.
    pub fn load_lean(dir: &Path, id: &str) -> Option<Lean> {
        let bytes = std::fs::read(lean_path(dir, parse_id(id)?)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// The names LC7 resolves against, for a Project at `project`.
    pub fn extras_sources<'a>(&'a self, project: &'a Path) -> extras::Sources<'a> {
        extras::Sources {
            claude_dir: &self.conversation_dir,
            claude_json: &self.claude_json,
            project,
        }
    }

    /// U3016h: the account's weekly use, read at most once a minute; spends no Model tokens.
    pub async fn weekly_limit(&self) -> contracts::project::WeeklyLimit {
        super::usage::weekly_limit(
            &self.usage,
            &self.conversation_dir,
            self.usage_url.as_deref(),
        )
        .await
    }

    /// Write Agent `id`'s settings, MCP config and Brief (E1, for its `role`) under `dir` (the Project's data folder, N1), trust
    /// `cwd`, and return the argv that starts it. Only a `cwd` inside the Project folder is trusted: Claude's config
    /// is the user's, and this is the only grant roundup makes in it. A22: `resume` is the saved
    /// conversation id to continue, added to argv as `--resume <id>`; `None` starts fresh.
    pub fn prepare(
        &self,
        folders: Folders<'_>,
        id: &str,
        attempt: &str,
        cwd: &Path,
        resume: Option<&str>,
        role: Role,
    ) -> Result<Vec<String>, RpcError> {
        self.prepare_on(folders, id, attempt, cwd, resume, role, &Pair::default())
    }

    /// Like `prepare`, on `pair` (A36): `--model` and `--effort` for each value that is set.
    #[allow(clippy::too_many_arguments)]
    pub fn prepare_on(
        &self,
        folders: Folders<'_>,
        id: &str,
        attempt: &str,
        cwd: &Path,
        resume: Option<&str>,
        role: Role,
        pair: &Pair,
    ) -> Result<Vec<String>, RpcError> {
        let Folders { project, data: dir } = folders;
        let invalid = |message: String| RpcError::new(code::INVALID_PARAMS, message);
        let id = parse_id(id).ok_or_else(|| invalid(format!("{id:?} is not a node id")))?;
        let cwd = cwd
            .canonicalize()
            .map_err(|err| invalid(format!("cwd {} is unusable: {err}", cwd.display())))?;
        if !cwd.is_dir() {
            return Err(invalid(format!("cwd {} is not a folder", cwd.display())));
        }
        if self
            .home
            .as_ref()
            .is_some_and(|home| home.canonicalize().is_ok_and(|home| home == cwd))
        {
            return Err(invalid(format!(
                "cwd {} is the home folder, which is never trusted",
                cwd.display()
            )));
        }
        // Claude reads the settings path from its own cwd, so it must be absolute.
        let dir = dir
            .canonicalize()
            .map_err(|err| RpcError::internal(format!("{}: {err}", dir.display())))?;
        let project = project
            .canonicalize()
            .map_err(|err| RpcError::internal(format!("{}: {err}", project.display())))?;
        if !cwd.starts_with(&project) {
            return Err(invalid(format!(
                "cwd {} is outside the project folder {}",
                cwd.display(),
                project.display()
            )));
        }
        if !self.rup.is_absolute() || !self.rup.is_file() {
            return Err(RpcError::internal(format!(
                "rup not found at {}: hooks could not signal",
                self.rup.display()
            )));
        }
        // Refuse a symlinked agents directory (A13) before writing anything, through the
        // link or beside it: the Project's own files are not ours to trust, and a link
        // could land a write anywhere.
        let agents_dir = agents_dir(&dir);
        if is_symlink(&agents_dir) {
            return Err(invalid(format!("{} is a symlink", agents_dir.display())));
        }
        let settings = settings_path(&dir, id);
        let mcp_config = mcp_config_path(&dir, id);
        let shims = shim_dir(&dir, id);
        if is_symlink(&shims) {
            return Err(invalid(format!("{} is a symlink", shims.display())));
        }
        let path = self.shell_path((role == Role::Door).then_some(shims.as_path()));
        if role == Role::Door {
            write_shims(&shims).map_err(RpcError::internal)?;
        }
        let mcp = !pair.mcp_off;
        let lean = lean_of(role, pair);
        let role = match (&lean, role) {
            (Some(lean), Role::Agent) if lean.scout => Role::Scout,
            _ => role,
        };
        let mut delivery = match &lean {
            Some(lean) => extras::resolve(&self.extras_sources(&project), &lean.extras)?,
            None => extras::Delivery::default(),
        };
        if lean.is_some() && profile(role).skills {
            for skill in extras::project_skills(&project) {
                if !delivery.skills.iter().any(|(name, _)| *name == skill.0) {
                    delivery.skills.push(skill);
                }
            }
        }
        let mut carried =
            user_settings(&self.conversation_dir, &project).map_err(RpcError::internal)?;
        if lean.is_some() {
            for key in [
                "outputStyle",
                "enabledPlugins",
                "mcpServers",
                "autoMemoryEnabled",
                "autoMemoryDirectory",
            ] {
                carried
                    .as_object_mut()
                    .expect("settings object")
                    .remove(key);
            }
        }
        let missing_intent = self.door_lacks_intent(role);
        replace_file(&settings, &{
            let mut own = self.settings_json(id, attempt, &path, mcp, missing_intent, &carried);
            if role == Role::Door && mcp {
                own["permissions"]["allow"] = json!(
                    brief::door_tools()
                        .filter(|name| *name != "terminal_write")
                        .map(|name| format!("mcp__roundup__{name}"))
                        .collect::<Vec<_>>()
                );
            }
            if lean.is_some() {
                own["env"]["CLAUDE_CODE_DISABLE_AUTO_MEMORY"] = json!("1");
            }
            for (key, value) in pair.env() {
                own["env"][key] = json!(value);
            }
            if lean.is_none() {
                let command = own["hooks"]["SessionStart"][0]["hooks"][1]["command"]
                    .as_str()
                    .expect("context command");
                own["hooks"]["SessionStart"][0]["hooks"][1]["command"] = json!(format!(
                    "ROUNDUP_BRIEF_FILE={} {command}",
                    shell_quote(&brief_path(&dir, id).to_string_lossy())
                ));
            }
            merge_settings(&mut carried, own);
            let mut settings = carried;
            if pair.yolo {
                settings["skipDangerousModePermissionPrompt"] = json!(true);
                // Roundup has already checked its Route, Takeover and actor authority. Claude's
                // inbox class vocabulary differs from the launch-mode label on our notes.
                settings["crossSessionInbound"] = json!("accept");
            }
            settings
        })
        .map_err(RpcError::internal)?;
        let mut servers = Map::new();
        if mcp {
            servers.extend(self.mcp_servers(id));
        }
        servers.extend(delivery.servers.clone());
        let has_config = !servers.is_empty();
        if has_config {
            replace_file(&mcp_config, &json!({ "mcpServers": servers }))
                .map_err(RpcError::internal)?;
        } else if is_symlink(&mcp_config) {
            return Err(invalid(format!("{} is a symlink", mcp_config.display())));
        } else {
            // An earlier launch with MCP on left its config; the Agent must not find it.
            match std::fs::remove_file(&mcp_config) {
                Err(err) if err.kind() != std::io::ErrorKind::NotFound => {
                    return Err(RpcError::internal(err));
                }
                _ => {}
            }
        }
        let brief_file = brief_path(&dir, id);
        let mut brief = brief::text(role, mcp);
        if missing_intent {
            brief = brief::without_intent(&brief);
        }
        if lean.is_some() && profile(role).global_instructions {
            self.append_global_instructions(&mut brief);
        }
        if lean.is_some() {
            for folder in std::iter::once(&project).chain((cwd != project).then_some(&cwd)) {
                if let Ok(text) = std::fs::read_to_string(folder.join("CLAUDE.md")) {
                    brief.push_str("\n## The Project's instructions (read-only)\n\n");
                    brief.push_str(&text);
                    brief.push('\n');
                }
            }
        }
        replace_text(&brief_file, &brief).map_err(RpcError::internal)?;
        self.trust(&cwd)?;
        let mut argv = vec![
            self.bin.clone(),
            "--settings".into(),
            settings.to_string_lossy().into_owned(),
        ];
        if has_config {
            argv.push("--mcp-config".into());
            argv.push(mcp_config.to_string_lossy().into_owned());
        }
        if let Some(lean) = &lean {
            argv.push("--append-system-prompt-file".into());
            argv.push(brief_file.to_string_lossy().into_owned());
            // LC2: use the merged copy so original sources cannot restore the named exclusions.
            argv.extend(["--strict-mcp-config", "--setting-sources", ""].map(String::from));
            let row = profile(role);
            if let Some((with, without)) = row.tools {
                argv.push("--tools".into());
                argv.push(if mcp { with } else { without }.into());
            }
            let skills = !delivery.skills.is_empty();
            let commands = row
                .skills
                .then(|| project.join(".claude/commands"))
                .filter(|path| path.is_dir());
            if !row.skills && !skills {
                argv.push("--disable-slash-commands".into());
            }
            if skills || commands.is_some() {
                let folder = extras::skill_plugin(
                    &extras_dir(&dir, id),
                    &delivery.skills,
                    commands.as_deref(),
                )?;
                argv.extend(["--plugin-dir".into(), folder.to_string_lossy().into_owned()]);
            }
            for plugin in &delivery.plugins {
                argv.extend(["--plugin-dir".into(), plugin.to_string_lossy().into_owned()]);
            }
            if lean.fresh_brief && resume.is_some() {
                argv.extend(["--system-prompt-snapshot", "off"].map(String::from));
            }
        }
        for (flag, value) in [("--model", &pair.model), ("--effort", &pair.effort)] {
            if let Some(value) = value {
                argv.push(flag.into());
                argv.push(value.clone());
            }
        }
        // B50: a note reaches the Agent over this socket; its permission mode is the one the
        // note's sender names, so the receiver never holds the note for approval.
        // A socket an earlier run of this Agent left behind is not the new session's to find.
        let socket = self.socket_path(id);
        match std::fs::remove_file(&socket) {
            Err(err) if err.kind() != ErrorKind::NotFound => return Err(RpcError::internal(err)),
            _ => {}
        }
        argv.push("--messaging-socket-path".into());
        argv.push(socket.to_string_lossy().into_owned());
        if pair.yolo {
            self.modes
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id.to_string());
            argv.extend(["--permission-mode", "bypassPermissions"].map(String::from));
        } else {
            // A note names the same selected or inherited mode as this launch.
            let mode = match pair.permission_mode {
                Some(mode) => {
                    let mode = super::models::permission_mode(mode);
                    argv.extend(["--permission-mode".into(), mode.into()]);
                    mode.to_owned()
                }
                None => super::inbox::default_mode(&self.conversation_dir, &project),
            };
            self.modes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(
                    id.to_string(),
                    super::models::LaunchMode {
                        effective: mode,
                        selected: pair.permission_mode,
                    },
                );
        }
        if pair.yolo {
            argv.push("--dangerously-skip-permissions".into());
        }
        if let Some(conversation_id) = resume {
            argv.push("--resume".into());
            argv.push(conversation_id.to_owned());
        }
        Ok(argv)
    }

    /// A3507a: process-free Agent launch construction, shared by starts and resumes.
    #[allow(clippy::too_many_arguments)]
    pub fn command_on(
        &self,
        folders: Folders<'_>,
        id: &str,
        attempt: &str,
        cwd: &Path,
        resume: Option<&str>,
        role: Role,
        pair: &Pair,
    ) -> Result<std::process::Command, RpcError> {
        let argv = self.prepare_on(folders, id, attempt, cwd, resume, role, pair)?;
        let mut command = std::process::Command::new(&argv[0]);
        command.args(&argv[1..]).current_dir(cwd).envs(pair.env());
        let settings: Value =
            serde_json::from_slice(&std::fs::read(&argv[2]).map_err(RpcError::internal)?)
                .map_err(RpcError::internal)?;
        for key in [
            "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS",
            "CLAUDE_CODE_PLUGIN_DIR_WATCH",
        ] {
            if !self.user_defaults.contains(key)
                && let Some(value) = settings["env"][key].as_str()
            {
                command.env(key, value);
            }
        }
        for marker in super::MARKERS {
            command.env_remove(marker);
        }
        if lean_of(role, pair).is_some() {
            command.env("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1");
        }
        command.env("ROUNDUP_AGENT", id);
        if let Some(dir) = self.rup.parent().filter(|dir| dir.is_absolute()) {
            let inherited = std::env::var_os("PATH").unwrap_or_default();
            let paths = std::iter::once(dir.to_path_buf()).chain(std::env::split_paths(&inherited));
            if let Ok(path) = std::env::join_paths(paths) {
                command.env("PATH", path);
            }
        }
        Ok(command)
    }

    /// Q11: the production launch seam. Keep this Launcher alive while its Agents run:
    /// it owns their complete bundle. Initial launch, resume and clear use this same seam.
    /// Probe the selected executable once; validate the pinned files before every launch.
    #[allow(clippy::too_many_arguments)]
    pub async fn launch_on(
        &self,
        folders: Folders<'_>,
        id: &str,
        attempt: &str,
        cwd: &Path,
        resume: Option<&str>,
        role: Role,
        pair: &Pair,
    ) -> Result<(Vec<String>, BTreeMap<String, String>), RpcError> {
        let (launcher, project, data, id, attempt, cwd, resume, pair) = (
            self.clone(),
            folders.project.to_owned(),
            folders.data.to_owned(),
            id.to_owned(),
            attempt.to_owned(),
            cwd.to_owned(),
            resume.map(str::to_owned),
            pair.clone(),
        );
        let lean = lean_of(role, &pair);
        let (resume_given, id_text) = (resume.is_some(), id.clone());
        let missing = self.door_lacks_intent(role);
        let bundled = match &lean {
            _ if missing => &[][..],
            None => profile(Role::Agent).bundled_plugins,
            Some(lean) => profile(if lean.scout { Role::Scout } else { role }).bundled_plugins,
        };
        let command = tokio::task::spawn_blocking(move || {
            launcher.command_on(
                Folders {
                    project: &project,
                    data: &data,
                },
                &id,
                &attempt,
                &cwd,
                resume.as_deref(),
                role,
                &pair,
            )
        })
        .await
        .map_err(RpcError::internal)??;
        let mut argv = std::iter::once(command.get_program())
            .chain(command.get_args())
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let mut env: BTreeMap<String, String> = command
            .get_envs()
            .filter_map(|(key, value)| {
                Some((
                    key.to_string_lossy().into_owned(),
                    value?.to_string_lossy().into_owned(),
                ))
            })
            .collect();
        let data = folders.data.canonicalize().map_err(RpcError::internal)?;
        let delivery = self
            .plugins
            .get_or_try_init(|| async {
                let dir = data.clone();
                let plugins = tokio::task::spawn_blocking(move || plugins::materialize(&dir))
                    .await
                    .map_err(RpcError::internal)?
                    .map_err(RpcError::internal)?;
                let executable = self.executable()?;
                let runtime = plugins
                    .runtime(&executable)
                    .await
                    .map_err(RpcError::internal)?;
                Ok::<_, RpcError>(Delivery {
                    data: data.clone(),
                    plugins,
                    runtime,
                })
            })
            .await?;
        if delivery.data != data {
            return Err(RpcError::internal(
                "Q11 Launcher belongs to another Project data directory",
            ));
        }
        let command = delivery
            .runtime
            .command(&delivery.plugins)
            .map_err(RpcError::internal)?;
        let command = command.as_std();
        argv[0] = command.get_program().to_string_lossy().into_owned();
        // LC5, LC14: each role's bundled plugins, by the folder name `Runtime::command` passes.
        let args: Vec<_> = command.get_args().collect();
        for pair in args.chunks(2) {
            let named = Path::new(pair[1]).file_name().and_then(OsStr::to_str);
            if named.is_some_and(|name| bundled.contains(&name)) {
                argv.extend(pair.iter().map(|arg| arg.to_string_lossy().into_owned()));
            }
        }
        for (key, value) in command.get_envs() {
            let key = key.to_string_lossy();
            if !self.user_defaults.contains(key.as_ref())
                && let Some(value) = value
            {
                env.entry(key.into_owned())
                    .or_insert_with(|| value.to_string_lossy().into_owned());
            }
        }
        // LC8: the changed Brief has applied once.
        if let Some(mut lean) = lean.filter(|lean| lean.fresh_brief && resume_given) {
            lean.fresh_brief = false;
            Self::save_lean(folders.data, &id_text, &lean)?;
        }
        Ok((argv, env))
    }

    pub(super) fn executable(&self) -> Result<PathBuf, RpcError> {
        let path = Path::new(&self.bin);
        if path.components().count() > 1 || path.is_absolute() {
            return Ok(path.to_owned());
        }
        std::env::var_os("PATH")
            .and_then(|paths| {
                std::env::split_paths(&paths)
                    .map(|dir| dir.join(path))
                    .find(|path| {
                        std::fs::metadata(path).is_ok_and(|meta| {
                            meta.is_file() && meta.permissions().mode() & 0o111 != 0
                        })
                    })
            })
            .ok_or_else(|| {
                RpcError::internal(format!(
                    "Q11 Claude executable {} not found on PATH",
                    self.bin
                ))
            })
    }

    /// Set `hasTrustDialogAccepted` for `cwd`, under its NFC form (the key Claude Code looks up), keeping every other key. A config that cannot be
    /// read as a JSON object is an error, never overwritten. Trust is never withdrawn: an Agent
    /// ending says nothing about the folder, and the user may have trusted it before roundup did.
    fn trust(&self, cwd: &Path) -> Result<(), RpcError> {
        let _serial = TRUSTING.lock().unwrap_or_else(PoisonError::into_inner);
        let _lock = ConfigLock::take(&self.claude_json).map_err(RpcError::internal)?;
        let mut config = match std::fs::read_to_string(&self.claude_json) {
            Ok(text) => serde_json::from_str(&text).map_err(|err| self.unreadable(err))?,
            Err(err) if err.kind() == ErrorKind::NotFound => json!({}),
            Err(err) => return Err(self.unreadable(err)),
        };
        let projects = object(&mut config)
            .and_then(|root| object(root.entry("projects").or_insert_with(|| json!({}))))
            .map_err(|err| self.unreadable(err))?;
        let project = projects
            .entry(cwd.to_string_lossy().nfc().collect::<String>())
            .or_insert_with(|| json!({}));
        object(project)
            .map_err(|err| self.unreadable(err))?
            .insert("hasTrustDialogAccepted".into(), true.into());
        replace_file(
            &landing(&self.claude_json).map_err(RpcError::internal)?,
            &config,
        )
        .map_err(RpcError::internal)
    }

    /// A20: the hook command, not the program, carries the launch's Attempt.
    /// A43: `path` is the Agent's `PATH` in Claude Code's `env`, and `ROUNDUP_AGENT_ID` its id.
    fn settings_json(
        &self,
        id: u64,
        attempt: &str,
        path: &OsStr,
        mcp: bool,
        missing_intent: bool,
        carried: &Value,
    ) -> Value {
        let agent_id = id.to_string();
        let rup = shell_quote(&self.rup.to_string_lossy());
        let id = shell_quote(&id.to_string());
        // H9: `PermissionRequest` waits for the user's answer, so its hook outlives the 5 s of the rest.
        let signal = json!([{ "hooks": [{
            "type": "command",
            "command": format!("ROUNDUP_ATTEMPT={} {rup} signal {id}", shell_quote(attempt)),
            "timeout": 5,
        }] }]);
        let permission = json!([{ "hooks": [{
            "type": "command",
            "command": format!("{rup} permission {id}"),
            "timeout": super::PERMISSION_TIMEOUT_SECS,
        }] }]);
        // E3: at start the Agent is told its Context, by a second command beside the Signal.
        let session_start = json!([{ "hooks": [
            signal[0]["hooks"][0].clone(),
            { "type": "command", "command": format!("{rup} context {id}"), "timeout": 5 },
        ] }]);
        let hooks: Map<String, Value> = STATE_EVENTS
            .iter()
            .map(|event| {
                let hook = match *event {
                    "PermissionRequest" => &permission,
                    "SessionStart" => &session_start,
                    _ => &signal,
                };
                ((*event).to_owned(), hook.clone())
            })
            .collect();
        // Allowed here so a roundup tool never raises a permission dialog.
        let mut settings = json!({ "hooks": hooks });
        if mcp {
            settings["permissions"] = json!({ "allow": ["mcp__roundup__*"] });
        }
        // LC14: Claude Code's status line keeps the one line on screen for the whole session.
        if missing_intent {
            settings["statusLine"] = json!({
                "type": "command",
                "command": format!("printf %s {}", shell_quote(INTENT_MISSING)),
            });
        }
        // User env wins over defaults; identity, PATH and the named lean exclusion are explicit.
        let mut env = Map::new();
        for (key, default) in [
            ("CLAUDE_CODE_ENABLE_FUNCTION_HOOKS", "1"),
            ("CLAUDE_CODE_PLUGIN_DIR_WATCH", "0"),
            ("ENABLE_TOOL_SEARCH", "true"),
        ] {
            if carried["env"].get(key).is_none() && !self.user_defaults.contains(key) {
                env.insert(key.into(), default.into());
            }
        }
        env.insert("ROUNDUP_AGENT_ID".into(), agent_id.into());
        env.insert("PATH".into(), path.to_string_lossy().into());
        settings["env"] = Value::Object(env);
        settings
    }

    /// A43: the folder of `rup`, then (F4) a Door's `shims`, then the `PATH` this process has.
    fn shell_path(&self, shims: Option<&Path>) -> OsString {
        let mut path = self
            .rup
            .parent()
            .map_or_else(OsString::new, |dir| dir.as_os_str().to_owned());
        for next in shims.map(Path::as_os_str).into_iter().chain(
            std::env::var_os("PATH")
                .as_deref()
                .filter(|p| !p.is_empty()),
        ) {
            path.push(":");
            path.push(next);
        }
        path
    }

    /// `RUPD_SOCKET` is left out: Claude Code's environment, which the server inherits, has it.
    fn mcp_servers(&self, id: u64) -> Map<String, Value> {
        let Value::Object(servers) = json!({ "roundup": {
            "type": "stdio",
            "command": self.rup.to_string_lossy(),
            "args": ["mcp", id.to_string()],
        } }) else {
            unreachable!("an object literal");
        };
        servers
    }

    /// LC5: the user's global `CLAUDE.md`, as read-only text under a heading.
    fn append_global_instructions(&self, brief: &mut String) {
        if let Ok(text) = std::fs::read_to_string(self.conversation_dir.join("CLAUDE.md"))
            && !text.trim().is_empty()
        {
            brief.push_str("\n## The user's global instructions (read-only)\n\n");
            brief.push_str(text.trim_end());
            brief.push('\n');
        }
    }

    fn unreadable(&self, err: impl std::fmt::Display) -> RpcError {
        RpcError::internal(format!("{}: {err}", self.claude_json.display()))
    }
}

fn object(value: &mut Value) -> Result<&mut Map<String, Value>, &'static str> {
    value.as_object_mut().ok_or("expected a JSON object")
}

/// An Agent id becomes a file name and a shell word, so only a node id in its one form (decimal,
/// no sign, no leading zero) is accepted; `;` or `../` never reach a shell or a path.
impl Launcher {
    /// The private folder Agents' messaging sockets are made in.
    pub(super) fn socket_dir(&self) -> &Path {
        self.sockets
            .get_or_init(|| socket_folder().expect("a private folder for messaging sockets"))
            .path()
    }
}

fn parse_id(id: &str) -> Option<u64> {
    id.parse()
        .ok()
        .filter(|number: &u64| number.to_string() == id)
}

fn agents_dir(dir: &Path) -> PathBuf {
    dir.join("agents")
}

fn settings_path(dir: &Path, id: u64) -> PathBuf {
    agents_dir(dir).join(format!("{id}.settings.json"))
}

fn mcp_config_path(dir: &Path, id: u64) -> PathBuf {
    agents_dir(dir).join(format!("{id}.mcp.json"))
}

fn shim_dir(dir: &Path, id: u64) -> PathBuf {
    agents_dir(dir).join(format!("{id}.bin"))
}

/// The first command-line word of a Door's Claude Code names this file, so a process table row
/// that holds it is that Door's program (F5).
pub fn settings_marker(dir: &Path, id: &str) -> Option<PathBuf> {
    let dir = dir.canonicalize().ok()?;
    Some(settings_path(&dir, parse_id(id)?))
}

/// One executable in `shims` for each program name an Adapter supplies, each failing loud.
fn write_shims(shims: &Path) -> std::io::Result<()> {
    for program in super::programs() {
        let script = format!(
            "#!/bin/sh\necho {} >&2\nexit 1\n",
            shell_quote(SHIM_MESSAGE)
        );
        let path = shims.join(program);
        replace_text(&path, &script)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

fn remove_shims(dir: &Path, id: u64) -> std::io::Result<()> {
    match std::fs::remove_dir_all(shim_dir(dir, id)) {
        Err(err) if err.kind() != ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}

fn lean_path(dir: &Path, id: u64) -> PathBuf {
    agents_dir(dir).join(format!("{id}.lean.json"))
}

fn extras_dir(dir: &Path, id: u64) -> PathBuf {
    agents_dir(dir).join(format!("{id}.extras"))
}

/// LC1, LC6: how `role`'s child launches: lean for a Door and for the child of a Door or an Agent,
/// the user's full setup for an Agent the user started.
fn lean_of(role: Role, pair: &Pair) -> Option<Lean> {
    match (role, &pair.lean) {
        (_, Some(lean)) => Some(lean.clone()),
        (Role::Door, None) => Some(Lean::default()),
        _ => None,
    }
}

fn brief_path(dir: &Path, id: u64) -> PathBuf {
    agents_dir(dir).join(format!("{id}.brief.md"))
}
