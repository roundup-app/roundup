//! Required-check evidence for a PR, read through the user's own `gh` (NR10).
//! Pending checks retain a stable current PR identity; only `Evidence::Complete` carries checks.
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;
use wait_timeout::ChildExt;

const LIMIT: u64 = 1024 * 1024;

/// Why a read is not complete evidence.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gap {
    GhMissing,
    Refused,
    NotLoggedIn,
    ReadFailed,
    TimedOut,
    NoRequiredChecks,
    /// The PR head moved while the checks were read.
    StaleHead,
    NonGithubRemote,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Conclusion {
    Passed,
    Failed,
    Skipped,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Check {
    pub name: String,
    pub conclusion: Conclusion,
}

/// One stable PR read; only complete evidence carries the concluded checks bound to `head`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PrChecks {
    pub host: String,
    /// `owner/name`, so two repositories sharing a PR number never mix.
    pub repository: String,
    pub number: u64,
    pub head: String,
    pub checks: Vec<Check>,
    /// Seconds since the Unix epoch when the facts were read.
    pub read_at: u64,
}

impl PrChecks {
    /// Differs whenever the repository, PR, head or check set does.
    pub fn revision(&self) -> String {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::hash::DefaultHasher::new();
        (&self.host, &self.repository, self.number, &self.head).hash(&mut hasher);
        for check in &self.checks {
            (&check.name, check.conclusion as u8).hash(&mut hasher);
        }
        format!("{:016x}", hasher.finish())
    }

