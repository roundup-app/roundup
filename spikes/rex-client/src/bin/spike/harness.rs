//! The rupd stand-in every proof shares: an own Rex server, the Agent launch, block creation.
use super::*;

/// A Rex server rupd starts and owns: private socket, private state, an empty config.
pub(crate) struct Server {
    pub(crate) child: Option<Child>,
    pub(crate) socket: PathBuf,
    pub(crate) dir: PathBuf,
}

impl Server {
    pub(crate) fn own(restore: bool) -> Result<Self> {
        let dir = PathBuf::from(
            String::from_utf8(
                Command::new("mktemp")
                    .args(["-d", "/tmp/rxs.XXXX"])
                    .output()?
                    .stdout,
            )?
            .trim(),
        );
        Self::start_in(dir, restore)
    }

    pub(crate) fn start_in(dir: PathBuf, restore: bool) -> Result<Self> {
        let socket = dir.join("rex.sock");
        std::fs::write(dir.join("init.lua"), "")?;
        let log = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("server.log"))?;
        let child = Command::new(rex_bin())
            .args(["server", "run", "--listen"])
            .arg(format!("unix://{}", socket.display()))
            .arg("--state-dir")
            .arg(dir.join("state"))
            .arg(format!("--restore={restore}"))
            .arg("--config")
            .arg(dir.join("init.lua"))
            .env("SPIKE_MARK", "from-own-server")
            .stdout(Stdio::null())
            .stderr(log)
            .spawn()?;
        for _ in 0..100 {
            if socket.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Ok(Self {
            child: Some(child),
            socket,
            dir,
        })
    }

    pub(crate) fn user() -> Self {
        Self {
            child: None,
            socket: user_socket(),
            dir: PathBuf::new(),
        }
    }

    pub(crate) fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(Child::id)
    }

    pub(crate) fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(child.id() as i32),
                nix::sys::signal::Signal::SIGTERM,
            );
            let _ = child.wait();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop();
        if self.dir.starts_with("/tmp/rxs.") {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}

pub(crate) fn exe(name: &str) -> PathBuf {
    std::env::current_exe().expect("exe").with_file_name(name)
}

pub(crate) fn rss_kb(pid: u32) -> u64 {
    let out = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .expect("ps");
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse()
        .unwrap_or(0)
}

/// What `rupd` would hand `Terminals::spawn` for an Agent today: `Launcher::command_on`'s argv,
/// env and cwd, with `ROUNDUP_CLAUDE_BIN` pointing at the fake agent (no real `claude` runs),
/// plus the Daemon's own environment minus `MARKERS` (what portable-pty would inherit).
pub(crate) fn agent_launch(
    scratch: &Path,
) -> Result<(Vec<String>, BTreeMap<String, String>, PathBuf)> {
    let (project, data, config) = (
        scratch.join("project"),
        scratch.join("data"),
        scratch.join("claude-config"),
    );
    for dir in [&project, &data, &config] {
        std::fs::create_dir_all(dir)?;
    }
    let fake = exe("fake-agent");
    let rup = scratch.join("rup");
    std::fs::write(&rup, "#!/bin/sh\nexit 0\n")?;
    let launcher = Launcher::from_vars(
        |name| match name {
            "ROUNDUP_CLAUDE_BIN" => Some(OsString::from(&fake)),
            "CLAUDE_CONFIG_DIR" => Some(OsString::from(&config)),
            "ROUNDUP_RUP_BIN" => Some(OsString::from(&rup)),
            "HOME" => std::env::var_os("HOME"),
            _ => None,
        },
        &rup,
    )?;
    let command = launcher.command_on(
        Folders {
            project: &project,
            data: &data,
        },
        "7",
        "1",
        &project,
        None,
        Role::Agent,
        &Pair::default(),
    )?;
    let argv: Vec<String> = std::iter::once(command.get_program())
        .chain(command.get_args())
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let mut env: BTreeMap<String, String> = std::env::vars()
        .filter(|(k, _)| !agents::claude_code::MARKERS.contains(&k.as_str()))
        .collect();
    for (key, value) in command.get_envs() {
        match value {
            Some(value) => env.insert(
                key.to_string_lossy().into_owned(),
                value.to_string_lossy().into_owned(),
            ),
            None => env.remove(key.to_string_lossy().as_ref()),
        };
    }
    Ok((argv, env, project))
}

