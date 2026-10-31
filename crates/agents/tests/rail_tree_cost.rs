//! RO1: an overview is read once, then only what was appended.

use std::io::Write;
use std::path::PathBuf;

use agents::claude_code::Launcher;
use serde_json::json;

const ID: &str = "11111111-1111-1111-1111-111111111111";

struct Transcript {
    _dir: tempfile::TempDir,
    cwd: PathBuf,
    path: PathBuf,
    launcher: Launcher,
}

fn reply(used: u64) -> String {
    format!(
        "{}\n",
        json!({"type":"assistant","message":{"usage":{"input_tokens":used},"model":"claude-opus-5-5"}})
    )
}

fn transcript(text: &str) -> Transcript {
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().canonicalize().unwrap();
    let project: String = cwd
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let path = dir
        .path()
        .join("projects")
        .join(project)
        .join(format!("{ID}.jsonl"));
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, text).unwrap();
    let launcher = Launcher::new(
        "unused",
        dir.path().join("claude.json"),
        dir.path().join("rup"),
        None,
    );
    Transcript {
        _dir: dir,
        cwd,
        path,
        launcher,
    }
}

impl Transcript {
    fn read(&self) -> serde_json::Value {
        serde_json::to_value(self.launcher.read_overview(&self.cwd, ID).unwrap()).unwrap()
    }

    fn append(&self, text: &str) {
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&self.path)
            .unwrap();
        file.write_all(text.as_bytes()).unwrap();
    }
}

#[test]
fn ro1_a_second_rail_tree_parses_no_transcript_bytes() {
    let filler = json!({"type":"user","message":{"content":"x".repeat(1000)}}).to_string();
    let text = format!("{}{}", reply(10), format!("{filler}\n").repeat(31_000));
    assert!(text.len() >= 30_000_000);
    let t = transcript(&text);
    let first = t.read();
    assert_eq!(t.launcher.overview_bytes_parsed(), text.len() as u64);
    assert_eq!(t.read(), first);
    assert_eq!(t.launcher.overview_bytes_parsed(), text.len() as u64);
}

#[test]
fn ro1_an_appended_reply_parses_only_the_appended_bytes() {
    let t = transcript(&reply(10));
    t.read();
    let before = t.launcher.overview_bytes_parsed();
    t.append(&reply(2000));
    assert_eq!(t.read()["used"], 2000);
    assert_eq!(
        t.launcher.overview_bytes_parsed() - before,
        reply(2000).len() as u64
    );
}

#[test]
fn ro1_a_truncated_or_replaced_transcript_is_read_whole() {
    let t = transcript(&format!("{}{}", reply(10), reply(20)));
    t.read();
    for replacement in [reply(5), format!("{}{}", reply(7), reply(8))] {
        let before = t.launcher.overview_bytes_parsed();
        std::fs::write(&t.path, &replacement).unwrap();
        let used = t.read()["used"].clone();
        assert_eq!(
            t.launcher.overview_bytes_parsed() - before,
            replacement.len() as u64
        );
        assert_eq!(
            used,
            if replacement.len() == reply(5).len() {
                5
            } else {
                8
            }
        );
    }
}

#[test]
fn ro1_a_partial_last_line_waits_for_its_newline() {
    let t = transcript(&reply(10));
    t.read();
    let before = t.launcher.overview_bytes_parsed();
    let next = reply(300);
    let (head, tail) = next.split_at(next.len() - 1);
    t.append(head);
    assert_eq!(t.read()["used"], 10);
    assert_eq!(t.launcher.overview_bytes_parsed(), before);
    t.append(tail);
    assert_eq!(t.read()["used"], 300);
    assert_eq!(
        t.launcher.overview_bytes_parsed() - before,
        next.len() as u64
    );
}
