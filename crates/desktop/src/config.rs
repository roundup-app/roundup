use std::ffi::OsString;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::{Channel, Error};

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
    pub claude_bin: Option<OsString>,
    pub search_path: OsString,
    pub socket: PathBuf,
    pub ready_bound: Duration,
    pub call_bound: Duration,
    /// The waits before each automatic Daemon reopen (U6249b); tests shorten them.
    pub reopen_waits: [Duration; 3],
    /// Where names and the open list are kept (S10); `None` until the App resolves its own data folder.
    pub data_dir: Option<PathBuf>,
    /// `ROUNDUP_DEV_PORT` (S13): the Vite port `just app` gave this run; `devUrl` follows it.
    pub dev_port: Option<u16>,
    /// CH7077: which build this is.
    pub channel: Channel,
    /// CH7077c: why this build opens nothing, said to the user before any Daemon starts.
    pub refusal: Option<String>,
}

impl Config {
    /// `rupd_env` is `ROUNDUP_RUPD_BIN`; without it the Daemon is the `rupd` beside `exe`.
    /// The socket is unique to this run through `pid`.
    pub fn locate(
        rupd_env: Option<OsString>,
        exe: &Path,
        socket_dir: &Path,
        pid: u32,
    ) -> Result<Self, Error> {
        let rupd_bin = rupd_env
            .map(PathBuf::from)
            .unwrap_or_else(|| exe.parent().unwrap_or_else(|| Path::new(".")).join("rupd"));
        let socket = socket_dir.join(format!("roundup-{pid}.sock"));
        check_limit(&socket)?;
        Ok(Self {
            rupd_bin,
            claude_bin: None,
            search_path: OsString::new(),
            socket,
            ready_bound: READY_BOUND,
            call_bound: CALL_BOUND,
            reopen_waits: crate::reopen::WAITS,
            data_dir: None,
            dev_port: None,
            channel: Channel::Source,
            refusal: None,
        })
    }

    /// The wait after the `failures`-th failure of a Daemon, or `None` once recovery is spent (U6249b).
    pub(crate) fn reopen_wait(&self, failures: u8) -> Option<Duration> {
        let index = usize::from(failures).checked_sub(1)?;
        self.reopen_waits.get(index).copied()
    }

    /// The socket path for one Daemon run: `socket` unchanged for the first (`run` 0), and a
    /// fresh path for each further run (a reopen, S5) so the old and new Daemon never share one.
    /// A reopen whose prefixed path would break the 104-byte limit is refused here, before the
    /// App ever asks `rupd` to bind it (S5 keeps S1's "under the 104-byte limit" exactly).
    pub(crate) fn socket_for_run(&self, run: u64) -> Result<PathBuf, Error> {
        if run == 0 {
            return Ok(self.socket.clone());
        }
        let Some(file_name) = self.socket.file_name() else {
            return Err(Error::SocketPathNoName(self.socket.clone()));
        };
        let path = self
            .socket
            .with_file_name(format!("{run}-{}", file_name.to_string_lossy()));
        check_limit(&path)?;
        Ok(path)
    }

    /// `context` with this run's dev port and data folder applied.
    pub(crate) fn apply<R: tauri::Runtime>(
        &self,
        mut context: tauri::Context<R>,
    ) -> std::io::Result<tauri::Context<R>> {
        if let (Some(port), true) = (self.dev_port, cfg!(debug_assertions)) {
            context.config_mut().build.dev_url = Some(
                format!("http://localhost:{port}")
                    .parse()
                    .map_err(std::io::Error::other)?,
            );
        }
        if let Some(dir) = &self.data_dir {
            let dir = std::path::absolute(dir)?;
            let config = context.config_mut();
            // R20: a directory override alone leaves the macOS single-instance socket
            // shared with the installed App, which can consume the launch and exit 0.
            // Keep it bounded for sun_path and repeatable for this build/profile. An installed
            // build keeps its own identifier, which no other build shares (CH7077a).
            if !self.channel.installed() {
                let mut identity = DefaultHasher::new();
                dir.hash(&mut identity);
                config.identifier =
                    format!("{}.profile-{:016x}", config.identifier, identity.finish());
            }
            config.app.app_directories_override =
                Some(tauri::utils::config::AppDirectoriesOverride::Root(dir));
        }
        Ok(context)
    }

