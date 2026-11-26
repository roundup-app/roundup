//! RB13 to RB15: `agent.explain` has the fresh reader of the diff explain selected lines of it,
//! in words or as a small diagram. The Daemon keeps nothing of the answer; the user's call is the
//! only start, and the input holds the hunks, the lines and the form, never the conversation.

use super::*;
use crate::readback::{diagram_format, over_cap};
use crate::worktree::Hunk;
use contracts::agent::{DiffSide, ExplainForm, ExplainParams, Explanation};
use serde_json::json;

/// What the reader is and what it gets; the form says how to answer.
const EXPLAIN_SYSTEM: &str = "You explain selected lines of a code change to the person reviewing \
it. Your input is JSON: `hunks` (each {id, path, text}: the whole diff), `selection` ({path, \
side: \"old\" or \"new\", start, end, text}: the lines to explain, numbered on that side of the \
file) and `form`. Explain only the selection, using the rest of the diff only for what the \
selection calls or is called by. Your reply is the explanation itself, plain text, no markdown.";

const WORDS: &str = "Form `words`: two to four sentences.";

const DIAGRAM: &str = concat!(
    "Form `diagram`: a small text diagram of the parts the selection touches and the calls between them, ",
    diagram_format!(),
    ". Use short names and at most eight lines."
);

fn system(form: ExplainForm) -> String {
    let form = match form {
        ExplainForm::Words => WORDS,
        ExplainForm::Diagram => DIAGRAM,
    };
    format!("{EXPLAIN_SYSTEM}\n\n{form}")
}

fn failed(kind: &str, cause: String) -> Explanation {
    Explanation::Failed {
        kind: kind.into(),
        cause,
    }
}

/// RB13: the lines `start` to `end` of `side` that a hunk of `path` holds, one per line without
/// its `+`, `-` or space, read from each hunk's `@@` header and body.
fn selected(hunks: &[Hunk], path: &str, side: DiffSide, start: u32, end: u32) -> Vec<String> {
    let mut found = Vec::new();
    for hunk in hunks.iter().filter(|hunk| hunk.path == path) {
        let mut lines = hunk.text.lines();
        let Some(header) = lines.next().and_then(|line| line.strip_prefix("@@ -")) else {
            continue;
        };
        let mut starts = header
            .split_whitespace()
            .take(2)
            .map(|span| span.trim_start_matches(['+', '-']))
            .map(|span| span.split(',').next().and_then(|n| n.parse::<u32>().ok()));
        let (Some(Some(mut old)), Some(Some(mut new))) = (starts.next(), starts.next()) else {
            continue;
        };
        for line in lines {
            let (mark, text) = line.split_at(line.chars().next().map_or(0, char::len_utf8));
            let (on_old, on_new) = match mark {
                " " => (true, true),
                "-" => (true, false),
                "+" => (false, true),
                _ => continue,
            };
            let at = match side {
                DiffSide::Old => on_old.then_some(old),
                DiffSide::New => on_new.then_some(new),
            };
            if at.is_some_and(|at| (start..=end).contains(&at)) {
                found.push(text.to_owned());
            }
            old += u32::from(on_old);
            new += u32::from(on_new);
        }
    }
    found
}

impl Agents {
    /// RB13 to RB15: one call, started by the user's, answered with its result.
    pub(super) async fn explain(&self, p: ExplainParams) -> Result<Explanation, RpcError> {
        let worktree = self.readback_worktree(&p.id)?;
        let input = self.readback_diff(worktree, p.to).await?;
        if let Some(cause) = over_cap(&input.hunks) {
            return Ok(failed("tooLarge", cause));
        }
        let lines = selected(&input.hunks, &p.path, p.side, p.start, p.end);
        if lines.is_empty() {
            let side = match p.side {
                DiffSide::Old => "old",
                DiffSide::New => "new",
            };
            return Ok(failed(
                "outOfDiff",
                format!(
                    "lines {} to {} of the {side} side of {} are in no hunk of the diff",
                    p.start, p.end, p.path
                ),
            ));
        }
        let hunks: Vec<_> = input
            .hunks
            .iter()
            .map(|hunk| json!({"id": hunk.id, "path": hunk.path, "text": hunk.text}))
            .collect();
        let stdin = json!({
            "hunks": hunks,
            "selection": {
                "path": p.path,
                "side": p.side,
                "start": p.start,
                "end": p.end,
                "text": lines.join("\n"),
            },
            "form": p.form,
        })
        .to_string();
        Ok(
            match self
                .readback_reader()?
                .read(&system(p.form), None, stdin.as_bytes())
                .await
            {
                Err(cause) => failed("call", cause),
                Ok(text) if text.trim().is_empty() => {
                    failed("badAnswer", "the reader answered with no text".into())
                }
                Ok(text) => Explanation::Explained {
                    form: p.form,
                    text: text.trim().to_owned(),
                },
            },
        )
    }
}
