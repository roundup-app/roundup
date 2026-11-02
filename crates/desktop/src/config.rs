use std::ffi::OsString;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// `sockaddr_un.sun_path` on macOS holds 104 bytes including the terminating NUL.
const SOCKET_PATH_LIMIT: usize = 104;

/// How long `open_project` waits for the Daemon to answer `daemon.ping`.
pub const READY_BOUND: Duration = Duration::from_secs(10);

/// How long one `rpc` call waits for its reply before the App reports an unknown outcome.
pub const CALL_BOUND: Duration = Duration::from_secs(30);

/// Everything the App reads from its environment, resolved once at startup.
#[derive(Clone, Debug)]
pub struct Config {
    pub rupd_bin: PathBuf,
    /// The packaged `terminal-owner` beside the App (X8), handed to each Daemon as
    /// `RUPD_TERMINAL_OWNER` so a Daemon lost without S3's shutdown leaves its Agents' programs
    /// for the next one to reattach (A12a). `None` when the helper is not there.
    pub terminal_owner: Option<PathBuf>,
    pub claude_bin: Option<OsString>,
    pub search_path: OsString,
    pub socket: PathBuf,
    pub ready_bound: Duration,
    pub call_bound: Duration,
    /// Where names and the open list are kept (S10); `None` until the App resolves its own data folder.
    pub data_dir: Option<PathBuf>,
}

impl Config {
    /// `rupd_env` is `ROUNDUP_RUPD_BIN`; without it the Daemon is the `rupd` beside `exe`.
    /// The socket is unique to this run through `pid`.
    pub fn locate(
        rupd_env: Option<OsString>,
        exe: &Path,
        socket_dir: &Path,
        pid: u32,
    ) -> Result<Self, String> {
        let rupd_bin = rupd_env
            .map(PathBuf::from)
            .unwrap_or_else(|| exe.parent().unwrap_or_else(|| Path::new(".")).join("rupd"));
        let terminal_owner = Some(exe.with_file_name("terminal-owner")).filter(|p| p.is_file());
        let socket = socket_dir.join(format!("roundup-{pid}.sock"));
        check_limit(&socket)?;
        Ok(Self {
            rupd_bin,
            terminal_owner,
            claude_bin: None,
            search_path: OsString::new(),
            socket,
            ready_bound: READY_BOUND,
            call_bound: CALL_BOUND,
            data_dir: None,
        })
    }

    /// The socket path for one Daemon run: `socket` unchanged for the first (`run` 0), and a
    /// fresh path for each further run (a reopen, S5) so the old and new Daemon never share one.
    /// A reopen whose prefixed path would break the 104-byte limit is refused here, before the
    /// App ever asks `rupd` to bind it (S5 keeps S1's "under the 104-byte limit" exactly).
    pub(crate) fn socket_for_run(&self, run: u64) -> Result<PathBuf, String> {
        if run == 0 {
            return Ok(self.socket.clone());
        }
        let file_name = self
            .socket
            .file_name()
            .expect("the socket path has a file name");
        let path = self
            .socket
            .with_file_name(format!("{run}-{}", file_name.to_string_lossy()));
        check_limit(&path)?;
        Ok(path)
    }

    pub(crate) fn context<R: tauri::Runtime>(&self) -> std::io::Result<tauri::Context<R>> {
        let mut context = crate::context();
        if let Some(dir) = &self.data_dir {
            let dir = std::path::absolute(dir)?;
            // R20: a directory override alone leaves the macOS single-instance socket
            // shared with the installed App, which can consume the launch and exit 0.
            // Keep it bounded for sun_path and repeatable for this build/profile.
            let mut identity = DefaultHasher::new();
            dir.hash(&mut identity);
            let config = context.config_mut();
            config.identifier = format!("{}.profile-{:016x}", config.identifier, identity.finish());
            config.app.app_directories_override =
                Some(tauri::utils::config::AppDirectoriesOverride::Root(dir));
        }
        Ok(context)
    }

    pub fn from_env() -> Result<Self, String> {
        let exe = std::env::current_exe()
            .map_err(|err| format!("cannot find the App's own executable: {err}"))?;
        let mut config = Self::locate(
            std::env::var_os("ROUNDUP_RUPD_BIN"),
            &exe,
            &std::env::temp_dir(),
            std::process::id(),
        )?;
        config.claude_bin = std::env::var_os("ROUNDUP_CLAUDE_BIN");
        config.search_path = std::env::var_os("PATH").unwrap_or_default();
        config.data_dir = std::env::var_os("ROUNDUP_DATA_DIR").map(PathBuf::from);
        Ok(config)
    }
}