    pub fn from_env(channel: Channel) -> Result<Self, Error> {
        let exe = std::env::current_exe().map_err(|err| Error::Executable(err.kind()))?;
        Self::read(
            channel,
            &exe,
            &std::env::temp_dir(),
            std::process::id(),
            |name| std::env::var_os(name),
        )
    }

    /// The configuration of `channel` from the variables `var` reads. CH7077b: an installed build
    /// ignores every variable that points at a checkout, and Dev runs on the Fork named Dev
    /// (CH7077c). Source never opens Stable's data folder.
    fn read(
        channel: Channel,
        exe: &Path,
        socket_dir: &Path,
        pid: u32,
        var: impl Fn(&str) -> Option<OsString>,
    ) -> Result<Self, Error> {
        let checkout = |name: &str| {
            if channel.installed() { None } else { var(name) }
        };
        let mut config = Self::locate(checkout("ROUNDUP_RUPD_BIN"), exe, socket_dir, pid)?;
        config.channel = channel;
        config.claude_bin = var("ROUNDUP_CLAUDE_BIN");
        config.search_path = var("PATH").unwrap_or_default();
        config.dev_port = checkout("ROUNDUP_DEV_PORT")
            .and_then(|port| port.to_str().and_then(|port| port.parse().ok()));
        match channel {
            Channel::Stable => {}
            Channel::Dev => match crate::fork::home(&var)
                .map(|home| crate::channel::dev_fork(&home))
            {
                Some(Ok(fork)) => config.data_dir = Some(fork),
                Some(Err(told)) => config.refusal = Some(told),
                None => {
                    config.refusal = Some("Dev needs HOME or ROUNDUP_HOME to find its Fork".into())
                }
            },
            Channel::Source => {
                config.data_dir = var("ROUNDUP_DATA_DIR").map(PathBuf::from);
                let stable =
                    dirs::data_dir().map(|dir| dir.join(crate::channel::STABLE_IDENTIFIER));
                if let (Some(dir), Some(stable)) = (&config.data_dir, stable)
                    && std::path::absolute(dir).ok() == std::path::absolute(&stable).ok()
                {
                    config.refusal = Some(format!(
                        "{} is the Stable App's data folder, which a build from a checkout never opens; unset ROUNDUP_DATA_DIR",
                        stable.display()
                    ));
                    config.data_dir = None;
                }
            }
        }
        Ok(config)
    }
}

