//! A39: the one-shot Placement seam, independent of AgentAdapter and Terminal effects.
use async_trait::async_trait;
use contracts::{
    Kind,
    agent::{NodeKind, Order, RailNode},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Destination {
    Routed {
        workstream: String,
    },
    New {
        title: String,
    },
    Unclear {
        question: String,
        candidates: Vec<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AskPart {
    pub text: String,
    #[serde(flatten)]
    pub destination: Destination,
}

#[derive(Clone, Debug, Serialize)]
pub struct EarlierAsk {
    pub at: i64,
    pub parts: Vec<AskPart>,
}

#[derive(Clone, Debug, Serialize)]
struct Workstream {
    id: String,
    name: String,
    title: Option<String>,
    ask: Option<String>,
    question: Option<String>,
    status: Option<Kind>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Request {
    pub text: String,
    earlier: Vec<EarlierAsk>,
    workstreams: Vec<Workstream>,
}

impl Request {
    /// `earlier` contains only Asks preceding this Ask; the five newest go into the call.
    /// Pass the complete rail.tree, including stopped Workstreams.
    pub fn new(text: String, mut earlier: Vec<EarlierAsk>, rail: Vec<RailNode>) -> Self {
        earlier.sort_by_key(|ask| std::cmp::Reverse(ask.at));
        earlier.truncate(5);
        let workstreams = rail
            .into_iter()
            .filter(|node| node.kind == NodeKind::Workstream)
            .map(|node| {
                let (title, ask, question) = match node.work {
                    Some(Order::Work { title, ask, .. }) => (title, Some(ask), None),
                    Some(Order::Clarification { question }) => (None, None, Some(question)),
                    None => (None, None, None),
                };
                Workstream {
                    id: node.id,
                    name: node.name,
                    title,
                    ask,
                    question,
                    status: node.status.map(|status| status.kind),
                }
            })
            .collect();
        Self {
            text,
            earlier,
            workstreams,
        }
    }
}

#[async_trait]
pub trait Placement: Send + Sync {
    /// One bounded call, with no Terminal effect. Implementations kill and reap before returning
    /// a timeout. Answers remain untrusted until `place` checks them against this Request.
    async fn call(&self, id: &str, request: &Request) -> Result<Vec<AskPart>, String>;
}

/// Return checked spans, or preserve the whole Ask as unclear and log its cause exactly once.
/// The Daemon supplies `log` as its stderr sink, including the Ask identifier.
pub async fn place(
    placement: &dyn Placement,
    id: &str,
    request: &Request,
    log: impl FnOnce(&str, &str),
) -> Vec<AskPart> {
    match placement
        .call(id, request)
        .await
        .and_then(|parts| parse_parts(parts, request))
    {
        Ok(parts) => parts,
        Err(cause) => {
            log(id, &cause);
            vec![AskPart {
                text: request.text.clone(),
                destination: Destination::Unclear {
                    question: format!("Couldn't place this: {cause}"),
                    candidates: vec![],
                },
            }]
        }
    }
}

fn parse_parts(parts: Vec<AskPart>, request: &Request) -> Result<Vec<AskPart>, String> {
    if parts.is_empty() {
        return Err("empty parts".into());
    }
    let known = |id: &str| request.workstreams.iter().any(|stream| stream.id == id);
    if parts.iter().any(|part| part.text.is_empty()) {
        return Err("empty span".into());
    }
    if parts.iter().map(|part| part.text.len()).sum::<usize>() > request.text.len() {
        return Err("overlapping spans".into());
    }
    // A repeated substring can have several placements. Backtrack rather than reject a valid
    // partition merely because an earlier part occupied the first occurrence.
    let mut spans: Vec<std::ops::Range<usize>> = Vec::new();
    let mut next = vec![0; parts.len()];
    while spans.len() < parts.len() {
        let index = spans.len();
        let span = request
            .text
            .char_indices()
            .filter(|(start, _)| *start >= next[index])
            .filter_map(|(start, _)| {
                request.text[start..]
                    .starts_with(&parts[index].text)
                    .then_some(start..start + parts[index].text.len())
            })
            .find(|span| {
                spans
                    .iter()
                    .all(|used| span.end <= used.start || used.end <= span.start)
            });
        match span {
            Some(span) => {
                next[index] = span.start
                    + request.text[span.start..]
                        .chars()
                        .next()
                        .expect("nonempty span")
                        .len_utf8();
                spans.push(span);
            }
            None => {
                next[index] = 0;
                if spans.pop().is_none() {
                    return Err("not a verbatim non-overlapping span".into());
                }
            }
        }
    }
    for part in &parts {
        match &part.destination {
            Destination::Routed { workstream } if !known(workstream) => {
                return Err("unknown workstream".into());
            }
            Destination::New { title } => {
                Order::Work {
                    title: Some(title.clone()),
                    ask: "placement".into(),
                    done: None,
                    limits: vec![],
                }
                .validate_explicit()?;
            }
            Destination::Unclear { candidates, .. } => {
                if candidates.len() > 3 {
                    return Err("over three candidates".into());
                }
                if candidates.iter().any(|id| !known(id)) {
                    return Err("unknown candidate".into());
                }
            }
            _ => {}
        }
    }
    Ok(parts)
}
