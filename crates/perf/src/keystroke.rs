//! Keystroke-to-render in the real App (`scenarios/perf.md` R11): runs a build made with `VITE_ROUNDUP_PERF`,
//! reads the `PERF <json>` line the webview writes through its Terminal from the Terminal's Output log, and compares its p95 with the budget.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{ExitCode, Stdio};
use std::time::{Duration, Instant};

use clap::Parser;
use perf::gate::{conclude, read_budgets};
use perf::webview::failure;
use perf::webview::{checked, marked_line};
use rpc::Client;
use serde_json::Value;
use sysinfo::System;
use tokio::process::Command;

mod launch;

const RUN_BOUND: Duration = Duration::from_secs(240);

/// Measure keystroke-to-render in the App's own webview; each metric is the median over fresh App runs.
#[derive(Parser)]
struct Args {
    #[arg(long, default_value_t = 3)]
    runs: usize,
    /// The App built with `VITE_ROUNDUP_PERF`; `rupd` must sit beside it.
    #[arg(long, default_value = "target/perf-app/release/roundup")]
    app: PathBuf,
    #[arg(long, default_value = "crates/perf/keystroke-budgets.json")]
    budgets: PathBuf,
    #[arg(long, default_value = "target/perf-keystroke.json")]
    out: PathBuf,
    /// The App built with `VITE_ROUNDUP_PERF_WORKLOAD`: one frame-interval run (U3010e) whose report is written to `--out` and whose exit code is the report's.
    #[arg(long)]
    frames: bool,
}

/// The run opens a window over the user's screen and types into it; it starts only when this is `1`, set by someone the user asked to run it.
const ALLOW_WINDOW: &str = "ROUNDUP_ALLOW_WINDOW";

/// Starts the Terminal's program: a raw tty, a `ready` line, then `cat`, so each typed byte comes back only through the program.
const SHELL: &str = "#!/bin/sh\nstty raw -echo\necho ready\nexec cat\n";

/// The Agents of the `glyphs` workload run this instead of `claude` (`crates/rup/tests/e2e/fake_claude.py`): the Daemon starts them and counts them working, with no model call.
const FAKE_CLAUDE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../rup/tests/e2e/fake_claude.py"
);

/// The frame run's program: the Terminal stream of `docs/motion.md`, 64 lines of 128 bytes with CRLF every 125 ms (64 KiB/s), and whatever is written to the tty echoed back for the report.
const FRAMES_SHELL: &str = "#!/bin/sh\nstty raw -echo\necho ready\ncat <&0 &\npad=$(printf '%0118d' 0)\nn=0\nwhile :; do\n  i=0\n  while [ $i -lt 64 ]; do\n    printf '%08d%s\\r\\n' $n \"$pad\"\n    n=$((n + 1)); i=$((i + 1))\n  done\n  sleep 0.125\ndone\n";

async fn read_report(socket: &Path, marker: &str) -> io::Result<Value> {
    let give_up = Instant::now() + RUN_BOUND;

    let client = loop {
        match Client::connect(socket).await {
            Ok(client) => break client,
            Err(_) if Instant::now() < give_up => {
                tokio::time::sleep(Duration::from_millis(50)).await
            }
            Err(err) => return Err(failure(format!("{}: {err}", socket.display()))),
        }
    };
    let ask = async |method: &str, params: Value| {
        tokio::time::timeout_at(give_up.into(), client.request(method, params))
            .await
            .map_err(|_| failure("the webview wrote no PERF line in time"))?
            .map_err(|err| failure(format!("{method}: {err}")))
    };

    // The webview's line is read from each Terminal's Output log, so it is found whenever it was written.
    let mut printed: BTreeMap<String, (u64, String)> = BTreeMap::new();

    loop {
        let listed = ask("terminal.list", Value::Null).await?;

        for id in listed
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|terminal| terminal["id"].as_str())
        {
            let (after, text) = printed.entry(id.to_owned()).or_default();
            let read = ask(
                "terminal.read",
                serde_json::json!({ "id": id, "after": *after }),
            )
            .await?;

            *after = read["next"].as_u64().unwrap_or(*after);
            text.push_str(read["text"].as_str().unwrap_or_default());

            if let Some(line) = marked_line(text, marker) {
                return serde_json::from_str(line).map_err(|err| {
                    failure(format!("the {} line is not JSON: {err}", marker.trim()))
                });
            }
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// One fresh App, one report. The App is stopped when this returns, which stops its Daemon (D1).
async fn one_run(app: &Path, frames: bool) -> io::Result<Value> {
    let marker = if frames { "FRAMES " } else { "PERF " };

    one_run_with_report(app, frames, async |socket| {
        read_report(socket, marker).await
    })
    .await
}

async fn one_run_with_report(
    app: &Path,
    frames: bool,
    report: impl AsyncFnOnce(&Path) -> io::Result<Value>,
) -> io::Result<Value> {
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
    // The App supplies its own data override; reset it at the executable boundary as well.
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nexport ROUNDUP_DATA_DIR={}\nexec {} \"$@\"\n",
            quote(&data)?,
            quote(&daemon)?
        ),
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
            quote(Path::new(FAKE_CLAUDE))?
        ),
    )?;
    std::fs::set_permissions(&claude, std::os::unix::fs::PermissionsExt::from_mode(0o755))?;

    std::fs::create_dir(&project)?;
    std::fs::write(&shell, if frames { FRAMES_SHELL } else { SHELL })?;
    std::fs::set_permissions(&shell, std::os::unix::fs::PermissionsExt::from_mode(0o755))?;

    let mut child = Command::new(app)
        .arg(&project)
        // Without this macOS naps the App a few seconds in: its timers and frames stop, and keys time out instead of rendering.
        .args(["-NSAppSleepDisabled", "YES"])
        .env("SHELL", &shell)
        .env("HOME", &home)
        .env("XDG_DATA_HOME", &xdg)
        .env("ROUNDUP_RUPD_BIN", std::path::absolute(&wrapper)?)
        .env("ROUNDUP_RUP_BIN", daemon.with_file_name("rup"))
        .env("ROUNDUP_CLAUDE_BIN", &claude)
        .env("CLAUDE_CONFIG_DIR", home.join(".claude"))
        .env("ROUNDUP_DATA_DIR", &data)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|err| failure(format!("{}: {err}", app.display())))?;
    let result = async {
        let pid = child.id().ok_or_else(|| failure("the App has no pid"))?;
        let socket = std::env::temp_dir().join(format!("roundup-{pid}.sock"));
        report(&socket).await
    }
    .await;
    launch::finish(dir, &mut child, true, result).await
}

