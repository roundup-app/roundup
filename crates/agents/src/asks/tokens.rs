//! U8045c, U8045d: the `#Project` and `@Workstream` tokens of an Ask's text.
use crate::placement::{self, Destination};
use contracts::agent::{NodeKind, RailNode};
use std::collections::HashSet;

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

/// `None` when the text holds no token that names anything: it then reaches Placement as it always did.
pub fn read(text: &str, rail: &[RailNode], scope: Option<&Scope>, fixed: Option<&str>) -> Option<Read> {
    let mut hashes: Vec<String> = Vec::new();
    for word in words(text, '#') {
        let named = scope.into_iter().flatten().find(|(name, _)| name.to_lowercase() == word.to_lowercase());
        if let Some((name, _)) = named
            && !hashes.contains(name)
        {
            hashes.push(name.clone());
        }
    }
    let fixed = fixed.map(str::to_owned).or_else(|| match hashes.as_slice() {
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
        if !asked.iter().any(|each| each.to_lowercase() == word.to_lowercase()) {
            asked.push(word);
        }
    }
    let matching = |word: &str| -> Vec<(Option<String>, String)> {
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
    let named: Vec<(&str, Vec<(Option<String>, String)>)> = asked
        .iter()
        .map(|word| (*word, matching(word)))
        .filter(|(_, found)| !found.is_empty())
        .collect();
    let (route, only) = match (asked.as_slice(), named.as_slice()) {
        ([], _) => (None, None),
        (_, [(_, found)]) if found.len() == 1 => {
            let (project, id) = found[0].clone();
            (
                Some(Route {
                    destination: Destination::Routed { workstream: id },
                    project,
                }),
                None,
            )
        }
        (_, []) | (_, [_]) => {
            let (word, found) = match named.first() {
                Some((word, found)) => (*word, found.clone()),
                None => (asked[0], Vec::new()),
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
    Some(Read { fixed, hashes, route, only })
}

/// The trees Placement may offer, and whether they span Projects: every open Project's when the caller supplied
/// them, else this Daemon's rail under the fixed Project; narrowed to the named Workstreams of two `@` tokens.
pub fn offered(
    rail: Vec<RailNode>,
    scope: Option<&Scope>,
    fixed: Option<&str>,
    read: Option<&Read>,
) -> (Vec<(Option<String>, Vec<RailNode>)>, bool) {
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