fn check_limit(socket: &Path) -> Result<(), String> {
    let bytes = socket.as_os_str().len();
    if bytes >= SOCKET_PATH_LIMIT {
        return Err(format!(
            "the Daemon socket path {} is {bytes} bytes; a unix socket path must be under {SOCKET_PATH_LIMIT}",
            socket.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn r20_perf_data_override_keeps_saved_tabs_untouched() {
        const CHILD: &str = "R20_ISOLATED_CONFIG_TEST";
        if std::env::var_os(CHILD).is_none() {
            let fixture = tempfile::tempdir().unwrap();
            let seeded = fixture.path().join("saved");
            std::fs::create_dir(&seeded).unwrap();
            let saved = br#"{"open":["/original/project"],"names":{}}"#;
            std::fs::write(seeded.join("projects.json"), saved).unwrap();
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "config::tests::r20_perf_data_override_keeps_saved_tabs_untouched",
                ])
                .env(CHILD, &seeded)
                .env("ROUNDUP_DATA_DIR", fixture.path().join("isolated"))
                .status()
                .unwrap();
            assert!(status.success());
            assert_eq!(std::fs::read(seeded.join("projects.json")).unwrap(), saved);
            assert!(fixture.path().join("isolated/projects.json").is_file());
            return;
        }
        let config = Config::from_env().unwrap();
        let store = crate::store::Store::new(config.data_dir);
        // Mirrors setup's fallback: resolving the native App folder must not replace
        // the explicit override or restore its saved Projects.
        store.use_dir(PathBuf::from(std::env::var_os(CHILD).unwrap()));
        assert!(store.open_paths().unwrap().is_empty());
        store.set_open(vec!["/tmp/bench/project".into()]).unwrap();
    }

    #[test]
    fn r20_perf_profile_does_not_share_the_installed_apps_singleton() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = Config::locate(None, Path::new("/unused/roundup"), dir.path(), 1).unwrap();
        let installed = config.context::<tauri::test::MockRuntime>().unwrap();
        let mut identifiers =
            std::collections::BTreeSet::from([installed.config().identifier.clone()]);
        for name in ["run-one", "run-two"] {
            config.data_dir = Some(dir.path().join(name));
            let first = config.context::<tauri::test::MockRuntime>().unwrap();
            let reopened = config.context::<tauri::test::MockRuntime>().unwrap();
            // The plugin keys its macOS singleton socket by this Tauri identifier.
            // Reopening one profile must find itself, never another run or the installed App.
            assert_eq!(first.config().identifier, reopened.config().identifier);
            assert!(
                identifiers.insert(first.config().identifier.clone()),
                "isolated profile would forward its Project to another App and exit before setup"
            );
        }
    }

    /// Mirrors `s1_a_socket_path_of_103_bytes_is_accepted_and_104_is_rejected` (`tests/app.rs`):
    /// builds a base socket path of an exact byte length so a reopen's `{run}-` prefix can be
    /// pushed past the limit on purpose.
    fn dir_of(socket_len: usize) -> PathBuf {
        let socket_name_len = "/roundup-1.sock".len();
        PathBuf::from(format!("/{}", "d".repeat(socket_len - socket_name_len - 1)))
    }

    #[test]
    fn s5_a_reopen_whose_prefixed_path_would_break_the_limit_is_refused_up_front() {
        let config = Config::locate(None, Path::new("/a/roundup"), &dir_of(102), 1).unwrap();
        assert_eq!(config.socket.as_os_str().len(), 102);

        let reopened = config.socket_for_run(1);

        let err = reopened.expect_err("a 104-byte reopen path must be refused, not bind-failed");
        assert!(err.contains("104"));
    }

    #[test]
    fn s5_a_reopen_whose_prefixed_path_stays_under_the_limit_is_accepted() {
        let config = Config::locate(None, Path::new("/a/roundup"), &dir_of(101), 1).unwrap();

        let reopened = config.socket_for_run(1).unwrap();

        assert_eq!(reopened.as_os_str().len(), 103);
    }
}
