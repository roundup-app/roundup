//! X14 library capability only; production Output projection belongs to #1930.

#[test]
fn x14_library_observes_screen_edits_for_source_offsets() {
    let mut parser = vt100::Parser::new(2, 4, 0);
    parser.process(b"\r\n\x1b[H");
    assert!(parser.screen_mut().set_row_source(0, Some(0)));
    assert!(parser.screen_mut().set_row_source(1, Some(2)));
    let before = parser.screen().state_formatted();
    parser.process(b"\x1b[1M");
    assert_eq!(parser.screen().state_formatted(), before);
    assert_eq!(parser.screen().row_source(0), Some(2));
    assert_eq!(parser.screen().row_source(1), None);

    let mut parser = vt100::Parser::new(1, 4, 0);
    for offset in 1..=3 {
        parser.process(b"a");
        assert!(
            parser
                .screen_mut()
                .set_cell_source(0, offset - 1, Some(u64::from(offset)))
        );
    }
    parser.process(b"\x1b[H\x1b[P");
    assert_eq!(parser.screen().contents(), "aa");
    assert_eq!(parser.screen().cell(0, 0).unwrap().source(), Some(2));
    assert_eq!(parser.screen().cell(0, 1).unwrap().source(), Some(3));
    assert_eq!(parser.screen().cell(0, 2).unwrap().source(), None);
    assert_eq!(parser.screen().cell(0, 0), parser.screen().cell(0, 1));
    // The same equal rows must move under cursor-relative edits and both
    // default and restricted margins. Literal tags identify original rows.
    for (edit, expected) in [
        (b"\x1b[S".as_slice(), [Some(10), Some(20), Some(30), None]),
        (b"\x1b[T", [None, Some(0), Some(10), Some(20)]),
        (b"\x1b[B\x1b[M", [Some(0), Some(20), Some(30), None]),
        (b"\x1b[B\x1b[L", [Some(0), None, Some(10), Some(20)]),
        (b"\x1b[2;3r\x1b[S", [Some(0), Some(20), None, Some(30)]),
        (b"\x1b[2;3r\x1b[T", [Some(0), None, Some(10), Some(30)]),
        (b"\x1b[2;3r\x1b[M", [Some(0), Some(20), None, Some(30)]),
        (b"\x1b[2;3r\x1b[L", [Some(0), None, Some(10), Some(30)]),
        (
            b"\x1b]2;[1M[P[S\x07",
            [Some(0), Some(10), Some(20), Some(30)],
        ),
        (b"\x1b[2;3r\x1b[3;1H\n", [Some(0), Some(20), None, Some(30)]),
        (b"\x1b[2;3r\x1bM", [Some(0), None, Some(10), Some(30)]),
    ] {
        let mut parser = vt100::Parser::new(4, 4, 3);
        for row in 0..4 {
            assert!(
                parser
                    .screen_mut()
                    .set_row_source(row, Some(u64::from(row) * 10))
            );
        }
        for byte in edit {
            parser.process(&[*byte]);
        }
        assert_eq!(
            std::array::from_fn::<_, 4, _>(|row| parser.screen().row_source(row as u16)),
            expected,
            "{edit:?}"
        );
    }
    for (edit, expected) in [
        (
            b"\x1b[H\x1b[@".as_slice(),
            [None, Some(1), Some(2), Some(3)],
        ),
        (b"\x1b[H\x1b[C\x1b[P", [Some(1), Some(3), None, None]),
        (b"\x1b[H\x1b[C\x1b[X", [Some(1), None, Some(3), None]),
        (b"\x1b[H\x1b[C\x1b[K", [Some(1), None, None, None]),
        (b"\x1b[H\x1b[2J", [None, None, None, None]),
        (b"\x1b[H\x1b[Cz", [Some(1), None, Some(3), None]),
        (b"\x1b]2;[P[@[X\x07", [Some(1), Some(2), Some(3), None]),
    ] {
        let mut parser = vt100::Parser::new(1, 4, 0);
        parser.process(b"aaa");
        for col in 0..3 {
            assert!(
                parser
                    .screen_mut()
                    .set_cell_source(0, col, Some(u64::from(col) + 1))
            );
        }
        for byte in edit {
            parser.process(&[*byte]);
        }
        assert_eq!(
            std::array::from_fn::<_, 4, _>(|col| parser
                .screen()
                .cell(0, col as u16)
                .unwrap()
                .source()),
            expected,
            "{edit:?}"
        );
    }
    // Scrollback retains the actual removed row, even when every row is blank.
    let mut history = vt100::Parser::new(2, 4, 2);
    assert!(history.screen_mut().set_row_source(0, Some(0)));
    assert!(history.screen_mut().set_row_source(1, Some(2)));
    assert!(history.screen_mut().set_cell_source(1, 0, Some(7)));
    history.process(b"\x1b[S");
    assert_eq!(history.screen().row_source(0), Some(2));
    assert_eq!(history.screen().cell(0, 0).unwrap().source(), Some(7));
    history.screen_mut().set_scrollback(1);
    assert_eq!(history.screen().row_source(0), Some(0));
    assert_eq!(history.screen().row_source(1), Some(2));
    assert!(history.screen_mut().set_row_source(0, Some(8)));
    assert!(history.screen_mut().set_cell_source(0, 0, Some(9)));
    assert_eq!(history.screen().row_source(0), Some(0));
    history.screen_mut().set_scrollback(0);
    assert_eq!(history.screen().row_source(0), Some(8));
    assert_eq!(history.screen().cell(0, 0).unwrap().source(), Some(9));
    history.process(b"\x1b[2K");
    assert_eq!(history.screen().row_source(0), None);
    assert_eq!(history.screen().cell(0, 0).unwrap().source(), None);

    // Appending a combining codepoint retains the base glyph's origin.
    let mut combining = vt100::Parser::new(1, 4, 0);
    combining.process(b"a");
    assert!(combining.screen_mut().set_cell_source(0, 0, Some(1)));
    combining.process("\u{301}".as_bytes());
    assert_eq!(combining.screen().cell(0, 0).unwrap().source(), Some(1));
    assert_eq!(
        combining.screen().cell(0, 0).unwrap().contents(),
        "a\u{301}"
    );

    // Invalid coordinates cannot mutate the grid; annotation does not alter
    // visual equality and may be explicitly cleared by its owner.
    assert!(!parser.screen_mut().set_cell_source(9, 0, Some(8)));
    assert!(!parser.screen_mut().set_row_source(9, Some(8)));
    assert!(parser.screen_mut().set_cell_source(0, 0, None));
    assert!(parser.screen_mut().set_row_source(0, None));
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Sources {
    offset: u64,
    writes: u64,
    controls: u64,
}

impl vt100::Callbacks for Sources {
    fn text(&mut self, screen: &mut vt100::Screen, _: char) {
        self.writes += 1;
        // No recognition or grid editing: tag newly written cells exposed by
        // the library. Equal surviving cells already carry their own offsets.
        let (rows, cols) = screen.size();
        for row in 0..rows {
            for col in 0..cols {
                let cell = screen.cell(row, col).unwrap();
                if cell.has_contents() && cell.source().is_none() {
                    assert!(screen.set_cell_source(row, col, Some(self.offset)));
                }
            }
        }
    }

    fn control(&mut self, screen: &mut vt100::Screen, control: u8) {
        self.controls += 1;
        if (10..=12).contains(&control) {
            let row = screen.cursor_position().0;
            if screen.row_source(row).is_none() {
                assert!(screen.set_row_source(row, Some(self.offset)));
            }
        }
    }
}

fn feed(parser: &mut vt100::Parser<Sources>, bytes: &[u8], start: usize) {
    for (index, byte) in bytes.iter().enumerate() {
        parser.callbacks_mut().offset = (start + index + 1) as u64;
        parser.process(&[*byte]);
    }
}

fn sources(screen: &vt100::Screen) -> Vec<(Option<u64>, Vec<Option<u64>>)> {
    let (rows, cols) = screen.size();
    (0..rows)
        .map(|row| {
            (
                screen.row_source(row),
                (0..cols)
                    .map(|col| screen.cell(row, col).unwrap().source())
                    .collect(),
            )
        })
        .collect()
}

#[test]
fn x14_library_screen_edit_observation_survives_checkpoint_replay() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("ROUNDUP_X14_EDIT_STORAGE").is_some() {
        fn rss_kib() -> u64 {
            std::fs::read_to_string("/proc/self/status")
                .unwrap()
                .lines()
                .find_map(|line| line.strip_prefix("VmRSS:"))
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap()
                .parse()
                .unwrap()
        }
        let mut parser = vt100::Parser::new(4, 16, 8);
        let chunk = b"aaa\r\n\x1b[H\x1b[P\x1b[S\x1b[L\x1b[M\x1b[T\x1b[X".repeat(256);
        let advance = |parser: &mut vt100::Parser| {
            parser.process(&chunk);
            assert!(parser.screen_mut().set_row_source(0, Some(42)));
            assert!(parser.screen_mut().set_cell_source(0, 0, Some(43)));
        };
        let steps = (1024 * 1024_usize).div_ceil(chunk.len());
        for _ in 0..steps {
            advance(&mut parser);
        }
        let one_mib = rss_kib();
        let snapshot = sources(parser.screen());
        for _ in steps..steps * 64 {
            advance(&mut parser);
        }
        let sixty_four_mib = rss_kib();
        assert_eq!(sources(parser.screen()), snapshot);
        assert!(
            sixty_four_mib <= one_mib + 1024,
            "{one_mib} -> {sixty_four_mib} KiB"
        );
        let mut checkpoint = parser.clone();
        checkpoint.screen_mut().set_scrollback(usize::MAX);
        assert!(checkpoint.screen().scrollback() <= 8);
        assert_eq!(parser.screen().row_source(0), Some(42));
        assert_eq!(parser.screen().cell(0, 0).unwrap().source(), Some(43));
        assert_eq!(std::mem::size_of::<vt100::Cell>(), 48);
        println!(
            "edit annotations: 1MiB={one_mib}KiB 64MiB={sixty_four_mib}KiB Cell=48 bytes; history<=8 rows"
        );
        return;
    }
    for input in [
        b"\r\n\x1b[H\x1b[1M".as_slice(),
        b"aaa\x1b[H\x1b[P\x1b[@z\x1b[X",
        b"aaa\x1b]2;hidden[1M\x07\x1b[H\x1b[P",
        b"aaa\x1b]2;hidden[P\x1b\\\x1b[H\x1b[P",
        "ééé\x1b[H\x1b[P界\x1b[2G\x1b[X".as_bytes(),
        b"a\r\nb\r\nc\x1b[2;3r\x1b[2;1H\x1b[M\x1b[L\x1b[S\x1b[T",
        b"aaa\x1b[H\x1b[@\x1b[2G\x1b[K\x1b[2J",
    ] {
        let mut uninterrupted = vt100::Parser::new_with_callbacks(3, 6, 4, Sources::default());
        assert!(uninterrupted.screen_mut().set_row_source(0, Some(0)));
        feed(&mut uninterrupted, input, 0);
        for cut in 0..=input.len() {
            let mut original = vt100::Parser::new_with_callbacks(3, 6, 4, Sources::default());
            assert!(original.screen_mut().set_row_source(0, Some(0)));
            feed(&mut original, &input[..cut], 0);
            let screen = original.screen().state_formatted();
            let annotations = sources(original.screen());
            let callbacks = original.callbacks().clone();
            {
                // One restore proves replay and leaves the source unchanged; repeating
                // the same restore from the same source adds no failure detection.
                let mut replay = original.clone();
                feed(&mut replay, &input[cut..], cut);
                assert_eq!(
                    sources(replay.screen()),
                    sources(uninterrupted.screen()),
                    "cut {cut}"
                );
                assert_eq!(
                    replay.screen().state_formatted(),
                    uninterrupted.screen().state_formatted()
                );
                assert_eq!(replay.callbacks(), uninterrupted.callbacks());
                // History annotations are part of the checkpoint as well.
                replay.screen_mut().set_scrollback(4);
                let mut expected = uninterrupted.clone();
                expected.screen_mut().set_scrollback(4);
                assert_eq!(sources(replay.screen()), sources(expected.screen()));
            }
            assert_eq!(original.screen().state_formatted(), screen);
            assert_eq!(sources(original.screen()), annotations);
            assert_eq!(original.callbacks(), &callbacks);
            feed(&mut original, &input[cut..], cut);
            assert_eq!(sources(original.screen()), sources(uninterrupted.screen()));
        }
    }
    let mut literal = vt100::Parser::new_with_callbacks(2, 4, 0, Sources::default());
    assert!(literal.screen_mut().set_row_source(0, Some(0)));
    feed(&mut literal, b"\r\n\x1b[H\x1b[M", 0);
    assert_eq!(literal.screen().row_source(0), Some(2));
    let mut literal = vt100::Parser::new_with_callbacks(1, 4, 0, Sources::default());
    feed(&mut literal, b"aaa\x1b[H\x1b[P", 0);
    assert_eq!(literal.screen().cell(0, 0).unwrap().source(), Some(2));
    assert_eq!(literal.screen().cell(0, 1).unwrap().source(), Some(3));
    let mut unicode = vt100::Parser::new_with_callbacks(1, 4, 0, Sources::default());
    feed(&mut unicode, "ééé\x1b[H\x1b[P".as_bytes(), 0);
    assert_eq!(unicode.screen().cell(0, 0).unwrap().source(), Some(4));
    assert_eq!(unicode.screen().cell(0, 1).unwrap().source(), Some(6));
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "x14_library_screen_edit_observation_survives_checkpoint_replay",
                "--nocapture",
            ])
            .env("ROUNDUP_X14_EDIT_STORAGE", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        print!("{}", String::from_utf8_lossy(&output.stdout));
    }
}
