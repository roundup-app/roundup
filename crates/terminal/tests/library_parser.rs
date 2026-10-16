//! Library-only prerequisites for X14; these do not exercise selected output streams.

#[cfg(target_os = "linux")]
#[derive(Clone, Default)]
struct Titles(Vec<Vec<u8>>);

#[cfg(target_os = "linux")]
impl vt100::Callbacks for Titles {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.0.push(title.to_vec());
    }
}

#[cfg(target_os = "linux")]
#[test]
fn x14_library_parser_bounds_pending_osc() {
    const CHILD: &str = "ROUNDUP_X14_OSC_PROBE";
    if std::env::var_os(CHILD).is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "x14_library_parser_bounds_pending_osc",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        print!("{}", String::from_utf8_lossy(&output.stdout));
        return;
    }
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
    let mut parser = vt100::Parser::new_with_callbacks(3, 80, 0, Titles::default());
    parser.process(b"\x1b]2;");
    let chunk = [b'x'; 8192];
    for _ in 0..128 {
        parser.process(&chunk);
    }
    let one_mib = rss_kib();
    for _ in 128..8192 {
        parser.process(&chunk);
    }
    let sixty_four_mib = rss_kib();
    // A checkpoint made after more than the Output-log cap retains the pending
    // over-cap OSC; replay consumes its suffix without changing the live parser.
    let mut replay = parser.clone();
    replay.process(b"hidden\x1b\\visible");
    assert_eq!(replay.screen().contents(), "visible");
    assert!(parser.screen().contents().is_empty());
    assert!(parser.callbacks().0.is_empty());
    parser.process(b"hidden\x07visible");
    let completed = rss_kib();
    println!("1MiB={one_mib}KiB 64MiB={sixty_four_mib}KiB terminated={completed}KiB");
    // Isolated process; 1 MiB allowance covers RSS page/accounting noise, not payload.
    assert!(sixty_four_mib <= one_mib + 1024);
    assert!(completed <= one_mib + 1024);
    assert_eq!(parser.screen().contents(), "visible");
    // The 1024-byte fixed buffer includes the one-byte OSC command ("2").
    assert_eq!(parser.callbacks().0, [vec![b'x'; 1023]]);
    parser.process(b"\x1b]2;short\x1b\\later");
    assert_eq!(parser.screen().contents(), "visiblelater");
    assert_eq!(parser.callbacks().0.last().unwrap(), b"short");
}

