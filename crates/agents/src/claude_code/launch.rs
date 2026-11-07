//! What an Agent's Claude Code is started with: a per-Agent settings file whose command hook is
//! `rup signal <agent-id>`, a per-Agent MCP config that runs `rup mcp <agent-id>`, and a pre-trusted
//! working directory (no hook fires for the trust dialog).
#![deny(clippy::fn_params_excessive_bools)]

use crate::id::AgentId;
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::io::ErrorKind;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use super::vendor_list::Sidecar;
use rpc::{OpenError, RpcError, code};
use serde_json::{Map, Value, json};
use shlex::try_quote;
use tokio::sync::OnceCell;
use unicode_normalization::UnicodeNormalization;

use super::brief::Role;
use super::extras;
use super::launch_files::{
    ConfigLock, is_symlink, landing, replace_file, replace_text, user_settings,
};
use super::models::{LaunchFacts, Lean, Permission};
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
    /// U3523f: the bundled Node sidecar Import lists through.
    pub(super) sidecar: Option<Sidecar>,
    /// Counts started listings; a newer one supersedes the one running (U3523a).
    pub(super) listings: Arc<tokio::sync::watch::Sender<u64>>,
    /// Filesystem observer for isolated import tests; absent from production builds.
    #[cfg(any(test, feature = "test-support"))]
    pub import_observer: Option<ImportObserver>,
    /// The `rup` the hooks run, by absolute path: a hook's PATH is not ours to trust.
    rup: PathBuf,
    /// The user's home folder, never trusted: Claude never saves trust for it, and a saved one
    /// would trust every non-git folder below it.
    home: Option<PathBuf>,
    /// User shell values take precedence over roundup defaults.
    user_defaults: BTreeSet<&'static str>,
    /// LC14: true only for a Launcher made `without_intent_skill`; the bundle is read at a Door's start.
    lacks_intent: bool,
    pub(crate) fork_session: bool,
    plugins: Arc<OnceCell<Delivery>>,
    /// B50: the private folder each Agent's messaging socket is made in, made at the first
    /// launch; gone with the Launcher.
    pub(super) sockets: Arc<std::sync::OnceLock<tempfile::TempDir>>,
    pub(super) retained_inboxes: Arc<Mutex<std::collections::HashMap<String, PathBuf>>>,
    /// B2706: the permission mode each Agent's latest normal Attempt runs in, for its notes.
    pub(super) modes: Arc<Mutex<std::collections::HashMap<String, super::models::LaunchMode>>>,
    /// RO1: what each saved conversation's overview was read to, shared by every clone.
    pub(super) overviews: Arc<super::overview_cache::OverviewCache>,
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

/// One launch of an Agent: where it runs, which conversation it continues and how it is set.
#[derive(Clone, Copy)]
pub struct Request<'a> {
    pub folders: Folders<'a>,
    pub id: &'a str,
    pub attempt: &'a str,
    pub cwd: &'a Path,
    /// A22: the saved conversation to continue; `None` starts fresh.
    pub resume: Option<&'a str>,
    pub role: Role,
    pub facts: &'a LaunchFacts,
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
            #[cfg(not(any(test, feature = "test-support")))]
            sidecar: None,
            #[cfg(any(test, feature = "test-support"))]
            sidecar: Some(Sidecar {
                dir: Path::new(env!("CARGO_MANIFEST_DIR")).join("sidecar"),
            }),
            listings: Arc::new(tokio::sync::watch::channel(0).0),
            #[cfg(any(test, feature = "test-support"))]
            import_observer: None,
            bin: bin.into(),
            claude_json,
            rup,
            home,
            user_defaults: BTreeSet::new(),
            lacks_intent: false,
            fork_session: false,
            plugins: Arc::new(OnceCell::new()),
            sockets: Arc::new(std::sync::OnceLock::new()),
            retained_inboxes: Default::default(),
            modes: Arc::default(),
            overviews: Arc::default(),
        }
    }

    /// LC14: this Launcher for a bundle without `hope`'s `intent` skill. The pinned bundle holds
    /// it, so this is how a Door's start without it is reached.
    #[must_use]
    pub fn without_intent_skill(mut self) -> Self {
        self.lacks_intent = true;
        self
    }

    fn door_lacks_intent(&self, role: Role, settings: &Value, project: &Path) -> bool {
        if role != Role::Door {
            return false;
        }
        if let Some(name) = enabled_plugin(settings, "hope") {
            return extras::resolve(
                &self.extras_sources(project),
                &contracts::agent::Extras {
                    plugins: vec![name.to_owned()],
                    ..Default::default()
                },
            )
            .ok()
            .is_none_or(|delivery| {
                !delivery
                    .plugins
                    .iter()
                    .any(|path| path.join("skills/intent/SKILL.md").is_file())
            });
        }
        self.lacks_intent || !plugins::has_intent()
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
        launcher.sidecar = Sidecar::beside(exe, var("ROUNDUP_SIDECAR_DIR"));
        Ok(launcher)
    }

    /// Delete what `prepare` wrote for Agent `id`, for an Agent that never started.
    pub fn discard(dir: &Path, id: &str) -> std::io::Result<()> {
        // `prepare` writes nothing for an id that is not a node id.
        let Some(id) = AgentId::parse(id) else {
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

    /// The names LC7 resolves against, for a Project at `project`.
    pub fn extras_sources<'a>(&'a self, project: &'a Path) -> extras::Sources<'a> {
        extras::Sources {
            claude_dir: &self.conversation_dir,
            claude_json: &self.claude_json,
            project,
        }
    }
}

mod parts;
mod paths;
mod plan;
mod seam;
mod write;

use self::paths::Paths;
pub(in crate::claude_code) use paths::lean_path;
pub use paths::settings_marker;
use paths::*;
