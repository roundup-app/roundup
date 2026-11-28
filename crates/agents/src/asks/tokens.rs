//! U8045c, U8045d: the `#Project` and `@Workstream` tokens of an Ask's text.
use crate::placement::{self, Destination, EarlierAsk, Request};
use contracts::agent::{NodeKind, RailNode};
use std::collections::HashSet;

/// A Project's name, when the caller names it, with its Rail nodes.
pub type Tree = (Option<String>, Vec<RailNode>);
type Found = Vec<(Option<String>, String)>;

/// The open Projects an Ask's tokens are read against, each with its complete tree.
pub type Scope = Vec<(String, Vec<RailNode>)>;

/// A token is `#` or `@` plus the non-space characters after it, at the start of the text or after a space.
fn words(text: &str, sigil: char) -> Vec<&str> {
    text.split_whitespace()
        .filter_map(|word| word.strip_prefix(sigil))
        .filter(|word| !word.is_empty())
        .collect()
}

pub struct Route {
    destination: Destination,
    project: Option<String>,
}

pub struct Read {
    /// The Project the Ask fixes: the caller's, or the one `#` token naming an open Project.
    pub fixed: Option<String>,
    hashes: Vec<String>,
    pub route: Option<Route>,
    /// The Workstream ids Placement may offer, when two `@` tokens narrowed them.
    only: Option<HashSet<String>>,
}

impl Route {
    pub fn into_part(self, text: &str) -> placement::AskPart {
        placement::AskPart {
            project: self.project,
            text: text.into(),
            destination: self.destination,
        }
    }
}

impl Read {
    /// Two `#` Projects: a part takes the Project named in its own text, else the first token's.
    pub fn assign_projects(&self, parts: &mut [placement::AskPart]) {
        if self.hashes.len() < 2 {
            return;
        }
        for part in parts {
            if part.project.is_none() && matches!(part.destination, Destination::New { .. }) {
                let own = words(&part.text, '#').into_iter().find_map(|word| {
                    self.hashes
                        .iter()
                        .find(|name| name.to_lowercase() == word.to_lowercase())
                });
                part.project = own.or(self.hashes.first()).cloned();
            }
        }
    }
}

/// Placement whose answer takes the `#` Projects before it is checked, so a part naming no Project of its own is valid.
pub struct Assigning<'a> {
    pub inner: &'a dyn placement::Placement,
    pub read: &'a Read,
}

#[async_trait::async_trait]
impl placement::Placement for Assigning<'_> {
    async fn call(
        &self,
        id: &str,
        request: &placement::Request,
    ) -> Result<Vec<placement::AskPart>, String> {
        let mut parts = self.inner.call(id, request).await?;
        self.read.assign_projects(&mut parts);
        Ok(parts)
    }
}

/// `None` when the text holds no token that names anything: it then reaches Placement as it always did.
pub fn read(
    text: &str,
    rail: &[RailNode],
    scope: Option<&Scope>,
    fixed: Option<&str>,
) -> Option<Read> {
    let mut hashes: Vec<String> = Vec::new();
    for word in words(text, '#') {
        let named = scope
            .into_iter()
            .flatten()
            .find(|(name, _)| name.to_lowercase() == word.to_lowercase());
        if let Some((name, _)) = named
            && !hashes.contains(name)
        {
            hashes.push(name.clone());
        }
    }
    let fixed = fixed
        .map(str::to_owned)
        .or_else(|| match hashes.as_slice() {
            [only] => Some(only.clone()),
            _ => None,
        });
    let pool: Vec<(Option<String>, &[RailNode])> = match scope {
        Some(scope) => scope
            .iter()
            .filter(|(name, _)| fixed.as_ref().is_none_or(|fixed| fixed == name))
            .map(|(name, tree)| (Some(name.clone()), tree.as_slice()))
            .collect(),
        None => vec![(fixed.clone(), rail)],
    };
    let mut asked: Vec<&str> = Vec::new();
    for word in words(text, '@') {
        if !asked
            .iter()
            .any(|each| each.to_lowercase() == word.to_lowercase())
        {
            asked.push(word);
        }
    }
    let matching = |word: &str| -> Found {
        pool.iter()
            .flat_map(|(project, tree)| {
                tree.iter()
                    .filter(|node| {
                        node.kind() == NodeKind::Workstream
                            && node.name.to_lowercase() == word.to_lowercase()
                    })
                    .map(|node| (project.clone(), node.id.clone()))
            })
            .collect()
    };
    let named: Vec<(&str, Found)> = asked
        .iter()
        .map(|word| (*word, matching(word)))
        .filter(|(_, found)| !found.is_empty())
        .collect();
    let (route, only) = match (asked.as_slice(), named.as_slice()) {
        ([], _) => (None, None),
        (_, [(_, found)]) if found.len() == 1 => {
            let (project, id) = found.first().cloned().unwrap_or_default();
            (
                Some(Route {
                    destination: Destination::Routed { workstream: id },
                    project,
                }),
                None,
            )
        }
        (_, []) | (_, [_]) => {
            let (word, found) = match (named.first(), asked.first()) {
                (Some((word, found)), _) => (*word, found.clone()),
                (None, Some(word)) => (*word, Vec::new()),
                (None, None) => ("", Vec::new()),
            };
            let question = if found.is_empty() {
                format!("No Workstream is named {word}")
            } else {
                format!("{} Workstreams are named {word}", found.len())
            };
            (
                Some(Route {
                    destination: Destination::Unclear {
                        question,
                        candidates: found.into_iter().map(|(_, id)| id).collect(),
                    },
                    project: None,
                }),
                None,
            )
        }
        _ => (
            None,
            Some(
                named
                    .iter()
                    .flat_map(|(_, found)| found.iter().map(|(_, id)| id.clone()))
                    .collect(),
            ),
        ),
    };
    if fixed.is_none() && hashes.is_empty() && route.is_none() && only.is_none() {
        return None;
    }
    Some(Read {
        fixed,
        hashes,
        route,
        only,
    })
}

/// The trees Placement may offer, and whether they span Projects: every open Project's when the caller supplied
/// them, else this Daemon's rail under the fixed Project; narrowed to the named Workstreams of two `@` tokens.
pub fn offered(
    rail: Vec<RailNode>,
    scope: Option<&Scope>,
    fixed: Option<&str>,
    read: Option<&Read>,
) -> (Vec<Tree>, bool) {
    let mut trees: Vec<_> = match scope {
        Some(scope) => scope
            .iter()
            .map(|(name, tree)| (Some(name.clone()), tree.clone()))
            .collect(),
        None => vec![(fixed.map(str::to_owned), rail)],
    };
    if let Some(only) = read.and_then(|read| read.only.as_ref()) {
        for (_, tree) in &mut trees {
            tree.retain(|node| node.kind() != NodeKind::Workstream || only.contains(&node.id));
        }
    }
    (trees, scope.is_some())
}

pub fn request(
    text: String,
    earlier: Vec<EarlierAsk>,
    rail: Vec<RailNode>,
    scope: Option<&Scope>,
    fixed: Option<&str>,
    read: Option<&Read>,
) -> Request {
    let (trees, spans) = offered(rail, scope, fixed, read);

    match (fixed, spans) {
        (Some(project), _) => Request::across(text, earlier, trees, Some(project)),
        (None, true) => Request::across(text, earlier, trees, None),
        (None, false) => Request::new(
            text,
            earlier,
            trees.into_iter().flat_map(|(_, rail)| rail).collect(),
        ),
    }
}
