use std::sync::Arc;

use contracts::terminal::{ReadParams, SearchParams};
use rpc::{Module, code};
use serde_json::json;

use crate::common::{PATIENCE, ctx, open, sh, until_exit, until_printed};

fn read(id: &str, after: u64, max: Option<u32>) -> ReadParams {
    ReadParams {
        id: id.into(),
        after,
        max,
    }
}

fn search(id: &str, pattern: &str, after: Option<u64>) -> SearchParams {
    SearchParams {
        id: id.into(),
        pattern: pattern.into(),
        after,
        max: None,
    }
}

#[tokio::test]
async fn x13_screen_returns_the_visible_rows_as_plain_text_and_the_offset() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            r"printf '\033[31mred\033[0m  \r\nsecond\033[2;3H@'; read line",
        ))
        .await
        .unwrap();
    until_printed(&mut spawned.events, "@").await;
    let screen = terminals.read_screen(&spawned.id, None).unwrap();
    assert_eq!((screen.cols, screen.rows), (80, 24));
    assert_eq!(screen.lines, ["red", "se@ond"]);
    assert!(!screen.truncated);
    let end = terminals.snapshot(&spawned.id).unwrap().after;
    assert_eq!(screen.offset, end);
    terminals.kill(&spawned.id).await.unwrap();
}

#[tokio::test]
async fn x13_screen_over_the_cap_is_cut_and_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut params = sh(dir.path(), "yes 0123456789 | head -n 20; read line");
    params.cols = 100;
    params.rows = 50;
    let mut spawned = terminals.spawn(params).await.unwrap();
    until_printed(&mut spawned.events, "0123456789\r\n").await;
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let screen = terminals.read_screen(&spawned.id, Some(50)).unwrap();
    assert!(screen.truncated);
    assert_eq!(screen.lines.len(), 4);
    assert_eq!(screen.lines[0], "0123456789");
    terminals.kill(&spawned.id).await.unwrap();
}

#[tokio::test]
async fn x13_read_from_next_returns_only_what_is_new() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "printf '\\033[1mone\\033[0m\\r\\n'; read a; printf 'two\\r\\n'; read b",
        ))
        .await
        .unwrap();
    until_printed(&mut spawned.events, "one").await;
    let first = terminals.read(&read(&spawned.id, 0, None)).unwrap();
    assert_eq!((first.from, first.text.as_str()), (0, "one\n"));
    assert!(!first.truncated);
    terminals.write(&spawned.id, b"x\n").await.unwrap();
    until_printed(&mut spawned.events, "two").await;
    let second = terminals
        .read(&read(&spawned.id, first.next, None))
        .unwrap();
    assert!(second.text.ends_with("two\n"), "{:?}", second.text);
    assert!(!second.text.contains("one"));
    terminals.kill(&spawned.id).await.unwrap();
}

#[tokio::test]
async fn x13_read_at_the_end_is_empty() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(dir.path(), "printf 'abc\\n'"))
        .await
        .unwrap();
    until_exit(&mut spawned.events).await;
    let all = terminals.read(&read(&spawned.id, 0, None)).unwrap();
    let again = terminals.read(&read(&spawned.id, all.next, None)).unwrap();
    assert_eq!((again.text.as_str(), again.next), ("", all.next));
    assert!(!again.truncated);
}

#[tokio::test]
async fn x13_read_never_splits_a_character_or_repeats_a_byte() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "i=0; while [ $i -lt 40 ]; do printf 'é€😀 %s\\n' $i; i=$((i+1)); done",
        ))
        .await
        .unwrap();
    until_exit(&mut spawned.events).await;
    let whole = terminals.read(&read(&spawned.id, 0, None)).unwrap();
    let mut joined = String::new();
    let mut after = 0;
    loop {
        let piece = terminals.read(&read(&spawned.id, after, Some(23))).unwrap();
        joined.push_str(&piece.text);
        assert!(piece.text.len() <= 23);
        if !piece.truncated {
            break;
        }
        assert!(piece.next > after);
        after = piece.next;
    }
    assert_eq!(joined, whole.text);
    assert_eq!(whole.text.lines().count(), 40);
}

#[tokio::test]
async fn x13_read_older_than_the_log_starts_at_the_log_start() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "head -c 1200000 /dev/zero | tr '\\0' 'a'; printf '\\nend\\n'",
        ))
        .await
        .unwrap();
    until_exit(&mut spawned.events).await;
    let read = terminals.read(&read(&spawned.id, 0, None)).unwrap();
    assert!(read.from > 0, "{}", read.from);
    assert!(read.from >= 1_200_000 + 5 - 1_048_576);
}

#[tokio::test]
async fn x13_read_past_the_end_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(dir.path(), "printf 'abc'"))
        .await
        .unwrap();
    until_exit(&mut spawned.events).await;
    let error = terminals.read(&read(&spawned.id, 4, None)).unwrap_err();
    assert_eq!(error.code, code::INVALID_PARAMS);
    for max in [0, 16_385] {
        let error = terminals
            .read(&read(&spawned.id, 0, Some(max)))
            .unwrap_err();
        assert_eq!(error.code, code::INVALID_PARAMS);
    }
}

#[tokio::test]
async fn x13_a_carriage_return_redraw_keeps_the_final_line() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "printf ' 10%%\\r 50%%\\r100%%\\r\\ndone\\033]0;t\\007\\n'",
        ))
        .await
        .unwrap();
    until_exit(&mut spawned.events).await;
    let read = terminals.read(&read(&spawned.id, 0, None)).unwrap();
    assert_eq!(read.text, "100%\ndone\n");
}

