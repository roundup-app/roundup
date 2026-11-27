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
        path: None,
        line: None,
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
        let got = answer(&model, &text, &LinkSet::default(), None).await;
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
        assert_eq!(answer(&model, text, &last, None).await, Ok(None), "{text}");
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
        answer(&model, &text, &LinkSet::default(), None).await,
        Ok(Some(wanted))
    );
}

#[tokio::test]
async fn lh2_a_bad_or_failed_answer_keeps_the_set_and_logs() {
    let model = model(Err("absent or invalid structured output: eof".into()));
    let got = answer(&model, PR, &set([entry(LinkKind::Pr, PR)]), None).await;
    // The cause reaches the caller, which logs it and changes nothing.
    assert_eq!(
        got,
        Err("absent or invalid structured output: eof".to_owned())
    );
    // A tooltip of more than five words is cut, and more than 12 entries are not kept.
    let mut long = entry(LinkKind::Asked, PR);
    long.tooltip = "one two three four five six".into();
    assert_eq!(
        accept(set([long]), PR, &LinkSet::default(), None).entries[0].tooltip,
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
        accept(LinkSet { entries: many }, &text, &LinkSet::default(), None)
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
        accept(set([wanted.clone()]), &text, &LinkSet::default(), None).entries,
        vec![wanted.clone()]
    );
    // A rewritten URL, or one that is only the start of a longer one, is dropped.
    let longer = format!("see {PR}9");
    assert!(
        accept(set([wanted.clone()]), &longer, &LinkSet::default(), None)
            .entries
            .is_empty()
    );
    let other = entry(LinkKind::Pr, "https://github.com/acme/app/pull/8");
    let kept = accept(
        set([other.clone(), wanted.clone()]),
        &text,
        &LinkSet::default(),
        None,
    );
    assert_eq!(
        kept.entries,
        vec![wanted.clone()],
        "other entries of the answer stand"
    );
    // A URL the Agent already holds stands without being in this turn's text.
    let last = set([other.clone()]);
    assert_eq!(
        accept(set([other.clone()]), "nothing", &last, None).entries,
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
    let kept: Vec<_> = accept(LinkSet { entries: all }, &text, &LinkSet::default(), None)
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
        accept(
            set([built]),
            "tracked as ABC-123",
            &LinkSet::default(),
            None
        )
        .entries
        .is_empty()
    );
}

/// A model that answers after `delay`.
struct Slow(std::time::Duration);

#[async_trait]
impl LinksModel for Slow {
    async fn links(&self, _text: &str, _last: &LinkSet) -> Result<LinkSet, String> {
        tokio::time::sleep(self.0).await;
        Ok(set([entry(LinkKind::Pr, PR)]))
    }
}

#[tokio::test(start_paused = true)]
async fn lh16_a_slow_answer_within_the_limit_becomes_the_set() {
    let model = Slow(std::time::Duration::from_secs(4));
    let got = answer(&model, &format!("opened {PR}"), &LinkSet::default(), None).await;
    assert_eq!(got, Ok(Some(set([entry(LinkKind::Pr, PR)]))));
}

#[tokio::test(start_paused = true)]
async fn lh16_a_call_past_the_limit_is_killed() {
    let model = Slow(std::time::Duration::from_secs(16 + 60));
    let got = answer(&model, &format!("opened {PR}"), &LinkSet::default(), None).await;
    assert_eq!(got, Err("timed out after 15 s".to_owned()));
}

#[test]
fn lh17_the_log_keeps_its_last_200_lines() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("links.log");
    for n in 0..250 {
        crate::links::append_log(&path, &format!("line {n}"), 200).unwrap();
    }
    let text = std::fs::read_to_string(&path).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 200);
    assert_eq!(lines.first(), Some(&"line 50"));
    assert_eq!(lines.last(), Some(&"line 249"));
}

fn file_entry(path: &str) -> LinkEntry {
    LinkEntry {
        kind: LinkKind::File,
        url: String::new(),
        tooltip: "ignored".into(),
        path: Some(path.into()),
        line: None,
    }
}

#[test]
fn lh28_a_named_file_in_the_folder_becomes_a_file_entry() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("src")).unwrap();
    std::fs::write(dir.path().join("src/a.ts"), "x").unwrap();
    let root = dir.path().canonicalize().unwrap();
    let text = "I changed src/a.ts:12 for you";
    let got = accept(
        set([file_entry("src/a.ts:12")]),
        text,
        &LinkSet::default(),
        Some(dir.path()),
    );
    assert_eq!(got.entries.len(), 1);
    assert_eq!(got.entries[0].kind, LinkKind::File);
    assert_eq!(
        got.entries[0].path.as_deref(),
        Some(root.join("src/a.ts").to_str().unwrap())
    );
    assert_eq!(got.entries[0].line, Some(12));
    assert_eq!(got.entries[0].tooltip, "a.ts");
}

#[test]
fn lh28_a_path_outside_the_folder_or_a_missing_file_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let inside = dir.path().join("work");
    std::fs::create_dir(&inside).unwrap();
    std::fs::write(dir.path().join("secret.txt"), "x").unwrap();
    let outside = dir.path().join("secret.txt");
    let outside = outside.to_str().unwrap();
    let text = format!("see {outside} and ../secret.txt and gone.ts and {PR}");
    let got = accept(
        set([
            file_entry(outside),
            file_entry("../secret.txt"),
            file_entry("gone.ts"),
            entry(LinkKind::Pr, PR),
        ]),
        &text,
        &LinkSet::default(),
        Some(&inside),
    );
    assert_eq!(got.entries, vec![entry(LinkKind::Pr, PR)]);
}
