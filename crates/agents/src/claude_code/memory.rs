//! LC19–LC22: the file-tool boundary for roles that delegate implementation.
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{Value, json};
use soft_canonicalize::soft_canonicalize;
use unicode_normalization::UnicodeNormalization;

use super::Role;
use super::launch_files::{merge_settings, user_settings};

/// A PreToolUse command's stdin. The root comes from launch data, never tool input.
#[derive(Deserialize)]
struct Call {
    tool_name: String,
    tool_input: FileInput,
}

#[derive(Deserialize)]
struct FileInput {
    file_path: String,
}

/// LC20: no decision inside memory, so the user's permissions still apply. Every refusal
/// includes its cause and delegates the edit, including malformed vendor input.
pub fn memory_guard(root: &Path, cwd: &Path, input: &[u8]) -> Value {
    let decision = || -> Result<(), String> {
        let call: Call =
            serde_json::from_slice(input).map_err(|err| format!("invalid file input: {err}"))?;
        if !matches!(call.tool_name.as_str(), "Write" | "Edit") {
            return Err("not a Write or Edit call".into());
        }
        let root = checked_path(root)?;
        let path = Path::new(&call.tool_input.file_path);
        if path.as_os_str().is_empty() || call.tool_input.file_path.contains('\0') {
            return Err("missing or malformed file path".into());
        }
        let target = checked_path(&if path.is_absolute() {
            path.to_owned()
        } else {
            cwd.join(path)
        })?;
        if target == root || !target.starts_with(&root) {
            return Err(format!(
                "{} is outside the Claude Code memory directory",
                target.display()
            ));
        }
        Ok(())
    };
    match decision() {
        Ok(()) => json!({}),
        Err(cause) => json!({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": format!("{cause}. Hand the work to a child Agent; only memory files may be written here.")
        }}),
    }
}

fn checked_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.parent().is_none() {
        return Err(format!(
            "unresolved memory or file path: {}",
            path.display()
        ));
    }
    soft_canonicalize(path).map_err(|err| format!("cannot resolve {}: {err}", path.display()))
}

pub(super) fn hook(
    rup: &Path,
    config: &Path,
    home: Option<&Path>,
    cwd: &Path,
    role: Role,
    carried: &Value,
    own: &mut Value,
) -> Result<(), rpc::RpcError> {
    if !matches!(role, Role::Door | Role::Scout) {
        return Ok(());
    }
    let mut effective = user_settings(config, cwd).map_err(rpc::RpcError::internal)?;
    merge_settings(&mut effective, carried.clone());
    if effective["disableAllHooks"] == true {
        return Err(rpc::RpcError::not_accepted(
            "memory-only file tools require hooks; disableAllHooks is enabled",
        ));
    }
    let root = memory_root(config, home, cwd, &effective).map_err(|cause| {
        rpc::RpcError::not_accepted(format!(
            "Cannot resolve Claude Code memory directory: {cause}; hand the work to a child Agent"
        ))
    })?;
    let quote = |path: &Path| -> Result<String, rpc::RpcError> {
        shlex::try_quote(
            path.to_str()
                .ok_or_else(|| rpc::RpcError::internal("memory hook path is not UTF-8"))?,
        )
        .map(|value| value.into_owned())
        .map_err(rpc::RpcError::internal)
    };
    own["hooks"]["PreToolUse"].as_array_mut().expect("state hooks").push(json!({
        "matcher": "Write|Edit",
        "hooks": [{
            "type": "command",
            // Capture before forwarding: failed programs may already have printed an allow.
            // The marker preserves trailing newlines removed by command substitution.
            "command": format!(
                "if rup_memory_output=$({} claude-memory {} {} && printf '.'); then printf '%s' \"${{rup_memory_output%.}}\"; else printf '%s\\n' 'Memory guard failed; hand the work to a child Agent.' >&2; exit 2; fi",
                quote(rup)?, quote(&root)?, quote(cwd)?
            ),
            "timeout": 5,
            "onFailure": "block"
        }]
    }));
    Ok(())
}

