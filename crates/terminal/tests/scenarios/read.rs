use std::sync::Arc;

use contracts::EventData;
use contracts::terminal::{Read, ReadParams, SearchParams};
use rpc::{Module, code};
use serde_json::json;
use terminal::Terminals;
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::RecvError;

use crate::common::{PATIENCE, ctx, decode, open, sh, until_exit, until_printed};

fn read(id: &str, after: u64, max: Option<u32>) -> ReadParams {
    ReadParams {
        id: id.into(),
        after: Some(after),
        reader: None,
        max,
    }
}

fn read_as(id: &str, reader: &str) -> ReadParams {
    ReadParams {
        id: id.into(),
        after: None,
        reader: Some(reader.into()),
        max: None,
    }
}

/// The read from `after` once the output ends a line: a line's end can arrive in a later chunk
/// than its text, as on Linux.
async fn read_to_a_line_end(
    terminals: &Terminals,
    events: &mut Receiver<EventData>,
    id: &str,
    after: u64,
) -> Read {
    loop {
        let got = terminals.read(&read(id, after, None)).unwrap();
        if got.text.ends_with('\n') {
            return got;
        }
        until_printed(events, "\n").await;
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
    until_printed(&mut spawned.events, &"0123456789\r\n".repeat(20)).await;
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
    let first = read_to_a_line_end(&terminals, &mut spawned.events, &spawned.id, 0).await;
    assert_eq!((first.from, first.text.as_str()), (0, "one\n"));
    assert!(!first.truncated);
    terminals.write(&spawned.id, b"x\n").await.unwrap();
    until_printed(&mut spawned.events, "two").await;
    let second = read_to_a_line_end(&terminals, &mut spawned.events, &spawned.id, first.next).await;
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
    let mut seen = bus.subscribe();
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "printf 'shown\\n'; read line; echo got:$line",
        ))
        .await
        .unwrap();
    until_printed(&mut spawned.events, "shown\r\n").await;
    // The bus gets each chunk after the Terminal's own channel, and the output printed above is
    // not a read's event: drain the bus up to its end.
    let end = terminals.snapshot(&spawned.id).unwrap().after;
    tokio::time::timeout(PATIENCE, async {
        loop {
            match seen.recv().await.expect("the bus stays open").data {
                EventData::TerminalOutput(out)
                    if out.offset + decode(&out.data).len() as u64 >= end =>
                {
                    break;
                }
                _ => {}
            }
        }
    })
    .await
    .expect("the bus delivers the printed output");
    while seen.try_recv().is_ok() {}
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
    let late = seen.try_recv();
    assert!(late.is_err(), "a read emitted an event: {late:?}");
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
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "head -c 2000000 /dev/zero | tr '\\0' 'a' | fold -w 80; sleep 30",
        ))
        .await
        .unwrap();
    // A lagging receiver skips chunks; the next one still says where the output ends.
    tokio::time::timeout(PATIENCE, async {
        let mut end = 0;
        while end < 2_000_000 {
            match spawned.events.recv().await {
                Ok(EventData::TerminalOutput(out)) => {
                    end = out.offset + decode(&out.data).len() as u64;
                }
                Err(RecvError::Closed) => panic!("the Terminal's events closed"),
                _ => {}
            }
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

/// A finished Terminal that printed `script`'s output, so every read sees all of it.
async fn finished(dir: &tempfile::TempDir, terminals: &Terminals, script: &str) -> String {
    let mut spawned = terminals.spawn(sh(dir.path(), script)).await.unwrap();
    until_exit(&mut spawned.events).await;
    spawned.id
}

#[tokio::test]
async fn x16_the_second_read_is_only_the_delta() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            "printf 'one\\r\\n'; read a; printf 'two\\r\\n'; read b",
        ))
        .await
        .unwrap();
    read_to_a_line_end(&terminals, &mut spawned.events, &spawned.id, 0).await;
    let first = terminals.read(&read_as(&spawned.id, "a1")).unwrap();
    assert_eq!((first.from, first.text.as_str()), (0, "one\n"));
    terminals.write(&spawned.id, b"x\n").await.unwrap();
    read_to_a_line_end(&terminals, &mut spawned.events, &spawned.id, first.next).await;
    let second = terminals.read(&read_as(&spawned.id, "a1")).unwrap();
    assert_eq!(second.from, first.next);
    assert!(second.text.ends_with("two\n") && !second.text.contains("one"));
    assert_eq!(
        terminals.read(&read_as(&spawned.id, "a1")).unwrap().text,
        ""
    );
    terminals.kill(&spawned.id).await.unwrap();
}

