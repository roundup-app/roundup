use super::links::{TEXT_BOUND, accept, answer, bounded, turn_text};
use crate::links::LinksModel;
use async_trait::async_trait;
use contracts::links::{LinkEntry, LinkKind, LinkSet};
use std::sync::atomic::{AtomicUsize, Ordering};

/// A model that answers `answer`, counting its calls.
struct Model {
    answer: Result<LinkSet, String>,
    calls: AtomicUsize,
}

#[async_trait]
impl LinksModel for Model {
    async fn links(&self, _text: &str, _last: &LinkSet) -> Result<LinkSet, String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.answer.clone()
    }
}

fn model(answer: Result<LinkSet, String>) -> Model {
    Model {
        answer,
        calls: AtomicUsize::new(0),
    }
}

fn entry(kind: LinkKind, url: &str) -> LinkEntry {
    LinkEntry {
        kind,
        url: url.into(),
        tooltip: "a tooltip".into(),
    }
}

fn set<const N: usize>(entries: [LinkEntry; N]) -> LinkSet {
    LinkSet {
        entries: entries.to_vec(),
    }
}

const PR: &str = "https://github.com/acme/app/pull/7";

#[tokio::test]
async fn lh1_link_like_text_calls_the_model() {
    for text in [
        format!("opened {PR}"),
        "serving on localhost:3000".to_owned(),
        "tracked as ABC-123".to_owned(),
        "Send me the LINK".to_owned(),
        "see roundup://agent/1?project=p".to_owned(),
    ] {
        let model = model(Ok(LinkSet::default()));
        let got = answer(&model, &text, &LinkSet::default()).await;
        assert_eq!(got, Ok(Some(LinkSet::default())), "{text}");
        assert_eq!(model.calls.load(Ordering::SeqCst), 1, "{text}");
    }
}

#[tokio::test]
async fn lh1_text_without_a_link_calls_no_model_and_keeps_the_set() {
    let model = model(Ok(LinkSet::default()));
    let last = set([entry(LinkKind::Pr, PR)]);
    // Lower case, no hyphen-digits, no port: nothing link-like.
    for text in ["plain prose, abc-123 and localhost only", "a blinker"] {
        assert_eq!(answer(&model, text, &last).await, Ok(None), "{text}");
    }
    assert_eq!(model.calls.load(Ordering::SeqCst), 0);
}

#[test]
fn lh1_the_turn_text_is_bounded_and_the_newest_kept() {
    let text = format!("{}é{}", "old ".repeat(TEXT_BOUND), "newest");
    let kept = bounded(&text);
    assert!(kept.len() <= TEXT_BOUND);
    assert!(kept.ends_with("newest"));

    // The adapter reads only what the transcript added since the offset, complete lines only.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("t.jsonl");
    let first = r#"{"message":{"role":"user","content":"first"}}"#;
    let second = r#"{"message":{"role":"assistant","content":[{"type":"text","text":"second"}]}}"#;
    let third =
        r#"{"message":{"role":"user","content":[{"type":"tool_result","content":"third"}]}}"#;
    std::fs::write(&path, format!("{first}\n{second}\n{{\"half")).unwrap();
    let (text, next) = turn_text(&path, 0);
    assert_eq!(text, "first\nsecond\n");
    std::fs::write(&path, format!("{first}\n{second}\n{third}\n")).unwrap();
    let (text, _) = turn_text(&path, next);
    assert_eq!(text, "third\n");
}

#[tokio::test]
async fn lh2_an_answer_becomes_the_agents_set() {
    let text = format!("{PR} and http://localhost:3000/app");
    let wanted = set([
        entry(LinkKind::Pr, PR),
        entry(LinkKind::DevServer, "http://localhost:3000/app"),
    ]);
    let model = model(Ok(wanted.clone()));
    assert_eq!(
        answer(&model, &text, &LinkSet::default()).await,
        Ok(Some(wanted))
    );
}

#[tokio::test]
async fn lh2_a_bad_or_failed_answer_keeps_the_set_and_logs() {
    let model = model(Err("absent or invalid structured output: eof".into()));
    let got = answer(&model, PR, &set([entry(LinkKind::Pr, PR)])).await;
    // The cause reaches the caller, which logs it and changes nothing.
    assert_eq!(
        got,
        Err("absent or invalid structured output: eof".to_owned())
    );
    // A tooltip of more than five words is cut, and more than 12 entries are not kept.
    let mut long = entry(LinkKind::Asked, PR);
    long.tooltip = "one two three four five six".into();
    assert_eq!(
        accept(set([long]), PR, &LinkSet::default()).entries[0].tooltip,
        "one two three four five"
    );
    let many: Vec<_> = (0..20)
        .map(|n| entry(LinkKind::Asked, &format!("https://a.test/{n}")))
        .collect();
    let text = many
        .iter()
        .map(|e| format!("{} ", e.url))
        .collect::<String>();
    assert_eq!(
        accept(LinkSet { entries: many }, &text, &LinkSet::default())
            .entries
            .len(),
        12
    );
}

#[test]
fn lh3_a_url_not_in_the_text_never_reaches_the_set() {
    let wanted = entry(LinkKind::Pr, PR);
    let text = format!("see {PR}, then more");
    assert_eq!(
        accept(set([wanted.clone()]), &text, &LinkSet::default()).entries,
        vec![wanted.clone()]
    );
    // A rewritten URL, or one that is only the start of a longer one, is dropped.
    let longer = format!("see {PR}9");
    assert!(
        accept(set([wanted.clone()]), &longer, &LinkSet::default())
            .entries
            .is_empty()
    );
    let other = entry(LinkKind::Pr, "https://github.com/acme/app/pull/8");
    let kept = accept(
        set([other.clone(), wanted.clone()]),
        &text,
        &LinkSet::default(),
    );
    assert_eq!(
        kept.entries,
        vec![wanted.clone()],
        "other entries of the answer stand"
    );
    // A URL the Agent already holds stands without being in this turn's text.
    let last = set([other.clone()]);
    assert_eq!(
        accept(set([other.clone()]), "nothing", &last).entries,
        [other]
    );
}

#[test]
fn lh3_only_http_https_and_roundup_urls_are_kept() {
    let urls = [
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,hi",
        "/home/me/worktree",
        "ftp://a.test/x",
        "http://a.test/x",
        "https://a.test/x",
        "roundup://agent/1?project=p",
    ];
    let text = urls.join(" ");
    let all: Vec<_> = urls.iter().map(|u| entry(LinkKind::Asked, u)).collect();
    let kept: Vec<_> = accept(LinkSet { entries: all }, &text, &LinkSet::default())
        .entries
        .into_iter()
        .map(|e| e.url)
        .collect();
    assert_eq!(kept, &urls[5..]);
}

#[test]
fn lh3_a_key_alone_builds_no_url() {
    let built = entry(
        LinkKind::Tracker,
        "https://acme.atlassian.net/browse/ABC-123",
    );
    assert!(
        accept(set([built]), "tracked as ABC-123", &LinkSet::default())
            .entries
            .is_empty()
    );
}
