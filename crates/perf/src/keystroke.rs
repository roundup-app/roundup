//! Keystroke-to-render in the real App (`scenarios/perf.md` R11): runs a build made with `VITE_ROUNDUP_PERF`,
//! reads the `PERF <json>` line the webview writes through its Terminal from the Terminal's Output log, and compares its p95 with the budget.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{ExitCode, Stdio};
use std::time::Duration;

use clap::Parser;
use perf::gate::read_budgets;
use perf::webview::failure;
use perf::webview::{judge_runs, marked_line};
use rpc::Client;
use serde_json::Value;
use sysinfo::System;
use tokio::process::Command;

mod launch;

const RUN_BOUND: Duration = Duration::from_secs(240);

/// Measure keystroke-to-render in the App's own webview; every fresh App run must pass.
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

/// Every perf-created Workstream, including the keystroke run's, uses this fake vendor; no model call.
const FAKE_CLAUDE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../rup/tests/e2e/fake_claude.py"
);

/// The frame run's program: the Terminal stream of `docs/motion.md`, 64 lines of 128 bytes with CRLF every 125 ms (64 KiB/s), and whatever is written to the tty echoed back for the report.
// One writer owns stdout: a background cat could splice a stream burst into a large JSON line.
// Python 3 is already required by the native workload drivers; select keeps stdin in the foreground.
const FRAMES_SHELL: &str = r#"#!/bin/sh
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

async fn read_report(socket: &Path, marker: &str, evidence: Option<&Path>) -> io::Result<Value> {
    collect_report(socket, marker, RUN_BOUND, evidence).await
}

