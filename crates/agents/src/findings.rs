//! RB18 to RB20: `agent.findDefects` has the fresh reader of the diff list the defects it finds,
//! each at lines the diff holds. The Daemon keeps nothing of the answer; the user's call is the
//! only start, and the input holds the hunks alone, never the conversation.

use super::*;
use crate::readback::{json_in, over_cap, placed};
use contracts::agent::{ChangedFilesParams, Finding, FindingLabel, Findings};
use serde::Deserialize;
use serde_json::json;

/// RB19: the most findings an answer keeps: a finding for every line is not wanted.
const MAX_FINDINGS: usize = 12;

const FINDINGS_SYSTEM: &str = "You review a code change for defects. Your input is JSON: `hunks`, \
each {id, path, text}: the whole diff. Find defects the diff itself shows: a logic error, a \
missed case, repeated code, an unused or misnamed thing. Do not guess at code you cannot see. \
Reply with one JSON object {\"findings\": [{\"hunk\": id, \"start\": n, \"end\": n, \"label\": \"issue\" \
or \"nit\", \"text\": one sentence}]}: `start` and `end` are new-side line numbers inside that \
hunk; `issue` is a defect that changes what the code does, `nit` one that does not. At most \
twelve findings, and {\"findings\": []} when the diff has none.";

#[derive(Deserialize)]
struct Raw {
    findings: Vec<RawFinding>,
}

#[derive(Deserialize)]
struct RawFinding {
    hunk: String,
    start: u32,
    end: u32,
    label: String,
    text: String,
}

fn failed(kind: &str, cause: String) -> Findings {
    Findings::Failed {
        kind: kind.into(),
        cause,
    }
}

/// RB19: the findings the diff holds, at most twelve: the hunk exists, the lines lie wholly in
/// that hunk's new side, the label is `issue` or `nit` and the text is not empty; the others are
/// dropped.
fn findings(raw: Vec<RawFinding>, hunks: &[crate::worktree::Hunk]) -> Vec<Finding> {
    raw.into_iter()
        .filter_map(|given| {
            let label = match given.label.as_str() {
                "issue" => FindingLabel::Issue,
                "nit" => FindingLabel::Nit,
                _ => return None,
            };
            let (path, source) = placed(hunks, &given.hunk, given.start, given.end)?;
            (!given.text.trim().is_empty()).then(|| Finding {
                path,
                start: given.start,
                end: given.end,
                source,
                text: given.text.trim().to_owned(),
                label,
            })
        })
        .take(MAX_FINDINGS)
        .collect()
}

impl Agents {
    /// RB18 to RB20: one call, started by the user's, answered with its result.
    pub(super) async fn find_defects(&self, p: ChangedFilesParams) -> Result<Findings, RpcError> {
        let worktree = self.readback_worktree(&p.id)?;
        let input = self.readback_diff(worktree, p.to).await?;
        if let Some(cause) = over_cap(&input.hunks) {
            return Ok(failed("tooLarge", cause));
        }
        let hunks: Vec<_> = input
            .hunks
            .iter()
            .map(|hunk| json!({"id": hunk.id, "path": hunk.path, "text": hunk.text}))
            .collect();
        let stdin = json!({ "hunks": hunks }).to_string();
        Ok(
            match self
                .readback_reader()?
                .read(FINDINGS_SYSTEM, None, stdin.as_bytes())
                .await
            {
                Err(cause) => failed("call", cause),
                Ok(text) => match json_in::<Raw>(&text) {
                    Err(err) => failed("badAnswer", format!("the answer is not findings: {err}")),
                    Ok(raw) => Findings::Found {
                        findings: findings(raw.findings, &input.hunks),
                    },
                },
            },
        )
    }
}
