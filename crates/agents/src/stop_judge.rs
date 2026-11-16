//! A7180: whether the last message of a stop asks the user something. Rules read it first, with no
//! model call; one model call reads what the rules cannot tell. Vendor-neutral: an adapter feeds
//! it the text of a turn it saw end.

use async_trait::async_trait;
use contracts::{Actor, Kind};
use rpc::code;
use std::sync::Arc;
use std::time::Duration;

use crate::{Observation, Shared};

/// A7180b: how long the model has to answer; a late or failed answer leaves the Agent idle.
pub(crate) const MODEL_BOUND: Duration = Duration::from_secs(3);

/// The longest question a label holds.
const MAX_LABEL: usize = 120;

/// What a `needs-you` label starts with when the Agent's last message asked the user.
const ASKS_LABEL: &str = "asks: ";

/// The `needs-you` label of a Stop that asks `question`.
pub(crate) fn label(question: &str) -> String {
    format!("{ASKS_LABEL}{question}")
}

/// Whether a Status of this `kind` and `label` is a Stop that asked the user in text. Unlike a
/// native question, which holds a dialog open, the Agent sits at its prompt: a Message can be
/// written to it, and answers it.
#[must_use]
pub fn stop_asks(kind: Kind, label: &str) -> bool {
    kind == Kind::NeedsYou && label.starts_with(ASKS_LABEL)
}

/// What the rules make of a stop's last message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Verdict {
    /// It asks the user, offers choices or says it waits on the user; the label says what.
    Asks(String),
    /// It reports a result, or says it is done.
    Reports,
    /// The rules cannot tell; the model reads it.
    Unclear,
}

/// The one model call: the question a stop's last message asks the user.
#[async_trait]
pub trait StopModel: Send + Sync {
    /// `None` when `text` asks the user nothing.
    async fn question(&self, text: &str) -> Result<Option<String>, String>;
}

impl Shared {
    /// A7180b: read a Stop the rules could not, off every lock and within `MODEL_BOUND`. The
    /// Agent shows `idle` meanwhile. An answer that asks comes back as `Observation::Judged`; no
    /// answer, a late one or a failed call leaves it `idle`, and the log says why.
    pub(super) fn judge_stop(&self, id: &str, attempt: &str, stop: &Arc<(String, i64, String)>) {
        let Some(shared) = self.me.upgrade() else {
            return;
        };
        let (id, attempt, stop) = (id.to_owned(), attempt.to_owned(), Arc::clone(stop));
        tokio::spawn(async move {
            let (turn, started, text) = (&stop.0, stop.1, &stop.2);
            let answer = tokio::time::timeout(MODEL_BOUND, shared.events.stop_model.question(text))
                .await
                .unwrap_or_else(|_| Err(format!("no answer in {} seconds", MODEL_BOUND.as_secs())));
            let question = match answer {
                Ok(Some(question)) => question,
                Ok(None) => return,
                Err(err) => {
                    return eprintln!(
                        "agents: {id}: its stop stays idle, unread by the model: {err}"
                    );
                }
            };
            let judged = Observation::Judged {
                turn: turn.clone(),
                started,
                question,
            };
            if let Err(err) = shared.observe(Actor::daemon(), &id, &attempt, judged)
                && !matches!(err.code, code::NOT_FOUND | code::CONFLICT)
            {
                eprintln!("agents: {id}: the model's reading of its stop is lost: {err}");
            }
        });
    }
}

/// Phrases that ask, offer a choice or wait on the user, with or without a question mark.
const ASKS: [&str; 19] = [
    "should i",
    "shall i",
    "do you want",
    "would you like",
    "want me to",
    "which would you",
    "which do you",
    "your call",
    "waiting for you",
    "waiting on you",
    "blocked on you",
    "need your",
    "need you to",
    "awaiting your",
    "please confirm",
    "please choose",
    "please decide",
    "reply with",
    "tell me which",
];

/// Words that may address the user. With a word of `DONE` the message is a report; without one it
/// is for the model to read.
const ADDRESSES: [&str; 16] = [
    "you",
    "your",
    "please",
    "let me know",
    "which",
    "option",
    "options",
    "prefer",
    "whether",
    "confirm",
    "decide",
    "choose",
    "approve",
    "input",
    "blocked",
    "waiting",
];

const DONE: [&str; 13] = [
    "done",
    "complete",
    "completed",
    "finished",
    "merged",
    "pushed",
    "fixed",
    "implemented",
    "passes",
    "passed",
    "green",
    "shipped",
    "landed",
];

/// Read `text` with no model call. It looks only at the message's closing paragraph, and at the
/// paragraph above it when that closes with a list of options, and never at more than the last
/// `MAX_INPUT` bytes: a replayed Stop of a long message costs no more than a short one.
pub(crate) fn rules(text: &str) -> Verdict {
    let tail = without_inline_code(&closing(model_input(text)));
    if tail.trim().is_empty() {
        return Verdict::Reports;
    }
    if let Some(line) = question_line(&tail) {
        return Verdict::Asks(sentence(line));
    }
    let flat = format!(" {} ", words(&tail).join(" "));
    let has = |list: &[&str]| {
        list.iter()
            .any(|phrase| flat.contains(&format!(" {phrase} ")))
    };
    if has(&ASKS) {
        return Verdict::Asks(sentence(&tail));
    }
    if has(&ADDRESSES) && !has(&DONE) {
        Verdict::Unclear
    } else {
        Verdict::Reports
    }
}

/// The longest end of a message the rules and the model read.
const MAX_INPUT: usize = 4000;

