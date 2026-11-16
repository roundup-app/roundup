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

/// A3507a/c: build without starting a program; keep the settings file until the call ends.
/// `project` names the folder whose settings the call keeps when it runs in an empty `cwd`.
pub(super) fn command(
    launcher: &Launcher,
    project: Option<&Path>,
    cwd: &Path,
    system: &str,
    schema: &str,
) -> Result<(Command, tempfile::NamedTempFile), String> {
    let mut settings = launcher.one_shot_settings(project.unwrap_or(cwd))?;
    let pair = super::LaunchFacts {
        model: Some("haiku".into()),
        effort: Some("low".into()),
        ..Default::default()
    };
    for (key, value) in pair.env() {
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
    command
        .args([
            "-p",
            "--model",
            "haiku",
            "--effort",
            "low",
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
    command.envs(pair.env());
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
    let dir = tempfile::Builder::new()
        .prefix("roundup-one-shot-")
        .tempdir()
        .map_err(|e| format!("working folder: {e}"))?;
    let (mut command, _settings) = command(launcher, project, dir.path(), system, schema)?;
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