#[tokio::test]
async fn x13_search_returns_only_matching_lines_with_their_offsets() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "printf 'ok 1\\r\\nFAIL a\\r\\nok 2\\r\\n\\033[31mFAIL b\\033[0m\\r\\n'",
        ))
        .await
        .unwrap();
    until_exit(&mut spawned.events).await;
    let found = terminals
        .search(&search(&spawned.id, "^FAIL", None))
        .unwrap();
    let got: Vec<_> = found
        .matches
        .iter()
        .map(|m| (m.offset, m.text.as_str()))
        .collect();
    assert_eq!(got, [(7, "FAIL a"), (23, "FAIL b")]);
    assert!(!found.truncated);
    let end = terminals.snapshot(&spawned.id).unwrap().after;
    assert_eq!(found.next, end);
}

#[tokio::test]
async fn x13_search_resumes_from_next_without_a_repeat() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "i=0; while [ $i -lt 120 ]; do echo hit $i; i=$((i+1)); done",
        ))
        .await
        .unwrap();
    until_exit(&mut spawned.events).await;
    let mut seen = Vec::new();
    let mut after = None;
    loop {
        let found = terminals
            .search(&search(&spawned.id, "hit", after))
            .unwrap();
        seen.extend(found.matches.iter().map(|m| m.text.clone()));
        if !found.truncated {
            break;
        }
        after = Some(found.next);
    }
    let expected: Vec<_> = (0..120).map(|i| format!("hit {i}")).collect();
    assert_eq!(seen, expected);
}

#[tokio::test]
async fn x13_search_caps_matches_and_line_length() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "head -c 1000 /dev/zero | tr '\\0' 'x'; echo; i=0; while [ $i -lt 60 ]; do echo xx; i=$((i+1)); done",
        ))
        .await
        .unwrap();
    until_exit(&mut spawned.events).await;
    let found = terminals.search(&search(&spawned.id, "x", None)).unwrap();
    assert_eq!(found.matches.len(), 50);
    assert_eq!(found.matches[0].text.chars().count(), 400);
    assert!(found.truncated);
}

#[tokio::test]
async fn x13_an_invalid_pattern_is_refused_and_a_match_free_log_gives_none() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals.spawn(sh(dir.path(), "echo hi")).await.unwrap();
    until_exit(&mut spawned.events).await;
    for pattern in ["(", "a{1000}{1000}{1000}"] {
        let error = terminals
            .search(&search(&spawned.id, pattern, None))
            .unwrap_err();
        assert_eq!(error.code, code::INVALID_PARAMS, "{pattern}");
    }
    let found = terminals.search(&search(&spawned.id, "zzz", None)).unwrap();
    assert!(found.matches.is_empty() && !found.truncated);
}

#[tokio::test]
async fn x13_reading_writes_nothing_and_changes_no_screen_state_or_event() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, bus) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "printf 'shown\\n'; read line; echo got:$line",
        ))
        .await
        .unwrap();
    until_printed(&mut spawned.events, "shown\r\n").await;
    let mut seen = bus.subscribe();
    let before = terminals.snapshot(&spawned.id).unwrap();
    let info = terminals.list();
    let context = ctx(&dir, &bus);
    for (method, params) in [
        ("terminal.screen", json!({"id": spawned.id})),
        ("terminal.read", json!({"id": spawned.id, "after": 0})),
        (
            "terminal.search",
            json!({"id": spawned.id, "pattern": "shown"}),
        ),
    ] {
        terminals.call(&context, method, params).await.unwrap();
    }
    let after = terminals.snapshot(&spawned.id).unwrap();
    assert_eq!((before.after, &before.data), (after.after, &after.data));
    assert_eq!(terminals.list()[0].running, info[0].running);
    assert!(seen.try_recv().is_err(), "a read emitted an event");
    // Nothing was typed: the program still waits and prints only what is typed next.
    terminals.write(&spawned.id, b"typed\n").await.unwrap();
    let (printed, code) = tokio::time::timeout(PATIENCE, until_exit(&mut spawned.events))
        .await
        .unwrap();
    assert!(printed.contains("got:typed"), "{printed:?}");
    assert_eq!(code, Some(0));
}

#[tokio::test]
async fn x13_an_unknown_terminal_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    assert_eq!(
        terminals.read_screen("99", None).unwrap_err().code,
        code::NOT_FOUND
    );
    assert_eq!(
        terminals.read(&read("99", 0, None)).unwrap_err().code,
        code::NOT_FOUND
    );
    assert_eq!(
        terminals.search(&search("99", "x", None)).unwrap_err().code,
        code::NOT_FOUND
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn x13_searching_a_full_log_does_not_block_output_or_kill() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let terminals = std::sync::Arc::new(terminals);
    let spawned = terminals
        .spawn(sh(
            dir.path(),
            "head -c 2000000 /dev/zero | tr '\\0' 'a' | fold -w 80; sleep 30",
        ))
        .await
        .unwrap();
    tokio::time::timeout(PATIENCE, async {
        while terminals.snapshot(&spawned.id).unwrap().after < 2_000_000 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    let id = spawned.id.clone();
    let reader = Arc::clone(&terminals);
    let searching =
        tokio::task::spawn_blocking(move || reader.search(&search(&id, "b|a{3}$", None)).unwrap());
    tokio::time::timeout(PATIENCE, terminals.kill(&spawned.id))
        .await
        .expect("kill is not blocked")
        .unwrap();
    tokio::time::timeout(PATIENCE, searching)
        .await
        .expect("the search ends within PATIENCE")
        .unwrap();
}