/// The end of `text`, where an ask is: at most `MAX_INPUT` bytes.
pub(crate) fn model_input(text: &str) -> &str {
    let from = text.len().saturating_sub(MAX_INPUT);
    let from = (from..=text.len())
        .find(|&at| text.is_char_boundary(at))
        .unwrap_or(text.len());
    text.get(from..).unwrap_or(text)
}

/// The cleaned question a model answered: one line, at most `MAX_LABEL` characters; `None` when
/// it is empty.
pub(crate) fn label_of(question: &str) -> Option<String> {
    let line = question.split_whitespace().collect::<Vec<_>>().join(" ");
    (!line.is_empty()).then(|| cut(&line))
}

fn cut(text: &str) -> String {
    match text.char_indices().nth(MAX_LABEL) {
        Some((at, _)) => format!("{}…", text.get(..at).unwrap_or(text).trim_end()),
        None => text.to_owned(),
    }
}

/// The last line of `tail` that is not a list item, when it ends with a question mark: a question
/// answered further up the message is not an ask, and a list of options under a question is part of it.
fn question_line(tail: &str) -> Option<&str> {
    tail.lines()
        .rev()
        .find(|line| !line.trim().is_empty() && !is_list_item(line))
        .filter(|line| {
            line.trim_end()
                .trim_end_matches(['"', '\'', ')', ']', '*', '_', '>'])
                .ends_with('?')
        })
}

/// The last sentence of `text`, as a label.
fn sentence(text: &str) -> String {
    let upto = text.trim_end();
    let body = upto.strip_suffix(['?', '.', '!']).unwrap_or(upto);
    let from = body.rfind(['.', '!', '?', '\n']).map_or(0, |at| at + 1);
    let text = upto
        .get(from..)
        .unwrap_or(upto)
        .trim_matches(|mark: char| mark.is_whitespace() || "-*#>_\"'".contains(mark));
    cut(text)
}

/// Lowercase words, apostrophes kept inside a word.
fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|mark: char| !mark.is_alphanumeric() && mark != '\'')
        .filter(|word| !word.is_empty())
        .map(str::to_owned)
        .collect()
}

/// The last paragraph of `text` outside fenced code, plus the paragraph above it when the last is
/// a list.
fn closing(text: &str) -> String {
    let mut fenced = false;
    let lines: Vec<&str> = text
        .lines()
        .filter(|line| {
            if line.trim_start().starts_with("```") {
                fenced = !fenced;
                return false;
            }
            !fenced
        })
        .collect();
    let mut paragraphs = lines
        .split(|line| line.trim().is_empty())
        .filter(|paragraph| !paragraph.is_empty())
        .rev();
    let last = paragraphs.next().unwrap_or_default();
    let above = if last.first().is_some_and(|line| is_list_item(line)) {
        paragraphs.next().unwrap_or_default()
    } else {
        &[]
    };
    above
        .iter()
        .chain(last)
        .copied()
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_list_item(line: &str) -> bool {
    let line = line.trim_start();
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    line.starts_with(['-', '*', '•', '('])
        || (digits > 0
            && line
                .get(digits..)
                .is_some_and(|rest| rest.starts_with(['.', ')'])))
}

/// `text` without its `code spans`.
fn without_inline_code(text: &str) -> String {
    let mut code = false;
    text.chars()
        .filter(|&mark| {
            if mark == '`' {
                code = !code;
                return false;
            }
            !code
        })
        .collect()
}

/// A model that is not there: every call fails. The default of a test `Shared`.
#[cfg(test)]
pub(crate) struct Absent;

#[cfg(test)]
#[async_trait]
impl StopModel for Absent {
    async fn question(&self, _text: &str) -> Result<Option<String>, String> {
        Err("no model".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asks(label: &str) -> Verdict {
        Verdict::Asks(label.to_owned())
    }

    /// A7180a: the rules read a stop's last message with no model call.
    #[test]
    fn a7180a_rules_tell_an_ask_from_a_report() {
        for (text, expected) in [
            ("All done. The PR is merged.", Verdict::Reports),
            ("Fixed the lint; `just check` passes.", Verdict::Reports),
            (
                "Updated three files.\n\nShould I publish three pages or five?",
                asks("Should I publish three pages or five?"),
            ),
            (
                "Two ways:\n\nWhich do you prefer?\n\n1. Ship now\n2. Wait",
                asks("Which do you prefer?"),
            ),
            (
                "Merged.\n\nWant me to open the follow-up",
                asks("Want me to open the follow-up"),
            ),
            (
                "I am blocked on you: need your login.",
                asks("I am blocked on you: need your login."),
            ),
            ("See https://x.test/a?b=1 for the build.", Verdict::Reports),
            (
                "Why it failed? The port was taken. Fixed.",
                Verdict::Reports,
            ),
            ("```\nlet a = b ? c : d;\n```\nDone.", Verdict::Reports),
            ("Merged. You can run `just check` now.", Verdict::Reports),
            ("Here is what you asked for.", Verdict::Unclear),
            ("Let me know if anything else breaks.", Verdict::Unclear),
        ] {
            assert_eq!(rules(text), expected, "{text}");
        }
    }

    #[test]
    fn a7180a_a_long_label_is_cut() {
        let Verdict::Asks(label) = rules(&format!("{}?", "word ".repeat(60))) else {
            panic!("a question asks");
        };
        assert!(label.chars().count() <= MAX_LABEL + 1);
        assert!(label.ends_with('…'));
    }
}
