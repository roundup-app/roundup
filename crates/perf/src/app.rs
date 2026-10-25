//! Run-owned App profile, fake vendor and child cleanup shared by native observers.
use crate::launch;
use crate::webview::failure;
use std::{io, path::Path, process::Stdio};
use tokio::process::Command;
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Workload {
    Keystroke,
    Frames,
    Idle,
}
/// Starts the Terminal's program: a raw tty, a `ready` line, then `cat`, so each typed byte comes back only through the program.
const SHELL: &str = "#!/bin/sh\nstty raw -echo\necho ready\nexec cat\n";

/// Every perf-created Workstream, including the keystroke run's, uses this fake vendor; no model call.
const FAKE_CLAUDE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../rup/tests/e2e/fake_claude.py"
);

/// The frame run's program: the Terminal stream of `docs/motion.md`, 64 lines of 128 bytes with CRLF every 125 ms (64 KiB/s), and whatever is written to the tty echoed back for the report.
// One writer owns stdout: a background cat could splice a stream burst into a large JSON line.
// Python 3 is already required by the native workload drivers; select keeps stdin in the foreground.
pub const FRAMES_SHELL: &str = r#"#!/bin/sh
stty raw -echo
exec python3 -c '
import os, select, sys, time
out = sys.stdout.buffer
out.write(b"ready\n")
out.flush()
n = 0
pending = b""
due = time.monotonic()
while True:
    if time.monotonic() >= due:
        out.write(b"".join((f"{i:08d}" + "0" * 118 + "\r\n").encode() for i in range(n, n + 64)))
        out.flush()
        n += 64
        due = time.monotonic() + 0.125
    if select.select([0], [], [], max(0, due - time.monotonic()))[0]:
        chunk = os.read(0, 65536)
        if not chunk:
            break
        pending += chunk
        if b"\n" in pending:
            line, _ = pending.split(b"\n", 1)
            out.write(line + b"\n")
            out.flush()
            # One report ends the workload; stop load so collection cannot evict it from the log.
            break
'
"#;

pub async fn run<T>(
    app: &Path,
    workload: Workload,
    evidence: Option<&Path>,
    report: impl AsyncFnOnce(&Path, u32, &Path) -> io::Result<T>,
) -> io::Result<T> {
    let dir = tempfile::tempdir()?;
    let shell = dir.path().join("shell");
    let project = dir.path().join("project");

    let data = std::path::absolute(dir.path().join("data"))?;
    let home = std::path::absolute(dir.path().join("home"))?;
    let xdg = std::path::absolute(dir.path().join("xdg"))?;
    std::fs::create_dir(&home)?;
    std::fs::create_dir(&xdg)?;
    let daemon = std::path::absolute(app)?.with_file_name("rupd");
    let wrapper = dir.path().join("rupd");
    let logs = evidence.unwrap_or(dir.path());
    // The App supplies its own data override; reset it at the executable boundary as well.
    std::fs::write(
        &wrapper,
        daemon_script(
            &data,
            &daemon,
            &std::path::absolute(logs.join("daemon.stderr.log"))?,
        )?,
    )?;
    std::fs::set_permissions(
        &wrapper,
        std::os::unix::fs::PermissionsExt::from_mode(0o755),
    )?;

    let claude = dir.path().join("claude");
    std::fs::write(
        &claude,
        format!(
            "#!/bin/sh\nexec python3 {} \"$@\"\n",
            shlex::try_quote(FAKE_CLAUDE).map_err(io::Error::other)?
        ),
    )?;
    if workload == Workload::Idle {
        let wrapper = std::fs::read_to_string(&claude)?;
        std::fs::write(
            &claude,
            wrapper.replacen("exec python3", "printf '\\033[1 q'\nexec python3", 1),
        )?;
    }
    std::fs::set_permissions(&claude, std::os::unix::fs::PermissionsExt::from_mode(0o755))?;

    std::fs::create_dir(&project)?;
    std::fs::write(
        &shell,
        match workload {
            Workload::Frames => FRAMES_SHELL,
            _ => SHELL,
        },
    )?;
    std::fs::set_permissions(&shell, std::os::unix::fs::PermissionsExt::from_mode(0o755))?;

    let mut command = Command::new(app);
    command.arg(&project);
    if workload != Workload::Idle {
        command.args(["-NSAppSleepDisabled", "YES"]);
    }
    if workload == Workload::Idle {
        // Inherited controls can run arbitrary fixture programs; this idle workload owns them.
        for (key, _) in std::env::vars_os() {
            if key.to_string_lossy().starts_with("FAKE_CLAUDE_") {
                command.env_remove(key);
            }
        }
        command.env("ROUNDUP_IDLE_EVIDENCE_DIR", std::path::absolute(logs)?);
        command.env("FAKE_CLAUDE_LAUNCH_LOG", logs.join("fake-launches.jsonl"));
    }
    let mut child = command
        .env("SHELL", &shell)
        .env("HOME", &home)
        .env("XDG_DATA_HOME", &xdg)
        .env("ROUNDUP_RUPD_BIN", std::path::absolute(&wrapper)?)
        .env("ROUNDUP_RUP_BIN", daemon.with_file_name("rup"))
        .env("ROUNDUP_CLAUDE_BIN", &claude)
        .env("CLAUDE_CONFIG_DIR", home.join(".claude"))
        .env("ROUNDUP_DATA_DIR", &data)
        .stdout(Stdio::from(std::fs::File::create(
            logs.join("app.stdout.log"),
        )?))
        .stderr(Stdio::from(std::fs::File::create(
            logs.join("app.stderr.log"),
        )?))
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| failure(format!("{}: {err}", app.display())))?;
    let result = async {
        let pid = child.id().ok_or_else(|| failure("the App has no pid"))?;
        let socket = std::env::temp_dir().join(format!("roundup-{pid}.sock"));
        report(&socket, pid, &project).await
    }
    .await;
    let pid = child.id();
    let status = format!("{:?}", child.try_wait());
    let collection_error = result.as_ref().err().map(ToString::to_string);
    let result = launch::finish(dir, &mut child, true, result).await;
    if let Some(logs) = evidence {
        std::fs::write(
            logs.join("lifecycle.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "pid":pid, "app":app, "status_before_cleanup":status,
                "collection_error":collection_error,
                "outcome_error":result.as_ref().err().map(ToString::to_string),
            }))?,
        )?;
    }
    result
}

pub fn daemon_script(data: &Path, daemon: &Path, log: &Path) -> io::Result<String> {
    let [data, daemon, log] = [data, daemon, log].map(|path| {
        let text = path
            .to_str()
            .ok_or_else(|| failure("the perf executable path is not UTF-8"))?;
        shlex::try_quote(text).map_err(io::Error::other)
    });
    Ok(format!(
        "#!/bin/sh\nexport ROUNDUP_DATA_DIR={}\nexec {} \"$@\" 2>>{}\n",
        data?, daemon?, log?,
    ))
}
