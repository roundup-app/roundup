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

impl AskPart {
    /// A part with no Project of its own: the Workstream or the only open Project decides.
    pub fn new(text: impl Into<String>, destination: Destination) -> Self {
        Self {
            text: text.into(),
            project: None,
            destination,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AskPart {
    pub text: String,
    /// U6271a: the Project a `new` part starts in, or a `routed` part's Project when the call names it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<String>,
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
    /// U6271a: the named open Projects offered; one name only when the owner fixed the Project.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    projects: Vec<String>,
    workstreams: Vec<Workstream>,
}

impl Request {
    /// `earlier` contains only Asks preceding this Ask; the five newest go into the call.
    /// Pass the complete rail.tree, including stopped Workstreams.
    pub fn new(text: String, earlier: Vec<EarlierAsk>, rail: Vec<RailNode>) -> Self {
        Self::across(text, earlier, vec![(None, rail)], None)
    }

    /// U6271a: one request for every open Project. Each Workstream carries its Project's name;
    /// a `fixed` Project narrows the request to that Project's Workstreams (U6271b), and a
    /// Project that is not among `projects` is never offered.
    pub fn across(
        text: String,
        mut earlier: Vec<EarlierAsk>,
        projects: Vec<(Option<String>, Vec<RailNode>)>,
        fixed: Option<&str>,
    ) -> Self {
        earlier.sort_by_key(|ask| std::cmp::Reverse(ask.at));
        earlier.truncate(5);
        let projects: Vec<_> = projects
            .into_iter()
            .filter(|(project, _)| fixed.is_none_or(|fixed| project.as_deref() == Some(fixed)))
            .collect();
        let names = projects
            .iter()
            .filter_map(|(project, _)| project.clone())
            .collect();
        let workstreams = projects
            .into_iter()
            .flat_map(|(project, rail)| rail.into_iter().map(move |node| (project.clone(), node)))
            .filter(|(_, node)| node.kind == NodeKind::Workstream)
            .map(|(project, node)| {
                let (title, ask, question) = match node.work {
                    Some(Order::Work { title, ask, .. }) => (title, Some(ask), None),
                    Some(Order::Clarification { question }) => (None, None, Some(question)),
                    None => (None, None, None),
                };
                Workstream {
                    project,
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
            projects: names,
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
                project: None,
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
    // partition merely because an earlier part occupied the first occurrence. Bound the search
    // so ambiguous model output becomes unclear instead of blocking the Daemon.
    let mut remaining = 65_536usize;
    let mut spans: Vec<std::ops::Range<usize>> = Vec::new();
    let mut next = vec![0; parts.len()];
    while spans.len() < parts.len() {
        let index = spans.len();
        let mut span = None;
        for (start, _) in request.text[next[index]..].char_indices() {
            remaining = remaining.checked_sub(1).ok_or("span search exhausted")?;
            let start = next[index] + start;
            let candidate = start..start + parts[index].text.len();
            if request.text[start..].starts_with(&parts[index].text)
                && spans
                    .iter()
                    .all(|used| candidate.end <= used.start || used.end <= candidate.start)
            {
                span = Some(candidate);
                break;
            }
        }
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
        let project = part.project.as_deref();
        if let Some(name) = project
            && !request.projects.iter().any(|each| each == name)
        {
            return Err("unknown project".into());
        }
        match &part.destination {
            Destination::Routed { workstream } if !known(workstream) => {
                return Err("unknown workstream".into());
            }
            Destination::Routed { workstream } => {
                let owner = request
                    .workstreams
                    .iter()
                    .find(|stream| &stream.id == workstream)
                    .and_then(|stream| stream.project.as_deref());
                if project.is_some() && project != owner {
                    return Err("workstream is not in that project".into());
                }
            }
            Destination::New { .. } if project.is_none() && request.projects.len() > 1 => {
                return Err("no project for a new workstream".into());
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
        }
    }
    Ok(parts)
}
