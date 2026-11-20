//! The one bounded `claude -p` call both one-shot seams make: A39's Placement and A7180's stop
//! judge. It runs on the lean Haiku profile with the user's settings, no tools and no session, and
//! reads one JSON answer back.

use serde::{Deserialize, de::DeserializeOwned};
use serde_json::json;
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

use super::Launcher;

const OUTPUT_CAP: u64 = 1024 * 1024;

/// What the one-shot Claude Code prints: the answer, shaped by the call's JSON schema.
#[derive(Deserialize)]
struct Envelope<T> {
    structured_output: T,
}

/// Which Model and Effort a one-shot call runs on.
pub(super) enum Pair<'a> {
    /// Placement and the stop judge: Haiku at low, pinned in argv and in the environment.
    Pinned,
    /// A7686: the user's pair for a Role, in argv only; `None` passes nothing, so the vendor's
    /// default applies.
    Chosen {
        model: Option<&'a str>,
        effort: Option<&'a str>,
    },
}

/// A3507a/c: build without starting a program; keep the settings file until the call ends.
/// `project` names the folder whose settings the call keeps when it runs in an empty `cwd`.
pub(super) fn command(
    launcher: &Launcher,
    project: Option<&Path>,
    cwd: &Path,
    system: &str,
    schema: &str,
) -> Result<(Command, tempfile::NamedTempFile), String> {
    command_on(launcher, project, cwd, system, schema, &Pair::Pinned)
}

pub(super) fn command_on(
    launcher: &Launcher,
    project: Option<&Path>,
    cwd: &Path,
    system: &str,
    schema: &str,
    on: &Pair<'_>,
) -> Result<(Command, tempfile::NamedTempFile), String> {
    let mut settings = launcher.one_shot_settings(project.unwrap_or(cwd))?;
    let (model, effort, pinned) = match on {
        Pair::Pinned => (Some("haiku"), Some("low"), true),
        Pair::Chosen { model, effort } => (*model, *effort, false),
    };
    let pair = super::LaunchFacts {
        model: model.map(str::to_owned),
        effort: effort.map(str::to_owned),
        ..Default::default()
    };
    for (key, value) in pair.env().into_iter().filter(|_| pinned) {
        let root = settings
            .as_object_mut()
            .ok_or("settings is not an object")?;
        let env = root.entry("env").or_insert(serde_json::Value::Null);
        if env.is_null() {
            *env = json!({});
        }
        env.as_object_mut()
            .ok_or("settings env is not an object")?
            .insert(key, json!(value));
    }
    let mut file = tempfile::Builder::new()
        .prefix("roundup-one-shot-")
        .suffix(".json")
        .tempfile()
        .map_err(|err| format!("settings: {err}"))?;
    serde_json::to_writer(file.as_file_mut(), &settings)
        .map_err(|err| format!("settings: {err}"))?;
    let mut command = Command::new(&launcher.bin);
    command.arg("-p");
    for (flag, value) in [("--model", model), ("--effort", effort)] {
        if let Some(value) = value {
            command.args([flag, value]);
        }
    }
    command
        .args([
            "--no-session-persistence",
            "--output-format",
            "json",
            "--json-schema",
            schema,
            "--tools",
            "",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--settings",
            file.path().to_str().ok_or("settings path is not UTF-8")?,
            "--system-prompt",
            system,
        ])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    for name in super::MARKERS {
        command.env_remove(name);
    }
    if pinned {
        command.envs(pair.env());
    } else if effort.is_some() {
        // A36: the variable beats `--effort`, so a chosen Effort clears the Daemon's.
        command.env_remove(super::models::EFFORT_VARIABLE);
    }
    Ok((command, file))
}

/// Run that command in an empty folder with `input` on its stdin and read the answer. It ends
/// within `bound`: the program is killed and reaped before the timeout is returned.
pub(super) async fn run<T: DeserializeOwned>(
    launcher: &Launcher,
    project: Option<&Path>,
    system: &str,
    schema: &str,
    input: &[u8],
    bound: Duration,
) -> Result<T, String> {
    run_on(
        launcher,
        project,
        system,
        schema,
        input,
        bound,
        &Pair::Pinned,
    )
    .await
}

pub(super) async fn run_on<T: DeserializeOwned>(
    launcher: &Launcher,
    project: Option<&Path>,
    system: &str,
    schema: &str,
    input: &[u8],
    bound: Duration,
    on: &Pair<'_>,
) -> Result<T, String> {
    let dir = tempfile::Builder::new()
        .prefix("roundup-one-shot-")
        .tempdir()
        .map_err(|e| format!("working folder: {e}"))?;
    let (mut command, _settings) = command_on(launcher, project, dir.path(), system, schema, on)?;
    let mut child = command.spawn().map_err(|e| format!("start: {e}"))?;
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Err("start: child pipes missing".into());
    };
    let result = tokio::time::timeout(bound, async {
        let write = async move {
            stdin.write_all(input).await?;
            stdin.shutdown().await?;
            drop(stdin);
            Ok::<_, std::io::Error>(())
        };
        let read = async {
            let mut bytes = Vec::new();
            stdout.take(OUTPUT_CAP + 1).read_to_end(&mut bytes).await?;
            Ok::<_, std::io::Error>(bytes)
        };
        let ((), bytes) = tokio::try_join!(write, read).map_err(|e| format!("output: {e}"))?;
        if u64::try_from(bytes.len()).map_or(true, |len| len > OUTPUT_CAP) {
            return Err("output exceeds bound".into());
        }
        let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;
        if !status.success() {
            return Err(format!("exit: {status}"));
        }
        serde_json::from_slice::<Envelope<T>>(&bytes)
            .map(|answer| answer.structured_output)
            .map_err(|e| format!("absent or invalid structured output: {e}"))
    })
    .await;
    let cause = match result {
        Ok(Ok(answer)) => return Ok(answer),
        Ok(Err(cause)) => cause,
        Err(_) => format!("timed out after {} seconds", bound.as_secs()),
    };
    // kill() also waits: no unclear result can race a still-live call.
    child
        .kill()
        .await
        .map_err(|e| format!("kill and reap: {e}"))?;
    Err(cause)
}