async fn collect_report(
    socket: &Path,
    marker: &str,
    bound: Duration,
    evidence: Option<&Path>,
) -> io::Result<Value> {
    let phase = std::cell::Cell::new("connect");
    let mut connect_error = None;
    let mut printed: BTreeMap<String, (u64, String)> = BTreeMap::new();
    let mut listed = Value::Null;
    let collected = tokio::time::timeout(bound, async {
        let client = loop {
            match Client::connect(socket).await {
                Ok(client) => break client,
                Err(err) => {
                    connect_error = Some(err.to_string());
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        };
        let ask = async |method: &'static str, params: Value| {
            phase.set(method);
            client
                .request(method, params)
                .await
                .map_err(|err| failure(format!("{} {method}: {err}", marker.trim())))
        };
        loop {
            listed = ask("terminal.list", Value::Null).await?;
            let terminals = listed
                .as_array()
                .ok_or_else(|| failure("terminal.list is not an array"))?;
            let mut more = false;
            for terminal in terminals {
                let id = terminal["id"]
                    .as_str()
                    .ok_or_else(|| failure("Terminal has no id"))?;
                let (after, text) = printed.entry(id.to_owned()).or_default();
                let read: contracts::terminal::Read = serde_json::from_value(
                    ask("terminal.read", serde_json::json!({"id":id,"after":*after})).await?,
                )
                .map_err(io::Error::other)?;
                if *after != 0 && read.from != *after {
                    return Err(failure(format!(
                        "{} Terminal {id} output gap at {after}, resumed at {}",
                        marker.trim(),
                        read.from
                    )));
                }
                *after = read.next;
                text.push_str(&read.text);
                if let Some(line) = marked_line(text, marker) {
                    return serde_json::from_str(line).map_err(|err| {
                        failure(format!("the {} line is not JSON: {err}", marker.trim()))
                    });
                }
                more |= read.truncated;
            }
            // Drain capped replies immediately: sleeping on each 16 KiB piece can fall behind the stream.
            if !more {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    })
    .await;
    let result = collected
        .unwrap_or_else(|_| {
            Err(failure(format!(
                "the webview wrote no complete {} line in time ({}; socket {})",
                marker.trim(),
                phase.get(),
                socket.display(),
            )))
        })
        .map_err(|err| failure(format!("{} collection: {err}", marker.trim())));
    if let Some(dir) = evidence {
        std::fs::write(
            dir.join("collection.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "marker":marker.trim(), "socket":socket, "phase":phase.get(),
                "connect_error":connect_error, "terminals":listed, "output":printed,
                "error":result.as_ref().err().map(ToString::to_string),
            }))?,
        )?;
        if let Ok(report) = &result {
            std::fs::write(dir.join("report.json"), serde_json::to_vec_pretty(report)?)?;
        }
    }
    result
}

/// One fresh App, one report. The App is stopped when this returns, which stops its Daemon (D1).
async fn one_run(app: &Path, frames: bool, evidence: Option<&Path>) -> io::Result<Value> {
    let marker = if frames { "FRAMES " } else { "PERF " };

    one_run_with_report(app, frames, evidence, async |socket| {
        read_report(socket, marker, evidence).await
    })
    .await
}

async fn one_run_with_report(
    app: &Path,
    frames: bool,
    evidence: Option<&Path>,
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
    let logs = evidence.unwrap_or(dir.path());
    // The App supplies its own data override; reset it at the executable boundary as well.
    std::fs::write(
        &wrapper,
        format!(
            "#!/bin/sh\nexport ROUNDUP_DATA_DIR={}\nexec {} \"$@\" 2>>{}\n",
            quote(&data)?,
            quote(&daemon)?,
            quote(&std::path::absolute(logs.join("daemon.stderr.log"))?)?
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
        report(&socket).await
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

fn quote(path: &Path) -> io::Result<String> {
    let text = path
        .to_str()
        .ok_or_else(|| failure("the perf executable path is not UTF-8"))?;
    Ok(format!("'{}'", text.replace('\'', "'\\''")))
}

/// Exit codes carry evidence only when the report actually exposes the required stage.
fn frame_exit(report: &Value) -> io::Result<u8> {
    if report.get("error").is_some() {
        return Err(failure("FRAMES recorder returned an error"));
    }
    match report["exit"].as_u64() {
        Some(2) => Ok(2),
        Some(code @ (0 | 1)) => {
            let valid = report["invalid"].as_array().is_some_and(Vec::is_empty)
                && ["sample", "idle"].iter().all(|key| {
                    let series = &report[key];
                    series["intervals"].as_array().is_some_and(|raw| {
                        !raw.is_empty()
                            && series["n"].as_u64() == Some(raw.len() as u64)
                            && raw
                                .iter()
                                .all(|v| v.as_f64().is_some_and(|n| n.is_finite() && n > 0.0))
                    })
                });
            let scheduling = &report["stages"]["scheduling"];
            let measured = scheduling["status"] == "measured";
            let matches = if code == 1 {
                measured && scheduling["meets_thresholds"] == false && report["verdict"] == "fail"
            } else {
                [
                    "scheduling",
                    "style",
                    "layout",
                    "paint",
                    "compositor",
                    "presentation",
                ]
                .iter()
                .all(|stage| {
                    report["stages"][stage]["status"] == "measured"
                        && report["stages"][stage]["meets_thresholds"] == true
                }) && report["verdict"] == "pass"
            };
            if valid && matches {
                Ok(if code == 0 { 0 } else { 1 })
            } else {
                Err(failure(
                    "FRAMES exit contradicts missing, invalid or unmeasured evidence",
                ))
            }
        }
        _ => Err(failure("FRAMES report has no supported exit code")),
    }
}

/// One frame run (U3010e): the report is kept whole at `--out`; its `exit` is 1 for a miss on the measured stage and 2 for an invalid run or an unmeasured stage, so the run never ends in a pass the webview cannot show.
async fn run_frames(args: &Args) -> Result<u8, Box<dyn std::error::Error>> {
    // Each invocation retains its own logs, even when cleanup must remove the temporary Project.
    let parent = args
        .out
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    std::fs::create_dir_all(parent)?;
    let evidence = tempfile::Builder::new()
        .prefix("perf-frames-")
        .tempdir_in(parent)?
        .keep();
    eprintln!("FRAMES diagnostics: {}", evidence.display());
    let result = one_run(&args.app, true, Some(&evidence)).await;
    let report = match result {
        Ok(report) => match frame_exit(&report) {
            Ok(_) => report,
            Err(err) => serde_json::json!({
                "exit":2, "verdict":"invalid", "error":err.to_string(),
                "report":report, "diagnostics":evidence,
            }),
        },
        Err(err) => serde_json::json!({
            "exit":2, "verdict":"invalid", "error":err.to_string(), "diagnostics":evidence,
        }),
    };

    std::fs::write(&args.out, serde_json::to_string_pretty(&report)?)?;
    eprintln!("report: {}", args.out.display());

    Ok(frame_exit(&report).unwrap_or(2))
}

async fn run(args: &Args) -> Result<u8, Box<dyn std::error::Error>> {
    let budgets = read_budgets(&args.budgets)?;
    let limit = budgets
        .get("keystroke_p95_ms")
        .and_then(|budget| budget.limit)
        .ok_or_else(|| failure("no keystroke_p95_ms limit in the budgets file"))?;
    // An alternate budget file may tighten, but never relax, R21's absolute rule.
    let limit = limit.min(16.0);
    if args.runs == 0 {
        return Err(failure("no keystroke runs requested").into());
    }
    let mut reports = Vec::new();
    let mut loads = Vec::new();

    for turn in 1..=args.runs {
        let load = System::load_average().one;
        eprintln!("run {turn}/{}: load {load:.1}", args.runs);
        loads.push(load);
        let report = match one_run(&args.app, false, None).await {
            Ok(report) => report,
            Err(error) => serde_json::json!({"error": error.to_string()}),
        };
        println!("run {turn}: {report}");
        reports.push(report);
        let (exit, failures) = judge_runs(&reports, limit);
        // Save after every run, including invalid or failed observations, so a later
        // launch failure cannot discard the earlier evidence.
        if let Some(parent) = args.out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(
            &args.out,
            serde_json::to_vec_pretty(&serde_json::json!({
                "os": std::env::consts::OS,
                "cpus": std::thread::available_parallelism()?.get(),
                "loads": loads,
                "runs": reports.len(),
                "reports": reports,
                "limit_ms": limit,
                "exit": exit,
                "failures": failures,
            }))?,
        )?;
    }
    let (exit, failures) = judge_runs(&reports, limit);
    for message in failures {
        eprintln!("{message}");
    }
    eprintln!("report: {}", args.out.display());
    Ok(exit)
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
                eprintln!("perf-frames: {err}");
                ExitCode::from(2)
            }
        };
    }

    match run(&args).await {
        Ok(code) => ExitCode::from(code),
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
            rupd::Daemon::open_project(&project, &dir.path().join("data"))
                .map_err(io::Error::other)?,
        );
        let socket = dir.path().join("daemon.sock");
        let listener = tokio::net::UnixListener::bind(&socket)?;
        let server = tokio::spawn(rupd::serve(listener, std::sync::Arc::clone(&daemon)));
        let result =
            tokio::time::timeout(RUN_BOUND, async {
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
                let middle = line.len() / 2;
                for chunk in [&line[..middle], &line[middle..]] {
                    client.request("terminal.write", serde_json::json!({
                    "id":id, "data":base64::engine::general_purpose::STANDARD.encode(chunk),
                })).await.map_err(io::Error::other)?;
                    if !chunk.ends_with('\n') {
                        // Observe a later stream burst before finishing the input: a report can span PTY writes.
                        let before = client
                            .request("terminal.snapshot", serde_json::json!({"id":id}))
                            .await
                            .map_err(io::Error::other)?["after"]
                            .as_u64()
                            .unwrap();
                        loop {
                            let read = client
                                .request(
                                    "terminal.read",
                                    serde_json::json!({"id":id,"after":before}),
                                )
                                .await
                                .map_err(io::Error::other)?;
                            if read["text"].as_str().unwrap().contains("00000000") {
                                break;
                            }
                            tokio::time::sleep(Duration::from_millis(5)).await;
                        }
                    }
                }
                read_report(&socket, "FRAMES ", Some(dir.path())).await
            })
            .await
            .map_err(io::Error::other)
            .and_then(|r| r);
        let cleanup = daemon.stop_terminals().await.map_err(io::Error::other);
        server.abort();
        cleanup?;
        if result.is_err() {
            eprintln!("evidence: {}", dir.keep().display());
        }
        result
    }

    #[tokio::test]
    async fn u3010e_a_full_size_report_keeps_every_raw_interval_through_terminal_read() {
        let sample: Vec<_> = (0..14400)
            .map(|n| 4.166666666666667 + f64::from(n) / 10000000.0)
            .collect();
        let idle: Vec<_> = (0..7200)
            .map(|n| 4.166666666666667 + f64::from(n) / 10000000.0)
            .collect();
        let body = serde_json::json!({
            "probe":"roundup-frame-recorder", "workload":"glyphs", "exit":2,
            "stages":{"presentation":{"status":"unmeasured","reason":"not exposed"}},
            "sample":{"intervals":sample}, "idle":{"intervals":idle},
        });
        assert_eq!(transport(FRAMES_SHELL, body.clone()).await.unwrap(), body);
    }

    fn scheduling_miss() -> Value {
        serde_json::json!({
            "exit":1, "verdict":"fail", "invalid":[],
            "sample":{"n":2,"intervals":[17.0,50.0]},
            "idle":{"n":2,"intervals":[16.0,16.0]},
            "stages":{
                "scheduling":{"status":"measured","meets_thresholds":false},
                "presentation":{"status":"unmeasured","reason":"not exposed"},
            },
        })
    }

    #[test]
    fn u3010e_a_measured_scheduling_miss_stays_a_miss() {
        assert_eq!(frame_exit(&scheduling_miss()).unwrap(), 1);
    }

    #[test]
    fn u3010e_missing_or_unmeasured_evidence_cannot_authorize_a_pass() {
        for defect in ["error", "invalid", "samples", "presentation"] {
            let mut report = scheduling_miss();
            match defect {
                "error" => report["error"] = "recorder stopped".into(),
                "invalid" => report["invalid"] = serde_json::json!(["window hidden"]),
                "samples" => report["sample"]["intervals"] = serde_json::json!([]),
                _ => {
                    report["exit"] = 0.into();
                    report["verdict"] = "pass".into();
                    for stage in ["scheduling", "style", "layout", "paint", "compositor"] {
                        report["stages"][stage] =
                            serde_json::json!({"status":"measured","meets_thresholds":true});
                    }
                }
            }
            assert!(frame_exit(&report).is_err(), "{report}");
        }
    }

    #[tokio::test]
    async fn u3010e_a_closed_rpc_connection_retains_the_failed_collection() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("closed.sock");
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut line = String::new();
            let mut stream = tokio::io::BufReader::new(stream);
            stream.read_line(&mut line).await.unwrap();
            let call: Value = serde_json::from_str(&line).unwrap();
            stream
                .get_mut()
                .write_all(
                    format!(
                        "{}\n",
                        serde_json::json!({
                            "jsonrpc":"2.0","id":call["id"],"result":[],
                        })
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            // Closing between polls reproduces the owner's "already closed; request not sent" path.
        });
        let err = collect_report(&socket, "FRAMES ", Duration::from_secs(1), Some(dir.path()))
            .await
            .unwrap_err()
            .to_string();
        server.await.unwrap();
        assert!(
            err.contains("FRAMES terminal.list") && err.contains("already closed"),
            "{err}"
        );
        let saved: Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("collection.json")).unwrap())
                .unwrap();
        assert_eq!(saved["error"], err);
        assert_eq!(saved["phase"], "terminal.list");
    }

    #[tokio::test]
    async fn u3010e_an_incomplete_report_times_out_with_its_raw_output() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("partial.sock");
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            let mut lines = tokio::io::BufReader::new(read).lines();
            while let Some(line) = lines.next_line().await.unwrap() {
                let call: Value = serde_json::from_str(&line).unwrap();
                let result = if call["method"] == "terminal.list" {
                    serde_json::json!([{"id":"private-pty","running":true}])
                } else if call["params"]["after"] == 0 {
                    serde_json::json!({"from":0,"next":16,"text":"FRAMES {\"exit\":0", "truncated":false})
                } else {
                    serde_json::json!({"from":16,"next":16,"text":"", "truncated":false})
                };
                write
                    .write_all(
                        format!(
                            "{}\n",
                            serde_json::json!({"jsonrpc":"2.0","id":call["id"],"result":result})
                        )
                        .as_bytes(),
                    )
                    .await
                    .unwrap();
            }
        });
        let err = collect_report(
            &socket,
            "FRAMES ",
            Duration::from_millis(100),
            Some(dir.path()),
        )
        .await
        .unwrap_err()
        .to_string();
        server.abort();
        assert!(
            err.contains("no complete FRAMES line") && !err.contains("PERF"),
            "{err}"
        );
        let saved: Value =
            serde_json::from_slice(&std::fs::read(dir.path().join("collection.json")).unwrap())
                .unwrap();
        assert_eq!(saved["output"]["private-pty"][1], "FRAMES {\"exit\":0");
        assert_eq!(saved["error"], err);
        assert!(!dir.path().join("report.json").exists());
    }

    #[tokio::test]
    async fn u3010e_launch_failure_writes_an_invalid_report_with_run_logs() {
        let dir = tempfile::tempdir().unwrap();
        let args = Args::try_parse_from([
            "perf-keystroke",
            "--frames",
            "--app",
            dir.path().join("absent-app").to_str().unwrap(),
            "--out",
            dir.path().join("report.json").to_str().unwrap(),
        ])
        .unwrap();
        assert_eq!(run_frames(&args).await.unwrap(), 2);
        let report: Value = serde_json::from_slice(&std::fs::read(&args.out).unwrap()).unwrap();
        assert_eq!(report["exit"], 2);
        assert_eq!(report["verdict"], "invalid");
        assert!(report["error"].as_str().unwrap().contains("absent-app"));
        let logs = Path::new(report["diagnostics"].as_str().unwrap());
        assert!(logs.join("app.stderr.log").is_file());
        assert!(logs.join("app.stdout.log").is_file());
    }

    #[tokio::test]
    async fn r20_perf_workstream_never_starts_real_claude() {
        const CHILD: &str = "R20_ISOLATED_VENDOR_TEST";
        if std::env::var_os(CHILD).is_none() {
            let dir = tempfile::tempdir().unwrap();
            let sentinel = dir.path().join("claude");
            std::fs::write(
                &sentinel,
                "#!/bin/sh\nprintf forbidden > \"$R20_ISOLATED_VENDOR_TEST/forbidden\"\nexit 81\n",
            )
            .unwrap();
            std::fs::set_permissions(
                &sentinel,
                std::os::unix::fs::PermissionsExt::from_mode(0o755),
            )
            .unwrap();
            let mut paths = vec![dir.path().to_path_buf()];
            paths.extend(std::env::split_paths(
                &std::env::var_os("PATH").unwrap_or_default(),
            ));
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "tests::r20_perf_workstream_never_starts_real_claude",
                    "--nocapture",
                ])
                .env(CHILD, dir.path())
                .env("ROUNDUP_CLAUDE_BIN", &sentinel)
                .env("PATH", std::env::join_paths(paths).unwrap())
                .env("FAKE_CLAUDE_LAUNCH_LOG", dir.path().join("launches"))
                .status()
                .unwrap();
            assert!(
                !dir.path().join("forbidden").exists(),
                "the forbidden vendor executable ran"
            );
            assert!(status.success());
            return;
        }
        let root = PathBuf::from(std::env::var_os(CHILD).unwrap());
        let fixture = tempfile::tempdir().unwrap();
        let app = n7_fixture::app(fixture.path());
        let mut owned_socket = None;
        let result = one_run_with_report(&app, false, None, async |socket| {
            owned_socket = Some(socket.to_path_buf());
            n7_fixture::ready(socket).await?;
            let client = Client::connect(socket).await?;
            let workstream = client
                .request("rail.createWorkstream", serde_json::json!({"name":"perf"}))
                .await
                .map_err(io::Error::other)?;
            client
                .request("rail.startDoor", serde_json::json!({"id":workstream["id"]}))
                .await
                .map_err(io::Error::other)?;
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    if let Ok(log) = std::fs::read_to_string(root.join("launches"))
                        && let Some(line) = log.lines().next()
                    {
                        let launch: Value = serde_json::from_str(line).map_err(io::Error::other)?;
                        return Ok(launch);
                    }
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .map_err(io::Error::other)?
        })
        .await;
        std::fs::remove_file(owned_socket.unwrap()).unwrap();
        let result = result.unwrap();
        assert!(
            result["argv"]
                .as_array()
                .is_some_and(|argv| !argv.is_empty()),
            "fake vendor recorded no launch: {result}"
        );
        assert!(!root.join("forbidden").exists());
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
            let result = one_run_with_report(&app, false, None, async |socket| {
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