/// Rex's terminal options have no `env` and fall back to `$HOME` for a bad `cwd`, so the argv
/// carries both: `env -i -C cwd K=V… argv`. A gate holds the program until rupd's stream is
/// open and it types one byte, so the stream holds every byte the program prints.
pub(crate) fn rex_command(
    argv: &[String],
    env: &BTreeMap<String, String>,
    cwd: &str,
    gate: bool,
) -> Vec<String> {
    let mut command: Vec<String> =
        vec!["/usr/bin/env".into(), "-i".into(), "-C".into(), cwd.into()];
    command.extend(
        env.iter()
            .filter(|(k, _)| *k != "TERM")
            .map(|(k, v)| format!("{k}={v}")),
    );
    command.push("TERM=xterm-256color".into());
    if gate {
        command.extend(["/bin/sh".into(), "-c".into(), "stty -echo -icanon min 1 time 0; dd bs=1 count=1 >/dev/null 2>&1; stty echo icanon; exec \"$0\" \"$@\"".into()]);
    }
    command.extend(argv.iter().cloned());
    command
}

pub(crate) fn options(
    command: Vec<String>,
    cwd: Option<&str>,
    cols: u16,
    rows: u16,
    keep_open: bool,
) -> Value {
    // `shell: none` makes Rex report exit code 0 for every exit (see `exitcodes`); a non-login
    // /bin/sh passes the arguments unchanged and reports the real code.
    let mut options = json!({"shell":"/bin/sh","login":false,"command":command,"size":{"columns":cols,"rows":rows},"exit":{"on_completion":!keep_open}});
    if let Some(cwd) = cwd {
        options["cwd"] = json!(cwd);
    }
    options
}

/// Create a session with one terminal block and attach to it.
pub(crate) async fn create(
    control: &Control,
    label: &str,
    options: Value,
) -> Result<(String, String)> {
    let created = control
        .call("session.create", json!({"label":label,"initial_windows":[{"window_label":"agent","layout":{"block":{"flavor":SHELL,"label":"agent","options":options}}}]}))
        .await?;
    let session = created["session_id"]
        .as_str()
        .ok_or("session_id")?
        .to_owned();
    let block = created["initial_windows"][0]["block_ids"][0]
        .as_str()
        .ok_or("block")?
        .to_owned();
    control
        .call("session.attach", json!({"session_id":session}))
        .await?;
    Ok((session, block))
}

pub(crate) async fn screen_text(control: &Control, session: &str, block: &str) -> String {
    control
        .terminal(
            session,
            block,
            "format",
            json!({"format":"text","trim":true,"unwrap":true}),
        )
        .await
        .map(|v| v["content"].as_str().unwrap_or_default().to_owned())
        .unwrap_or_else(|e| format!("<format failed: {e}>"))
}

pub(crate) async fn wait_screen(
    control: &Control,
    session: &str,
    block: &str,
    needle: &str,
) -> String {
    let mut text = String::new();
    for _ in 0..100 {
        text = screen_text(control, session, block).await;
        if text.contains(needle) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    text
}

/// Read a stream until `until` appears in its program bytes or `within` passes.
pub(crate) async fn drain(
    data: &mut Data,
    splitter: &mut Splitter,
    program: &mut Vec<u8>,
    rex_messages: &mut Vec<Value>,
    until: &str,
    within: Duration,
) -> bool {
    let deadline = Instant::now() + within;
    loop {
        if rex_client_spike::find(program, until.as_bytes()).is_some() {
            return true;
        }
        let left = deadline.saturating_duration_since(Instant::now());
        match tokio::time::timeout(left, data.next()).await {
            Ok(Some(bytes)) => {
                for piece in splitter.push(&bytes) {
                    match piece {
                        Piece::Program(bytes) => program.extend(bytes),
                        Piece::Rex(message) => rex_messages.push(message),
                        Piece::Snapshot(_) => {}
                    }
                }
            }
            _ => return false,
        }
    }
}

pub(crate) fn lines_of<'a>(text: &'a str, prefix: &str) -> Vec<&'a str> {
    text.lines()
        .filter(|l| l.trim_start().starts_with(prefix))
        .collect()
}

pub(crate) fn percentile(sorted: &[f64], p: f64) -> f64 {
    sorted[((sorted.len() as f64 - 1.0) * p).round() as usize]
}
