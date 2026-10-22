//! P15: where text lands under a Markdown heading.

use pulldown_cmark::{Event, Parser, Tag, TagEnd};

struct Heading {
    level: usize,
    title: String,
    /// Byte offset of the heading's line.
    line: usize,
}

/// ATX headings in order. The parser skips fenced code; a Setext heading or one inside a quote or list is no heading here.
fn headings(text: &str) -> Vec<Heading> {
    let mut found = Vec::new();
    let mut open: Option<Heading> = None;
    for (event, range) in Parser::new(text).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                let line = text[..range.start].rfind('\n').map_or(0, |i| i + 1);
                let indent = &text[line..range.start];
                let atx = text[range.start..].starts_with('#')
                    && indent.len() <= 3
                    && indent.bytes().all(|b| b == b' ');
                open = atx.then(|| Heading {
                    level: level as usize,
                    title: String::new(),
                    line,
                });
            }
            Event::Text(t) | Event::Code(t) => {
                if let Some(h) = &mut open {
                    h.title.push_str(&t);
                }
            }
            Event::End(TagEnd::Heading(_)) => found.extend(open.take()),
            _ => {}
        }
    }
    found
}

/// Lowercased, with runs of whitespace as one space.
fn normalize(title: &str) -> String {
    caseless::default_case_fold_str(&title.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// The heading as an agent would write it, without its `#` marks.
pub fn wanted(heading: &str) -> String {
    normalize(heading.trim_start_matches('#'))
}

/// A section as LK4 reads it: the heading as the Pad writes it and the text under it.
pub struct Found {
    pub heading: String,
    pub text: String,
}

/// The first section whose heading is `wanted`, ending at the next heading of the same or a higher level.
pub fn find(text: &str, wanted: &str) -> Option<Found> {
    let all = headings(text);
    let at = all.iter().position(|h| normalize(&h.title) == wanted)?;
    let end = all[at + 1..]
        .iter()
        .find(|h| h.level <= all[at].level)
        .map_or(text.len(), |h| h.line);
    let start = text[all[at].line..end]
        .find('\n')
        .map_or(end, |i| all[at].line + i + 1);
    Some(Found {
        heading: all[at].title.clone(),
        text: text[start..end].trim_matches('\n').trim_end().to_owned(),
    })
}

/// `text` with `add` on new lines after the last non-blank line of the first section whose heading is `wanted`, or the headings of `text` as `"## Plan"` when none match.
pub fn insert(text: &str, wanted: &str, add: &str) -> Result<String, Vec<String>> {
    let all = headings(text);
    let Some(at) = all.iter().position(|h| normalize(&h.title) == wanted) else {
        return Err(all
            .iter()
            .map(|h| format!("{} {}", "#".repeat(h.level), h.title))
            .collect());
    };
    let end = all[at + 1..]
        .iter()
        .find(|h| h.level <= all[at].level)
        .map_or(text.len(), |h| h.line);
    let at = text[..end].trim_end().len();
    let add = add.strip_suffix('\n').unwrap_or(add);
    let add = add.strip_suffix('\r').unwrap_or(add);
    Ok(format!("{}\n{add}{}", &text[..at], &text[at..]))
}