fn check_limit(socket: &Path) -> Result<(), Error> {
    let bytes = socket.as_os_str().len();
    if bytes >= SOCKET_PATH_LIMIT {
        return Err(Error::SocketPathTooLong {
            bytes,
            limit: SOCKET_PATH_LIMIT,
        });
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn bare() -> Config {
        Config::locate(None, Path::new("/x/app"), Path::new("/tmp"), 1).unwrap()
    }

    #[test]
    fn s13_the_launch_sets_dev_url_from_the_dev_port_and_keeps_the_config_without_it() {
        let mut config = bare();
        let kept = config
            .apply(crate::context::<tauri::test::MockRuntime>())
            .unwrap()
            .config()
            .build
            .dev_url
            .clone();
        assert_eq!(kept.unwrap().as_str(), "http://localhost:5173/");
        config.dev_port = Some(5180);
        let url = config
            .apply(crate::context::<tauri::test::MockRuntime>())
            .unwrap()
            .config()
            .build
            .dev_url
            .clone();
        assert_eq!(url.unwrap().as_str(), "http://localhost:5180/");
    }

    // The startup observers share the existing classified Daemon launch site (N7).
    pub(crate) fn startup_config(dir: &Path, missing: bool) -> Config {
        let daemon = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("rupd");
        assert!(daemon.is_file(), "build rupd before this observer");
        let mut config = Config::locate(
            Some(daemon.into()),
            &dir.join("roundup"),
            dir,
            std::process::id(),
        )
        .unwrap();
        config.data_dir = Some(dir.join("data"));
        if missing {
            config.rupd_bin = dir.join("missing-executable");
        }
        config
    }

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
        let config = Config::from_env(Channel::Source).unwrap();
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
        let installed = config
            .apply(crate::context::<tauri::test::MockRuntime>())
            .unwrap();
        let mut identifiers =
            std::collections::BTreeSet::from([installed.config().identifier.clone()]);
        for name in ["run-one", "run-two"] {
            config.data_dir = Some(dir.path().join(name));
            let first = config
                .apply(crate::context::<tauri::test::MockRuntime>())
                .unwrap();
            let reopened = config
                .apply(crate::context::<tauri::test::MockRuntime>())
                .unwrap();
            // The plugin keys its macOS singleton socket by this Tauri identifier.
            // Reopening one profile must find itself, never another run or the installed App.
            assert_eq!(first.config().identifier, reopened.config().identifier);
            assert!(
                identifiers.insert(first.config().identifier.clone()),
                "isolated profile would forward its Project to another App and exit before setup"
            );
        }
    }

    /// The config of `channel` with every variable a checkout's `just app` sets pointing at it.
    fn from_checkout(channel: Channel, extra: &[(&str, &Path)]) -> Config {
        let vars: std::collections::BTreeMap<&str, OsString> = [
            ("ROUNDUP_RUPD_BIN", Path::new("/checkout/target/debug/rupd")),
            ("ROUNDUP_DEV_PORT", Path::new("5180")),
        ]
        .iter()
        .chain(extra)
        .map(|(name, value)| (*name, value.as_os_str().to_owned()))
        .collect();
        Config::read(
            channel,
            Path::new("/App.app/Contents/MacOS/roundup"),
            Path::new("/tmp"),
            1,
            |name| vars.get(name).cloned(),
        )
        .unwrap()
    }

    #[test]
    fn ch7077b_an_installed_build_ignores_the_checkouts_variables() {
        for channel in [Channel::Stable, Channel::Dev] {
            let config = from_checkout(channel, &[]);
            assert_eq!(config.rupd_bin, Path::new("/App.app/Contents/MacOS/rupd"));
            assert_eq!(config.dev_port, None);
        }
        let source = from_checkout(Channel::Source, &[]);
        assert_eq!(source.rupd_bin, Path::new("/checkout/target/debug/rupd"));
        assert_eq!(source.dev_port, Some(5180));
    }

    #[test]
    fn ch7077a_a_checkout_never_opens_the_stable_data_folder() {
        let stable = dirs::data_dir()
            .unwrap()
            .join(crate::channel::STABLE_IDENTIFIER);
        let config = from_checkout(Channel::Source, &[("ROUNDUP_DATA_DIR", &stable)]);
        assert_eq!(config.data_dir, None);
        assert!(config.refusal.unwrap().contains("Stable"));
        let other = from_checkout(
            Channel::Source,
            &[("ROUNDUP_DATA_DIR", Path::new("/tmp/fork"))],
        );
        assert_eq!(other.data_dir.as_deref(), Some(Path::new("/tmp/fork")));
        assert_eq!(other.refusal, None);
    }

    #[test]
    fn ch7077c_dev_opens_the_fork_and_keeps_its_identifier() {
        let home = tempfile::tempdir().unwrap();
        let fork = home.path().join("forks/dev");
        std::fs::create_dir_all(&fork).unwrap();
        std::fs::write(
            fork.join("fork.json"),
            r#"{"name":"Dev","colour":"violet","source":"/live","created_ms":0,"projects":null}"#,
        )
        .unwrap();
        let config = from_checkout(Channel::Dev, &[("ROUNDUP_HOME", home.path())]);
        assert_eq!(config.data_dir.as_deref(), Some(fork.as_path()));
        let context = config
            .apply(crate::context::<tauri::test::MockRuntime>())
            .unwrap();
        assert!(!context.config().identifier.contains(".profile-"));
        let missing = tempfile::tempdir().unwrap();
        let refused = from_checkout(Channel::Dev, &[("ROUNDUP_HOME", missing.path())]);
        assert!(refused.refusal.is_some() && refused.data_dir.is_none());
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
        assert!(err.to_string().contains("104"));
    }

    #[test]
    fn s5_a_reopen_whose_prefixed_path_stays_under_the_limit_is_accepted() {
        let config = Config::locate(None, Path::new("/a/roundup"), &dir_of(101), 1).unwrap();

        let reopened = config.socket_for_run(1).unwrap();

        assert_eq!(reopened.as_os_str().len(), 103);
    }
}