#[tokio::test]
async fn x16_readers_have_separate_cursors() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let id = finished(&dir, &terminals, "printf 'one\\r\\ntwo\\r\\n'").await;
    let first = terminals.read(&read_as(&id, "a1")).unwrap();
    assert_eq!(first.text, "one\ntwo\n");
    assert_eq!(
        terminals.read(&read_as(&id, "a2")).unwrap().text,
        "one\ntwo\n"
    );
    let other = finished(&dir, &terminals, "printf 'zzz\\r\\n'").await;
    assert_eq!(
        terminals.read(&read_as(&other, "a1")).unwrap().text,
        "zzz\n"
    );
}

#[tokio::test]
async fn x16_a_read_with_after_leaves_the_cursor() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let id = finished(&dir, &terminals, "printf 'one\\r\\ntwo\\r\\n'").await;
    let mut both = read_as(&id, "a1");
    both.after = Some(0);
    assert_eq!(terminals.read(&both).unwrap().text, "one\ntwo\n");
    assert_eq!(
        terminals.read(&read_as(&id, "a1")).unwrap().text,
        "one\ntwo\n"
    );
    let from_two = terminals
        .read(&ReadParams {
            max: Some(4),
            ..both.clone()
        })
        .unwrap();
    both.after = Some(from_two.next);
    assert_eq!(terminals.read(&both).unwrap().text, "two\n");
    assert_eq!(terminals.read(&read_as(&id, "a1")).unwrap().text, "");
}

#[tokio::test]
async fn x16_a_read_with_no_reader_and_no_after_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let id = finished(&dir, &terminals, "printf 'one\\r\\n'").await;
    let mut neither = read_as(&id, "a1");
    neither.reader = None;
    assert_eq!(
        terminals.read(&neither).unwrap_err().code,
        code::INVALID_PARAMS
    );
}

#[tokio::test]
async fn x16_a_read_holds_no_escape_byte() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let id = finished(
        &dir,
        &terminals,
        "printf '\\033[31mred\\033[0m\\r\\n\\033[38;5;196mblaze\\033[0m\\r\\n'",
    )
    .await;
    let got = terminals.read(&read_as(&id, "a1")).unwrap();
    assert_eq!(got.text, "red\nblaze\n");
    assert!(!got.text.contains('\u{1b}') && !got.text.contains("[31m"));
}

#[tokio::test]
async fn x16_a_read_returns_at_most_200_lines_and_the_next_read_continues() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let id = finished(&dir, &terminals, "seq 1 450").await;
    let first = terminals.read(&read_as(&id, "a1")).unwrap();
    assert_eq!(first.text.lines().count(), 200);
    assert!(first.truncated);
    let second = terminals.read(&read_as(&id, "a1")).unwrap();
    assert_eq!(second.from, first.next);
    assert_eq!(second.text.lines().next(), Some("201"));
    assert_eq!(second.text.lines().count(), 200);
    let third = terminals.read(&read_as(&id, "a1")).unwrap();
    assert_eq!(third.text.lines().count(), 50);
    assert!(!third.truncated);
}

#[tokio::test]
async fn x16_the_line_cap_loses_and_repeats_no_line() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);
    let id = finished(&dir, &terminals, "seq 1 650").await;
    let mut seen = Vec::new();
    loop {
        let got = terminals.read(&read_as(&id, "a1")).unwrap();
        seen.extend(got.text.lines().map(str::to_owned));
        if !got.truncated {
            break;
        }
    }
    let want: Vec<String> = (1..=650).map(|n| n.to_string()).collect();
    assert_eq!(seen, want);
}

#[tokio::test]
async fn x16_a_read_emits_no_event_and_the_digest_holds_no_terminal_text() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, bus) = open(&dir);
    let mut bus_events = bus.subscribe();
    let mut spawned = terminals
        .spawn(sh(dir.path(), "printf 'ZEBRA\\r\\n'; read a"))
        .await
        .unwrap();
    until_printed(&mut spawned.events, "ZEBRA").await;
    while bus_events.try_recv().is_ok() {}
    let mut quiet = terminals.subscribe(&spawned.id).unwrap();
    terminals.read(&read_as(&spawned.id, "door")).unwrap();
    assert!(bus_events.try_recv().is_err(), "a read reached the Bus");
    assert!(quiet.try_recv().is_err(), "a read emitted a Terminal event");
    terminals.kill(&spawned.id).await.unwrap();
}