#[test]
fn x14_library_replay_preserves_pending_state() {
    // Every byte cut includes partial parameters, the ESC in ST, and each UTF-8 byte.
    for (input, expected) in [
        (b"abc\x1b[2D@".as_slice(), "a@c"),
        (b"\x1b]2;privatehidden\x07visible".as_slice(), "visible"),
        (b"\x1b]2;privatehidden\x1b\\visible".as_slice(), "visible"),
        ("é🦀".as_bytes(), "é🦀"),
        (b"old\rnew\x1b[K\xff!".as_slice(), "new�!"),
    ] {
        let mut continuous = vt100::Parser::new(3, 80, 0);
        continuous.process(input);
        assert_eq!(continuous.screen().contents(), expected);
        for cut in 0..=input.len() {
            let mut live = vt100::Parser::new(3, 80, 0);
            let raw_prefix = input[..cut].to_vec();
            live.process(&raw_prefix);
            let checkpoint = live.clone();
            drop(raw_prefix); // The eviction cut retains library state, not raw history.
            let before = live.screen().state_formatted();
            for _ in 0..3 {
                let mut replay = checkpoint.clone();
                replay.process(&input[cut..]);
                assert_eq!(
                    replay.screen().state_formatted(),
                    continuous.screen().state_formatted()
                );
                assert_eq!(
                    replay.screen().contents(),
                    expected,
                    "cut={cut} input={input:?}"
                );
            }
            assert_eq!(live.screen().state_formatted(), before);
            live.process(&input[cut..]);
            assert_eq!(live.screen().contents(), expected, "live cut={cut}");
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
struct Writes {
    after: usize,
    text: Vec<(usize, char, (u16, u16))>,
    titles: Vec<Vec<u8>>,
}

impl vt100::Callbacks for Writes {
    fn text(&mut self, screen: &mut vt100::Screen, c: char) {
        self.text.push((self.after, c, screen.cursor_position()));
    }

    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.titles.push(title.to_vec());
    }
}

fn observe(parser: &mut vt100::Parser<Writes>, bytes: &[u8]) {
    for byte in bytes {
        parser.callbacks_mut().after += 1;
        parser.process(std::slice::from_ref(byte));
    }
}

#[test]
fn x14_library_reports_handled_text_at_raw_byte_offsets() {
    let mut literal = vt100::Parser::new_with_callbacks(2, 8, 0, Writes::default());
    let mut csi = literal.clone();
    observe(&mut literal, b"CB\r");
    observe(&mut csi, b"CB\r\x1b[");
    assert_eq!(
        literal.screen().state_formatted(),
        csi.screen().state_formatted()
    );
    observe(&mut literal, b"C");
    observe(&mut csi, b"C");
    assert_eq!(
        literal.screen().state_formatted(),
        csi.screen().state_formatted()
    );
    assert_eq!(
        literal.callbacks().text,
        [(1, 'C', (0, 1)), (2, 'B', (0, 2)), (4, 'C', (0, 1))]
    );
    assert_eq!(csi.callbacks().text, [(1, 'C', (0, 1)), (2, 'B', (0, 2))]);
}

#[test]
fn x14_library_write_observation_survives_checkpoint_replay() {
    let input = "CB\rCé🦀\x1b]2;hidden\x1b\\\x1b[2DC".as_bytes();
    let mut continuous = vt100::Parser::new_with_callbacks(3, 80, 0, Writes::default());
    observe(&mut continuous, input);
    assert_eq!(
        continuous.callbacks().text,
        [
            (1, 'C', (0, 1)),
            (2, 'B', (0, 2)),
            (4, 'C', (0, 1)),
            (6, 'é', (0, 2)),
            (10, '🦀', (0, 4)),
            (27, 'C', (0, 3)),
        ]
    );
    assert_eq!(continuous.callbacks().titles, [b"hidden".to_vec()]);
    let mut batched = vt100::Parser::new_with_callbacks(3, 80, 0, Writes::default());
    batched.process(input);
    assert_eq!(
        batched
            .callbacks()
            .text
            .iter()
            .map(|(_, c, pos)| (*c, *pos))
            .collect::<Vec<_>>(),
        continuous
            .callbacks()
            .text
            .iter()
            .map(|(_, c, pos)| (*c, *pos))
            .collect::<Vec<_>>()
    );
    assert_eq!(batched.callbacks().titles, continuous.callbacks().titles);
    // Every cut includes pending UTF-8, CSI parameters, OSC payload and ST.
    for cut in 0..=input.len() {
        let mut live = vt100::Parser::new_with_callbacks(3, 80, 0, Writes::default());
        observe(&mut live, &input[..cut]);
        let checkpoint = live.clone();
        let before_screen = live.screen().state_formatted();
        let before_callbacks = live.callbacks().clone();
        for _ in 0..2 {
            let mut replay = checkpoint.clone();
            observe(&mut replay, &input[cut..]);
            assert_eq!(replay.callbacks(), continuous.callbacks(), "cut={cut}");
            assert_eq!(
                replay.screen().state_formatted(),
                continuous.screen().state_formatted()
            );
        }
        assert_eq!(live.callbacks(), &before_callbacks, "live cut={cut}");
        assert_eq!(live.screen().state_formatted(), before_screen);
        observe(&mut live, &input[cut..]);
        assert_eq!(live.callbacks(), continuous.callbacks());
    }
}

#[test]
fn x14_library_renders_replacement_characters() {
    for (input, expected, writes) in [
        (
            b"A\xffB".as_slice(),
            "A�B",
            vec![(1, 'A', (0, 1)), (2, '�', (0, 2)), (3, 'B', (0, 3))],
        ),
        (
            "A�B".as_bytes(),
            "A�B",
            vec![(1, 'A', (0, 1)), (4, '�', (0, 2)), (5, 'B', (0, 3))],
        ),
        (
            b"A\xff\x1b[1DB".as_slice(),
            "AB",
            vec![(1, 'A', (0, 1)), (2, '�', (0, 2)), (7, 'B', (0, 2))],
        ),
        (
            b"A\xe2\x82B".as_slice(),
            "A�B",
            vec![(1, 'A', (0, 1)), (4, '�', (0, 2)), (4, 'B', (0, 3))],
        ),
        (
            b"A\xe2!B".as_slice(),
            "A�!B",
            vec![
                (1, 'A', (0, 1)),
                (3, '�', (0, 2)),
                (3, '!', (0, 3)),
                (4, 'B', (0, 4)),
            ],
        ),
        (
            "AéB".as_bytes(),
            "AéB",
            vec![(1, 'A', (0, 1)), (3, 'é', (0, 2)), (4, 'B', (0, 3))],
        ),
    ] {
        let mut parser = vt100::Parser::new_with_callbacks(3, 80, 0, Writes::default());
        observe(&mut parser, input);
        assert_eq!(parser.screen().contents(), expected, "{input:?}");
        assert_eq!(parser.callbacks().text, writes, "{input:?}");
        assert_eq!(parser.screen().cursor_position(), writes.last().unwrap().2);
        let mut batched = vt100::Parser::new(3, 80, 0);
        batched.process(input);
        assert_eq!(
            batched.screen().state_formatted(),
            parser.screen().state_formatted()
        );
    }
}

#[test]
fn x14_library_replacement_replay_preserves_cursor_and_offsets() {
    for input in [
        b"A\xffB".as_slice(),
        "A�B".as_bytes(),
        b"A\xff\x1b[1DB",
        b"A\xe2\x82B",
        b"A\xe2!B",
        "Aé🦀B".as_bytes(),
        b"A\xe2\x82\x1b[1DB",
        b"A\x1b]2;\xff\xef\xbf\xbdhidden\x07B",
        b"A\x1b]2;\xffhidden\x1b\\B",
    ] {
        let mut continuous = vt100::Parser::new_with_callbacks(3, 80, 0, Writes::default());
        observe(&mut continuous, input);
        if input.starts_with(b"A\x1b]") {
            assert_eq!(continuous.screen().contents(), "AB");
            assert_eq!(
                continuous.callbacks().text,
                [(1, 'A', (0, 1)), (input.len(), 'B', (0, 2))]
            );
        }
        for cut in 0..=input.len() {
            let mut live = vt100::Parser::new_with_callbacks(3, 80, 0, Writes::default());
            observe(&mut live, &input[..cut]);
            let before = live.clone();
            for _ in 0..3 {
                let mut replay = live.clone();
                observe(&mut replay, &input[cut..]);
                assert_eq!(
                    replay.screen().state_formatted(),
                    continuous.screen().state_formatted(),
                    "cut={cut} {input:?}"
                );
                assert_eq!(
                    replay.screen().cursor_position(),
                    continuous.screen().cursor_position()
                );
                assert_eq!(
                    replay.callbacks(),
                    continuous.callbacks(),
                    "cut={cut} {input:?}"
                );
            }
            assert_eq!(
                live.screen().state_formatted(),
                before.screen().state_formatted()
            );
            assert_eq!(live.callbacks(), before.callbacks());
            observe(&mut live, &input[cut..]);
            assert_eq!(live.callbacks(), continuous.callbacks());
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
struct Controls {
    writes: Writes,
    controls: Vec<(usize, u8, (u16, u16))>,
}

impl vt100::Callbacks for Controls {
    fn text(&mut self, screen: &mut vt100::Screen, c: char) {
        self.writes.text(screen, c);
    }

    fn control(&mut self, screen: &mut vt100::Screen, byte: u8) {
        self.controls
            .push((self.writes.after, byte, screen.cursor_position()));
    }

    fn set_window_title(&mut self, screen: &mut vt100::Screen, title: &[u8]) {
        self.writes.set_window_title(screen, title);
    }
}

fn observe_controls(parser: &mut vt100::Parser<Controls>, bytes: &[u8]) {
    for byte in bytes {
        parser.callbacks_mut().writes.after += 1;
        parser.process(std::slice::from_ref(byte));
    }
}

fn history(screen: &vt100::Screen) -> Vec<Vec<u8>> {
    let mut screen = screen.clone();
    screen.set_scrollback(usize::MAX);
    (0..=screen.scrollback())
        .map(|offset| {
            screen.set_scrollback(offset);
            screen.state_formatted()
        })
        .collect()
}

#[test]
fn x14_library_reports_executed_controls_at_raw_offsets() {
    let mut ground = vt100::Parser::new_with_callbacks(2, 16, 2, Controls::default());
    observe_controls(&mut ground, b"\n\n\n\n\n\n\n\n");
    ground.callbacks_mut().controls.clear();
    let mut osc = ground.clone();
    observe_controls(&mut osc, b"\x1b]2;pending");
    let before = history(ground.screen());
    assert_eq!(before.len(), 3); // Two retained rows plus the live view.
    assert_eq!(before, history(osc.screen()));
    observe_controls(&mut ground, b"\n");
    observe_controls(&mut osc, b"\n");
    assert_eq!(before, history(ground.screen()));
    assert_eq!(before, history(osc.screen()));
    assert_eq!(ground.screen().cursor_position(), (1, 0));
    assert_eq!(osc.screen().cursor_position(), (1, 0));
    assert_eq!(ground.callbacks().controls, [(9, 10, (1, 0))]);
    assert!(osc.callbacks().controls.is_empty());
    assert!(ground.callbacks().writes.text.is_empty());
    assert!(osc.callbacks().writes.text.is_empty());

    // Identical bytes execute only outside OSC, including non-LF line controls.
    observe_controls(&mut ground, b"\r\t\x08\x0b\x0cC\x1b[C");
    observe_controls(&mut osc, b"\r\t\x08\x0b\x0cC");
    assert_eq!(
        ground.callbacks().controls,
        [
            (9, 10, (1, 0)),
            (10, 13, (1, 0)),
            (11, 9, (1, 8)),
            (12, 8, (1, 7)),
            (13, 11, (1, 7)),
            (14, 12, (1, 7)),
        ]
    );
    assert_eq!(ground.callbacks().writes.text, [(15, 'C', (1, 8))]);
    assert!(osc.callbacks().controls.is_empty());
    assert!(osc.callbacks().writes.text.is_empty());
}

#[test]
fn x14_library_control_observation_survives_checkpoint_replay() {
    let input = "A\r\n\t\x08é\x1b[2DC\x1b]2;hide\n\r\t\x08\x1b\\Z\r\n".as_bytes();
    let mut continuous = vt100::Parser::new_with_callbacks(3, 16, 2, Controls::default());
    observe_controls(&mut continuous, input);
    assert_eq!(
        continuous.callbacks().controls,
        [
            (2, 13, (0, 0)),
            (3, 10, (1, 0)),
            (4, 9, (1, 8)),
            (5, 8, (1, 7)),
            (28, 13, (1, 0)),
            (29, 10, (2, 0)),
        ]
    );
    assert_eq!(
        continuous.callbacks().writes.text,
        [
            (1, 'A', (0, 1)),
            (7, 'é', (1, 8)),
            (12, 'C', (1, 7)),
            (27, 'Z', (1, 8)),
        ]
    );
    assert_eq!(continuous.callbacks().writes.titles, [b"hide".to_vec()]);
    // Every cut includes CSI/OSC/UTF-8 pending state and the CRLF boundary.
    for cut in 0..=input.len() {
        let mut live = vt100::Parser::new_with_callbacks(3, 16, 2, Controls::default());
        observe_controls(&mut live, &input[..cut]);
        let checkpoint = live.clone();
        let before_history = history(live.screen());
        let before_cursor = live.screen().cursor_position();
        let before_callbacks = live.callbacks().clone();
        for _ in 0..3 {
            let mut replay = checkpoint.clone();
            observe_controls(&mut replay, &input[cut..]);
            assert_eq!(replay.callbacks(), continuous.callbacks(), "cut={cut}");
            assert_eq!(history(replay.screen()), history(continuous.screen()));
            assert_eq!(
                replay.screen().cursor_position(),
                continuous.screen().cursor_position()
            );
        }
        assert_eq!(history(live.screen()), before_history, "live cut={cut}");
        assert_eq!(live.screen().cursor_position(), before_cursor);
        assert_eq!(live.callbacks(), &before_callbacks);
        observe_controls(&mut live, &input[cut..]);
        assert_eq!(live.callbacks(), continuous.callbacks(), "live cut={cut}");
    }

    // Batch delivery uses the same execution path; offsets are caller bookkeeping.
    let mut batched = vt100::Parser::new_with_callbacks(3, 16, 2, Controls::default());
    batched.process(input);
    assert_eq!(
        batched
            .callbacks()
            .controls
            .iter()
            .map(|(_, b, pos)| (*b, *pos))
            .collect::<Vec<_>>(),
        continuous
            .callbacks()
            .controls
            .iter()
            .map(|(_, b, pos)| (*b, *pos))
            .collect::<Vec<_>>()
    );
    assert_eq!(history(batched.screen()), history(continuous.screen()));
}
