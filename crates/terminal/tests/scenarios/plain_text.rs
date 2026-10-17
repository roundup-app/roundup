use contracts::terminal::{ReadParams, SearchParams};

use crate::common::{open, sh, until_exit};

fn read(id: &str, after: u64, max: Option<u32>) -> ReadParams {
    ReadParams {
        id: id.into(),
        after: Some(after),
        reader: None,
        max,
    }
}

/// X14: the plain text of `terminal.read` and `terminal.search` is the `vt100` parser's, whatever
/// the chunk boundaries and however much of the log was evicted.
#[tokio::test]
async fn x14_plain_text_uses_vt100_with_chunk_and_eviction_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    let (terminals, _) = open(&dir);

    // Each `sleep` ends a PTY write inside a CSI, an OSC and a UTF-8 character. The lines are
    // 16, 15, 14, 17, 6 and 5 bytes long once the PTY turns each LF into CR LF.
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            r"printf 'abcdef\033[3D\033[KX\n'
printf 'b\033[3'; sleep 0.2; printf '1mred\033[0m\n'
printf 'c\033]0;ti'; sleep 0.2; printf 'tle\007d\n'
printf ' 10%%\r 50%%\r100%%\r\n'
printf 'e\303'; sleep 0.2; printf '\251!\n'
printf 'f\377g\n'",
        ))
        .await
        .unwrap();
    until_exit(&mut spawned).await;
    let id = spawned.id;
    let whole = terminals.read(&read(&id, 0, None)).unwrap();
    assert_eq!(
        (whole.text.as_str(), whole.from, whole.next, whole.truncated),
        ("abcX\nbred\ncd\n100%\ne\u{e9}!\nf\u{fffd}g\n", 0, 73, false)
    );
    let found = terminals
        .search(&SearchParams {
            id: id.clone(),
            pattern: "^(100%|e)".into(),
            after: None,
            max: None,
        })
        .unwrap();
    let got: Vec<_> = found
        .matches
        .iter()
        .map(|m| (m.offset, m.text.as_str()))
        .collect();
    assert_eq!(got, [(45, "100%"), (62, "e\u{e9}!")]);
    assert_eq!(found.next, 73);
    // From inside a line: only what was written after `after`, without its first characters.
    let inside = terminals.read(&read(&id, 20, None)).unwrap();
    assert_eq!(
        (inside.text.as_str(), inside.from, inside.next),
        ("red\ncd\n100%\ne\u{e9}!\nf\u{fffd}g\n", 20, 73)
    );

    // A scene of 20 bytes, then lines up to 1 MiB + 16 bytes: the log starts between the two
    // bytes of the "é", after the "red", the colour and the title.
    let mut spawned = terminals
        .spawn(sh(
            dir.path(),
            r"printf '\033[31mred\033]0;ti\007\303\251!\n'; yes z | head -n 349524",
        ))
        .await
        .unwrap();
    until_exit(&mut spawned).await;
    let id = spawned.id;
    let cut = terminals.read(&read(&id, 0, None)).unwrap();
    assert_eq!((cut.from, cut.truncated, cut.text.len()), (16, true, 402));
    assert!(
        cut.text.starts_with("\u{e9}!\nz\nz\n"),
        "{:?}",
        &cut.text[..12]
    );
    assert_eq!(cut.next, 20 + 3 * 199);
    // A first line over the cap is cut between characters; the rest begins at its own line feed.
    let first = terminals.read(&read(&id, 0, Some(3))).unwrap();
    assert_eq!((first.text.as_str(), first.next), ("\u{e9}!", 18));
    let rest = terminals.read(&read(&id, first.next, Some(5))).unwrap();
    assert_eq!(
        (rest.text.as_str(), rest.from, rest.next, rest.truncated),
        ("\nz\nz\n", 18, 26, true)
    );
}
