//! RB1: the hunks of the Agent's diff against the remote's main, named as the changes view names
//! them: `<path>#<n>`, `n` counting that path's hunks from 1 in diff order.

use contracts::agent::{ChangedStatus, CompareTarget};
use rpc::RpcError;

use super::{Git, Worktree, failed};

/// One hunk of one changed file; `new_start` and `new_len` are its new-side line span.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub id: String,
    pub path: String,
    pub new_start: u32,
    pub new_len: u32,
    /// The `@@` header and the lines under it.
    pub text: String,
}

/// What a Readback reads: the hunks, and the `(path, blob id)` of each changed file, the change
/// signal that tells a later diff from this one (RB7).
pub struct DiffInput {
    pub hunks: Vec<Hunk>,
    pub signature: Vec<(String, Option<String>)>,
}

impl Git {
    /// RB1, RB7: the diff of `worktree` as `agent.changedFiles` lists it, split into hunks, with
    /// its signature. Runs no command that writes.
    pub fn diff_input(
        &self,
        worktree: &Worktree,
        to: CompareTarget,
    ) -> Result<DiffInput, RpcError> {
        let files = self.changed_files(worktree, to)?.files;
        let base = self.comparison_base(worktree)?;
        let end = (to == CompareTarget::Branch).then_some("HEAD");
        let ends: Vec<&str> = std::iter::once(base.as_str()).chain(end).collect();
        let patch = self
            .run(
                &worktree.path,
                &[
                    &["--no-optional-locks", "diff", "--no-color", "--no-ext-diff"][..],
                    &["--no-textconv", "-M"],
                    &ends[..],
                ]
                .concat(),
            )
            .map_err(failed)?;
        let mut hunks = split(&patch);
        for file in files
            .iter()
            .filter(|file| file.status == ChangedStatus::Untracked)
        {
            let Ok(text) = std::fs::read_to_string(worktree.path.join(&file.path)) else {
                continue;
            };
            let lines: Vec<&str> = text.lines().collect();
            if lines.is_empty() {
                continue;
            }
            let body: String = lines.iter().map(|line| format!("+{line}\n")).collect();
            hunks.push((
                file.path.clone(),
                1,
                lines.len() as u32,
                format!("@@ -0,0 +1,{} @@\n{body}", lines.len()),
            ));
        }
        hunks.retain(|(path, ..)| !path.starts_with(".roundup/"));
        hunks.sort_by(|a, b| a.0.cmp(&b.0));
        let mut counts = std::collections::HashMap::<String, u32>::new();
        let hunks = hunks
            .into_iter()
            .map(|(path, new_start, new_len, text)| {
                let n = counts.entry(path.clone()).or_default();
                *n += 1;
                Hunk {
                    id: format!("{path}#{n}"),
                    path,
                    new_start,
                    new_len,
                    text,
                }
            })
            .collect();
        let signature = files.into_iter().map(|f| (f.path, f.blob)).collect();
        Ok(DiffInput { hunks, signature })
    }
}

/// `(path, new_start, new_len, text)` of each hunk of a unified diff, in diff order. A deleted
/// file keeps its old path; a binary file has no hunk.
fn split(patch: &str) -> Vec<(String, u32, u32, String)> {
    let mut out: Vec<(String, u32, u32, String)> = Vec::new();
    let (mut old, mut new) = (String::new(), String::new());
    let mut in_hunk = false;
    for line in patch.lines() {
        if line.starts_with("diff --git ") {
            (in_hunk, old, new) = (false, String::new(), String::new());
        } else if !in_hunk && let Some(path) = line.strip_prefix("--- ") {
            old = path.strip_prefix("a/").unwrap_or("").to_owned();
        } else if !in_hunk && let Some(path) = line.strip_prefix("+++ ") {
            new = path.strip_prefix("b/").unwrap_or("").to_owned();
        } else if let Some(header) = line.strip_prefix("@@ -") {
            in_hunk = true;
            let side = header.split_whitespace().nth(1).unwrap_or("+0");
            let side = side.trim_start_matches('+');
            let (start, len) = side.split_once(',').unwrap_or((side, "1"));
            let path = if new.is_empty() { &old } else { &new };
            out.push((
                path.clone(),
                start.parse().unwrap_or(0),
                len.parse().unwrap_or(0),
                format!("{line}\n"),
            ));
            continue;
        }
        if in_hunk && let Some(last) = out.last_mut() {
            last.3.push_str(line);
            last.3.push('\n');
        }
    }
    out
}