fn quote(path: &Path) -> io::Result<String> {
    let text = path
        .to_str()
        .ok_or_else(|| failure("the perf executable path is not UTF-8"))?;
    Ok(format!("'{}'", text.replace('\'', "'\\''")))
}

/// One frame run (U3010e): the report is kept whole at `--out`; its `exit` is 1 for a miss on the measured stage and 2 for an invalid run or an unmeasured stage, so the run never ends in a pass the webview cannot show.
async fn run_frames(args: &Args) -> Result<u8, Box<dyn std::error::Error>> {
    let report = one_run(&args.app, true).await?;

    std::fs::write(&args.out, serde_json::to_string_pretty(&report)?)?;
    eprintln!("report: {}", args.out.display());

    match report["exit"].as_u64() {
        Some(0) => Ok(0),
        Some(1) => Ok(1),
        _ => Ok(2),
    }
}

async fn run(args: &Args) -> Result<bool, Box<dyn std::error::Error>> {
    let budgets = read_budgets(&args.budgets)?;
    let mut per_run: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    let mut loads = Vec::new();

    for turn in 1..=args.runs {
        let load = System::load_average().one;

        eprintln!("run {turn}/{}: load {load:.1}", args.runs);
        loads.push(load);

        let report = one_run(&args.app, false).await?;

        checked(&report)?;
        eprintln!("  {report}");

        for (name, key) in [
            ("keystroke_p50_ms", "p50"),
            ("keystroke_p95_ms", "p95"),
            ("keystroke_p99_ms", "p99"),
        ] {
            per_run.entry(name.into()).or_default().push(
                report[key]
                    .as_f64()
                    .ok_or_else(|| failure(format!("the report has no {key}")))?,
            );
        }
    }

    conclude(per_run, loads, &budgets, &args.out)
}