fn memory_root(
    config: &Path,
    home: Option<&Path>,
    cwd: &Path,
    settings: &Value,
) -> Result<PathBuf, String> {
    let env = |name: &str| {
        settings["env"][name]
            .as_str()
            .map(str::to_owned)
            .or_else(|| std::env::var(name).ok())
            .filter(|value| !value.is_empty())
    };
    let expand = |value: &str| -> Result<PathBuf, String> {
        let value: String = value.nfc().collect();
        let path = if let Some(suffix) = value.strip_prefix("~/") {
            home.ok_or("no home for memory directory")?
                .join(suffix.trim_start_matches('/'))
        } else {
            PathBuf::from(value)
        };
        checked_path(&path)
    };
    if let Some(value) = env("CLAUDE_COWORK_MEMORY_PATH_OVERRIDE") {
        return expand(&value);
    }
    if let Some(value) = settings.get("autoMemoryDirectory") {
        return expand(value.as_str().ok_or("memory directory must be a string")?);
    }
    let base = repository(cwd)?;
    let config =
        env("CLAUDE_CODE_REMOTE_MEMORY_DIR").map_or_else(|| config.to_owned(), PathBuf::from);
    let slug = if env("CLAUDE_CONFIG_DIR").is_some() {
        env("CLAUDE_CODE_PROJECT_DIR_NAME").unwrap_or_else(|| project_slug(&base))
    } else {
        project_slug(&base)
    };
    if slug.is_empty() || Path::new(&slug).components().count() != 1 || slug == "." || slug == ".."
    {
        return Err("invalid Claude Code project directory name".into());
    }
    let path = config.join("projects").join(slug).join("memory");
    let path: String = path
        .to_str()
        .ok_or("memory directory is not UTF-8")?
        .nfc()
        .collect();
    checked_path(Path::new(&path))
}

// Claude Code 2.1.296: ASCII-alphanumeric slug, first 200 UTF-16 units plus the
// absolute JavaScript string hash in base 36 for longer paths.
fn project_slug(path: &Path) -> String {
    let text = path.to_string_lossy();
    let units: Vec<_> = text.encode_utf16().collect();
    let mut slug: String = units
        .iter()
        .take(200)
        .map(|unit| {
            char::from_u32(u32::from(*unit))
                .filter(char::is_ascii_alphanumeric)
                .unwrap_or('-')
        })
        .collect();
    if units.len() > 200 {
        let hash = units.iter().fold(0_i32, |hash, unit| {
            hash.wrapping_mul(31).wrapping_add(i32::from(*unit))
        });
        let mut number = hash.unsigned_abs();
        let mut digits = Vec::new();
        loop {
            digits.push(char::from_digit(number % 36, 36).expect("base 36 digit"));
            number /= 36;
            if number == 0 {
                break;
            }
        }
        slug.push('-');
        slug.extend(digits.into_iter().rev());
    }
    slug
}

// Discovery and common-directory parsing stay in the Git library; no subprocess on launch.
fn repository(cwd: &Path) -> Result<PathBuf, String> {
    let (repo, _) = match gix_discover::upwards(cwd) {
        Ok(repo) => repo,
        Err(err)
            if err
                .downcast_any_ref::<gix_discover::upwards::Error>()
                .is_some_and(|err| {
                    matches!(
                        err,
                        gix_discover::upwards::Error::NoGitRepository { .. }
                            | gix_discover::upwards::Error::NoGitRepositoryWithinFs { .. }
                    )
                }) =>
        {
            return Ok(cwd.to_owned());
        }
        Err(err) => return Err(err.to_string()),
    };
    let (git_dir, work_dir) = repo.into_repository_and_work_tree_directories();
    let common = gix_discover::path::from_plain_file_relative_to_file(&git_dir.join("commondir"))
        .transpose()
        .map_err(|err| err.to_string())?;
    let root = match common {
        Some(common) => common
            .canonicalize()
            .map_err(|err| err.to_string())?
            .parent()
            .map(Path::to_owned),
        None => work_dir,
    }
    .ok_or("repository has no working directory")?;
    root.canonicalize().map_err(|err| err.to_string())
}