    /// True only when every required check passed or was skipped.
    #[cfg(test)]
    pub fn passing(&self) -> bool {
        self.checks
            .iter()
            .all(|c| matches!(c.conclusion, Conclusion::Passed | Conclusion::Skipped))
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Evidence {
    Complete(PrChecks),
    /// Identity was stable across the check read, but pending checks cannot authorize a match.
    Pending(PrChecks),
    Incomplete(Gap),
}

#[derive(Deserialize)]
struct View {
    number: u64,
    #[serde(rename = "headRefOid")]
    head: String,
    url: String,
}

#[derive(Deserialize)]
struct Row {
    name: String,
    bucket: String,
}

/// Reads the required checks of the PR of `dir`'s branch with `gh` within `timeout`.
pub fn read(gh: &Path, dir: &Path, timeout: Duration) -> Evidence {
    let deadline = Instant::now() + timeout;
    match collect(gh, dir, deadline) {
        Ok(evidence) => evidence,
        Err(gap) => Evidence::Incomplete(gap),
    }
}

fn collect(gh: &Path, dir: &Path, deadline: Instant) -> Result<Evidence, Gap> {
    let before = view(gh, dir, deadline)?;
    let (host, repository) = identity(&before.url, before.number).ok_or(Gap::ReadFailed)?;
    let rows = run(
        gh,
        dir,
        &["pr", "checks", "--required", "--json", "name,bucket"],
        deadline,
    )?;
    // `gh pr checks` exits 1 for a failed and 8 for a pending check, still printing JSON.
    let rows: Vec<Row> = match rows {
        Output {
            code: 0 | 1 | 8,
            bytes,
        } => serde_json::from_slice(&bytes).map_err(|_| Gap::ReadFailed)?,
        Output { code: 4, .. } => return Err(Gap::NotLoggedIn),
        _ => return Err(Gap::ReadFailed),
    };
    let after = view(gh, dir, deadline)?;
    if after.head != before.head || after.url != before.url || after.number != before.number {
        return Err(Gap::StaleHead);
    }
    if rows.is_empty() {
        return Err(Gap::NoRequiredChecks);
    }
    let mut checks = Vec::new();
    let mut pending = false;
    for row in rows {
        let conclusion = match row.bucket.as_str() {
            "pass" => Conclusion::Passed,
            "fail" => Conclusion::Failed,
            "skipping" => Conclusion::Skipped,
            "cancel" => Conclusion::Cancelled,
            "pending" => {
                pending = true;
                continue;
            }
            _ => return Err(Gap::ReadFailed),
        };
        checks.push(Check {
            name: row.name,
            conclusion,
        });
    }
    let read_at = u64::try_from(time::OffsetDateTime::now_utc().unix_timestamp()).unwrap_or(0);
    let facts = PrChecks {
        host,
        repository,
        number: before.number,
        head: before.head,
        checks: if pending { Vec::new() } else { checks },
        read_at,
    };
    Ok(if pending {
        Evidence::Pending(facts)
    } else {
        Evidence::Complete(facts)
    })
}

fn view(gh: &Path, dir: &Path, deadline: Instant) -> Result<View, Gap> {
    let out = run(
        gh,
        dir,
        &["pr", "view", "--json", "number,headRefOid,url"],
        deadline,
    )?;
    match out.code {
        0 => {
            let view: View = serde_json::from_slice(&out.bytes).map_err(|_| Gap::ReadFailed)?;
            if view.head.is_empty() {
                return Err(Gap::ReadFailed);
            }
            Ok(view)
        }
        4 => Err(Gap::NotLoggedIn),
        // gh exits 1 with no PR JSON when no remote points at a GitHub host.
        1 if non_github_remote(dir) => Err(Gap::NonGithubRemote),
        _ => Err(Gap::ReadFailed),
    }
}

/// `https://host/owner/repo/pull/N` -> (host, owner/repo), only when N is the PR number.
fn identity(url: &str, number: u64) -> Option<(String, String)> {
    let rest = url.strip_prefix("https://")?;
    let mut parts = rest.split('/');
    let host = parts.next().filter(|h| !h.is_empty())?;
    let (owner, name) = (parts.next()?, parts.next()?);
    (parts.next()? == "pull" && parts.next()?.parse() == Ok(number)).then_some(())?;
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    Some((host.to_ascii_lowercase(), format!("{owner}/{name}")))
}

fn non_github_remote(dir: &Path) -> bool {
    let Ok(out) = Command::new("git")
        .current_dir(dir)
        .args(["remote", "get-url", "origin"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
    else {
        return false;
    };
    let url = String::from_utf8_lossy(&out.stdout);
    let url = url.trim();
    let host = url
        .split_once("://")
        .map(|(_, rest)| rest.split('/').next().unwrap_or(""))
        .or_else(|| {
            url.split_once('@')
                .map(|(_, rest)| rest.split(':').next().unwrap_or(""))
        })
        .map(|h| h.rsplit('@').next().unwrap_or(h));
    out.status.success() && host.is_some_and(|h| !h.is_empty() && h != "github.com")
}

struct Output {
    code: i32,
    bytes: Vec<u8>,
}

fn run(gh: &Path, dir: &Path, args: &[&str], deadline: Instant) -> Result<Output, Gap> {
    let mut child = Command::new(gh)
        .current_dir(dir)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("NO_COLOR", "1")
        .process_group(0)
        .spawn()
        .map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => Gap::GhMissing,
            std::io::ErrorKind::PermissionDenied => Gap::Refused,
            _ => Gap::ReadFailed,
        })?;
    let stdout = child.stdout.take().expect("piped gh stdout");
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.take(LIMIT + 1).read_to_end(&mut bytes);
        bytes
    });
    let status = child
        .wait_timeout(deadline.saturating_duration_since(Instant::now()))
        .ok()
        .flatten();
    if let Some(pid) = i32::try_from(child.id())
        .ok()
        .and_then(rustix::process::Pid::from_raw)
    {
        // Descendants holding the pipe die with the group, so the reader always ends.
        let _ = rustix::process::kill_process_group(pid, rustix::process::Signal::KILL);
    }
    let _ = child.wait();
    let bytes = reader.join().unwrap_or_default();
    let Some(status) = status else {
        return Err(Gap::TimedOut);
    };
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > LIMIT {
        return Err(Gap::ReadFailed);
    }
    // A signalled gh has no code: unavailable, never passing.
    Ok(Output {
        code: status.code().unwrap_or(-1),
        bytes,
    })
}

#[cfg(test)]
mod tests;