#[tokio::main]
async fn main() -> ExitCode {
    if std::env::var(ALLOW_WINDOW).as_deref() != Ok("1") {
        eprintln!(
            "perf-keystroke: this opens a window over your screen for about 40 s per run and types into it; refusing without {ALLOW_WINDOW}=1, which is only for when the user asked for the run"
        );

        return ExitCode::from(2);
    }

    eprintln!("perf-keystroke: this opens a window over your screen for about 40 s per run");

    let args = Args::parse();

    if args.frames {
        return match run_frames(&args).await {
            Ok(code) => ExitCode::from(code),
            Err(err) => {
                eprintln!("perf-keystroke: {err}");
                ExitCode::from(2)
            }
        };
    }

    match run(&args).await {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(err) => {
            eprintln!("perf-keystroke: {err}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod n7_fixture;

#[cfg(test)]
mod tests {
    use super::*;

    /// Real Daemon/Terminal PTY, with no App or native window.
    async fn transport(script: &str, body: Value) -> io::Result<Value> {
        use base64::Engine;
        let dir = tempfile::tempdir()?;
        let project = dir.path().join("project");
        std::fs::create_dir(&project)?;
        let daemon = std::sync::Arc::new(
            rupd::Daemon::open_project(&project, &dir.path().join("data"), None)
                .map_err(io::Error::other)?,
        );
        let socket = dir.path().join("daemon.sock");
        let listener = tokio::net::UnixListener::bind(&socket)?;
        let server = tokio::spawn(rupd::serve(listener, std::sync::Arc::clone(&daemon)));
        let result = tokio::time::timeout(Duration::from_secs(4), async {
            let client = Client::connect(&socket).await?;
            let terminal = client
                .request(
                    "terminal.spawn",
                    serde_json::json!({
                        "cwd": project, "command": ["/bin/sh", "-c", script],
                        "env": {}, "cols": 80, "rows": 24,
                    }),
                )
                .await
                .map_err(io::Error::other)?;
            let id = terminal["id"].as_str().unwrap();
            // `ready` follows stty, so input cannot be swallowed by the tty's canonical mode.
            loop {
                let read = client
                    .request("terminal.read", serde_json::json!({"id":id,"after":0}))
                    .await
                    .map_err(io::Error::other)?;
                if read["text"].as_str().unwrap().contains("ready\n") {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            let line = format!("FRAMES {body}\n");
            client
                .request(
                    "terminal.write",
                    serde_json::json!({
                        "id":id, "data":base64::engine::general_purpose::STANDARD.encode(line),
                    }),
                )
                .await
                .map_err(io::Error::other)?;
            read_report(&socket, "FRAMES ").await
        })
        .await
        .map_err(io::Error::other)
        .and_then(|r| r);
        let cleanup = daemon.stop_terminals().await.map_err(io::Error::other);
        server.abort();
        cleanup?;
        result
    }

    #[tokio::test]
    async fn u3010g_the_streaming_pty_echoes_the_report() {
        let body = serde_json::json!({"exit":2,"error":"unmeasured presentation"});
        assert_eq!(transport(FRAMES_SHELL, body.clone()).await.unwrap(), body);
    }

    #[tokio::test]
    async fn n7_launch_sites_clean_on_success_and_failure() {
        // Set inherited App data only on an isolated test executable, never the test runner.
        if std::env::var_os("N7_ISOLATED_APP").is_none() {
            let fixture = tempfile::tempdir().unwrap();
            n7_fixture::app(fixture.path());
            let seed = fixture.path().join("app-data");
            let before = n7_fixture::snapshot(&seed);
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "tests::n7_launch_sites_clean_on_success_and_failure",
                    "--nocapture",
                ])
                .env("N7_ISOLATED_APP", "1")
                .env("ROUNDUP_DATA_DIR", &seed)
                .env("HOME", fixture.path())
                .env("XDG_DATA_HOME", fixture.path().join("xdg"))
                .status()
                .unwrap();
            assert!(status.success());
            assert_eq!(n7_fixture::snapshot(&seed), before);
            return;
        }
        for (success, orphan) in [(true, false), (false, false), (false, true)] {
            let fixture = tempfile::Builder::new()
                .prefix("n7-\'$-")
                .tempdir()
                .unwrap();
            let app = n7_fixture::app(fixture.path());
            if orphan {
                let script = std::fs::read_to_string(&app)
                    .unwrap()
                    .replace("\nwait\n", "\nexit 0\n");
                std::fs::write(&app, script).unwrap();
            }
            let seeded = fixture.path().join("app-data");
            let before = n7_fixture::snapshot(&seeded);
            let mut launched = None;
            let mut owned_socket = None;
            let result = one_run_with_report(&app, false, async |socket| {
                let observed = n7_fixture::launched(fixture.path()).await?;
                n7_fixture::ready(socket).await?;
                owned_socket = Some(socket.to_path_buf());
                if !observed.0.join("projects").is_dir() {
                    return Err(io::Error::other("the Daemon created no Project data"));
                }
                launched = Some(observed);
                if success {
                    Ok(serde_json::json!({"p95": 1}))
                } else {
                    Err(io::Error::other("report failed after launch"))
                }
            })
            .await;
            assert_eq!(result.is_ok(), success, "App lifecycle result: {result:?}");
            let socket = owned_socket.unwrap();
            let app_pid: u32 = socket
                .file_stem()
                .unwrap()
                .to_str()
                .unwrap()
                .strip_prefix("roundup-")
                .unwrap()
                .parse()
                .unwrap();
            std::fs::remove_file(socket).unwrap();
            let mut system = System::new();
            let root = sysinfo::Pid::from_u32(app_pid);
            system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[root]), true);
            assert!(system.process(root).is_none(), "App was not reaped");
            let (data, pid) = launched.unwrap();
            assert!(data.is_absolute());
            assert_ne!(data, seeded);
            assert!(!data.exists(), "data was not removed: {}", data.display());
            assert!(n7_fixture::exited(pid), "Daemon survived data removal");
            assert_eq!(n7_fixture::snapshot(&seeded), before);
        }
    }
}
