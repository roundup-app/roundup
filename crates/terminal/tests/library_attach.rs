//! X14 library capability only; production snapshot integration remains separate.
#[derive(Default, Debug, PartialEq)]
struct Titles(Vec<Vec<u8>>, usize, usize);
impl vt100::Callbacks for Titles {
    fn text(&mut self, _: &mut vt100::Screen, _: char) {
        self.1 += 1;
    }
    fn control(&mut self, _: &mut vt100::Screen, _: u8) {
        self.2 += 1;
    }

    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.0.push(title.to_vec());
    }
}

#[test]
fn x14_library_attach_restores_pending_state() {
    for (input, expected) in [
        (b"abc\x1b[2D@".as_slice(), "a@c"),
        (b"abc\x1b[2D\r\x1b[KZ".as_slice(), "Z"),
        (b"abc\x1b[1;2H@".as_slice(), "a@c"),
        (b"abc\x1b[?25l\x1b[2D@".as_slice(), "a@c"),
        (b"abc\x1b[1:2:3m\x1b[2D@".as_slice(), "a@c"),
        (b"abc\x1b[ 0D@".as_slice(), "abc@"),
        (b"abc\x1b[   D@".as_slice(), "abc@"),
        (b"\x1b]2;a;b;c\x07visible".as_slice(), "visible"),
        (b"\x1b]2;privatehidden\x07visible".as_slice(), "visible"),
        (b"\x1b]2;privatehidden\x1b\\visible".as_slice(), "visible"),
        ("é🦀".as_bytes(), "é🦀"),
        (b"old\rnew\x1b[K\xff!".as_slice(), "new�!"),
        (b"a\xc3Z\xe2\x82!".as_slice(), "a�Z�!"),
        (b"a\xc3\x1b[2DX".as_slice(), "X�"),
        (b"abc\x1b[99999999999999999999D@".as_slice(), "@bc"),
        (
            b"abc\x1b[0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0D@"
                .as_slice(),
            "ab@",
        ),
        (b"abc\x1b[00000000000000000000002D@".as_slice(), "a@c"),
    ] {
        let mut continuous = vt100::Parser::new(3, 80, 0);
        continuous.process(input);
        assert_eq!(continuous.screen().contents(), expected);
        for cut in 0..=input.len() {
            let mut live = vt100::Parser::new_with_callbacks(3, 80, 0, Titles::default());
            live.process(&input[..cut]);
            let before = live.screen().state_formatted();
            let callbacks = (
                live.callbacks().0.clone(),
                live.callbacks().1,
                live.callbacks().2,
            );
            {
                // One restore proves replay and leaves the source unchanged; repeating
                // the same restore from the same source adds no failure detection.
                let pending = live.pending_formatted();
                let mut restored = vt100::Parser::new(3, 80, 0);
                restored.process(&before);
                restored.process(&pending);
                restored.process(&input[cut..]);
                assert_eq!(
                    restored.screen().contents(),
                    expected,
                    "cut={cut} input={input:?}"
                );
                assert_eq!(
                    restored.screen().cursor_position(),
                    continuous.screen().cursor_position()
                );
                assert_eq!(
                    restored.screen().state_formatted(),
                    continuous.screen().state_formatted()
                );
            }
            assert_eq!(live.screen().state_formatted(), before);
            assert_eq!(
                (
                    live.callbacks().0.clone(),
                    live.callbacks().1,
                    live.callbacks().2
                ),
                callbacks
            );
            live.process(&input[cut..]);
            assert_eq!(live.screen().contents(), expected);
        }
    }
}

#[test]
fn x14_library_attach_state_is_bounded() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("ROUNDUP_ATTACH_CHILD").is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "x14_library_attach_state_is_bounded",
                "--nocapture",
            ])
            .env("ROUNDUP_ATTACH_CHILD", "1")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        print!("{}", String::from_utf8_lossy(&output.stdout));
        return;
    }
    #[cfg(target_os = "linux")]
    fn rss() -> usize {
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
    #[cfg(target_os = "linux")]
    let mut first_rss = 0;

    let storage = std::mem::size_of::<vt100::Parser<Titles>>();
    for end in [b"\x07".as_slice(), b"\x1b\\".as_slice()] {
        let mut live = vt100::Parser::new_with_callbacks(3, 80, 0, Titles::default());
        live.process(b"\x1b]2;");
        let chunk = [b'x'; 8192];
        let mut first = Vec::new();
        for count in 1..=8192 {
            live.process(&chunk);
            if count == 128 || count == 8192 {
                let pending = live.pending_formatted();
                #[cfg(target_os = "linux")]
                {
                    let current = rss();
                    if count == 128 {
                        first_rss = current;
                    }
                    assert!(
                        current <= first_rss + 1024,
                        "RSS {current} > {first_rss} + 1024 KiB"
                    );
                }
                assert!(pending.len() <= 1042);
                if count == 128 {
                    first = pending.clone();
                } else {
                    assert_eq!(pending, first);
                }
                let mut restored = vt100::Parser::new_with_callbacks(3, 80, 0, Titles::default());
                restored.process(&live.screen().state_formatted());
                restored.process(&pending);
                assert!(restored.callbacks().0.is_empty());
                restored.process(b"hidden");
                restored.process(end);
                restored.process(b"visible\x1b]2;short\x07");
                assert_eq!(restored.screen().contents(), "visible");
                assert_eq!(
                    restored.callbacks().0,
                    [vec![b'x'; 1023], b"short".to_vec()]
                );
                println!(
                    "payload={} retained_parser={} representation={}",
                    count * 8192,
                    storage,
                    pending.len()
                );
            }
        }
        assert!(live.screen().contents().is_empty());
        assert!(live.callbacks().0.is_empty());
        live.process(end);
        live.process(b"visible");
        assert_eq!(live.screen().contents(), "visible");
        assert_eq!(live.callbacks().0, [vec![b'x'; 1023]]);
    }
}

#[test]
fn x14_library_screen_restore_preserves_saved_cursor_and_margins() {
    let last_column = [vec![b'a'; 80], b"\x1b7\r".to_vec()].concat();
    let wrapped = format!("{}X", "a".repeat(80));
    for (prefix, suffix, expected, cursor) in [
        (
            b"abc\x1b7\r".as_slice(),
            b"\x1b8X".as_slice(),
            "abcX",
            (0, 4),
        ),
        (last_column.as_slice(), b"\x1b8X", wrapped.as_str(), (1, 1)),
        (b"\x1b[2;3r\x1b[3;1H", b"A\r\nB", "\nA\nB", (2, 1)),
        (b"\x1b[r\x1b[3;1H", b"A\r\nB", "\n\nA\nB", (3, 1)),
        (b"\x1b[1;31mabc\x1b7\x1b[m\r", b"\x1b8X", "abcX", (0, 4)),
        (
            b"\x1b[2;3r\x1b[?6h\x1b[2;1H\x1b7\x1b[?6l",
            b"\x1b8A\r\nB",
            "\nA\nB",
            (2, 1),
        ),
        (
            b"\x1b[2;3r\x1b[?6h\x1b[2;1H\x1b7\x1b[?6l\x1b[r",
            b"\x1b8A\r\nB",
            "\n\nA\nB",
            (3, 1),
        ),
    ] {
        let input = [prefix, suffix].concat();
        let mut continuous = vt100::Parser::new(4, 80, 8);
        continuous.process(&input);
        assert_eq!(continuous.screen().contents(), expected);
        assert_eq!(continuous.screen().cursor_position(), cursor);
        if prefix.starts_with(b"\x1b[1;31m") {
            let cell = continuous.screen().cell(0, 3).unwrap();
            assert!(cell.bold());
            assert_eq!(cell.fgcolor(), vt100::Color::Idx(1));
        }
        for cut in 0..=input.len() {
            let mut live = vt100::Parser::new_with_callbacks(4, 80, 8, Titles::default());
            live.process(&input[..cut]);
            let before = live.screen().state_formatted();
            let pending = live.pending_formatted();
            let callbacks = (
                live.callbacks().0.clone(),
                live.callbacks().1,
                live.callbacks().2,
            );
            if cut == prefix.len() {
                assert!(pending.is_empty());
            }
            {
                // One restore proves replay and leaves the source unchanged; repeating
                // the same restore from the same source adds no failure detection.
                let mut restored = vt100::Parser::new(4, 80, 8);
                restored.process(&live.screen().state_formatted());
                restored.process(&live.pending_formatted());
                restored.process(&input[cut..]);
                assert_eq!(
                    restored.screen().contents(),
                    expected,
                    "cut={cut} input={input:?}"
                );
                assert_eq!(restored.screen().cursor_position(), cursor);
                assert_eq!(
                    restored.screen().state_formatted(),
                    continuous.screen().state_formatted()
                );
                // Movement/erase and a second restore expose latent saved state,
                // rather than only the pixels immediately after attach.
                let later = b"\x1b8\x1b[2DX\x1b[K\r\nZ";
                let mut continued = continuous.clone();
                continued.process(later);
                restored.process(later);
                assert_eq!(restored.screen().contents(), continued.screen().contents());
                assert_eq!(
                    restored.screen().state_formatted(),
                    continued.screen().state_formatted()
                );
            }
            assert_eq!(live.screen().state_formatted(), before);
            assert_eq!(live.pending_formatted(), pending);
            assert_eq!(
                (
                    live.callbacks().0.clone(),
                    live.callbacks().1,
                    live.callbacks().2
                ),
                callbacks
            );
            live.process(&input[cut..]);
            assert_eq!(
                live.screen().state_formatted(),
                continuous.screen().state_formatted()
            );
        }
    }
}

#[test]
fn x14_library_screen_restore_state_is_bounded() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("ROUNDUP_SCREEN_RESTORE_CHILD").is_none() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "x14_library_screen_restore_state_is_bounded",
                "--nocapture",
            ])
            .env("ROUNDUP_SCREEN_RESTORE_CHILD", "1")
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        print!("{}", String::from_utf8_lossy(&output.stdout));
        return;
    }
    #[cfg(target_os = "linux")]
    fn rss() -> usize {
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
    for (rows, cols, history) in [(4, 80, 8), (12, 40, 16)] {
        let mut live = vt100::Parser::new(rows, cols, history);
        // Fill the configured history before installing restricted margins.
        live.process(&b"old\r\n".repeat(history + usize::from(rows)));
        live.process(b"\x1b[1;31m\x1b[2;3H\x1b7\x1b[m\x1b[2;3r");
        let chunk = b"flood!\r\n".repeat(1024);
        let mut first = Vec::new();
        #[cfg(target_os = "linux")]
        let mut first_rss = 0;
        for count in 1..=8192 {
            live.process(&chunk);
            if count != 128 && count != 8192 {
                continue;
            }
            let screen = live.screen().state_formatted();
            let pending = live.pending_formatted();
            assert!(screen.len() <= usize::from(rows) * usize::from(cols) * 128 + 512);
            assert!(pending.len() <= 1280);
            #[cfg(target_os = "linux")]
            {
                let current = rss();
                if count == 128 {
                    first_rss = current;
                }
                assert!(
                    current <= first_rss + 1024,
                    "RSS {current} > {first_rss} + 1024 KiB"
                );
                println!(
                    "bytes={} rss_kib={current} screen={} pending={}",
                    count * chunk.len(),
                    screen.len(),
                    pending.len()
                );
            }
            if count == 128 {
                first = screen.clone();
            } else {
                assert_eq!(screen, first);
            }
            let mut restored = vt100::Parser::new(rows, cols, history);
            restored.process(&screen);
            restored.process(&pending);
            let suffix = b"\x1b8X";
            restored.process(suffix);
            let mut continuous = live.clone();
            continuous.process(suffix);
            assert_eq!(restored.screen().contents(), continuous.screen().contents());
            assert_eq!(restored.screen().cursor_position(), (1, 3));
            assert_eq!(restored.screen().cell(1, 2).unwrap().contents(), "X");
            assert!(restored.screen().cell(1, 2).unwrap().bold());
            assert_eq!(
                restored.screen().cell(1, 2).unwrap().fgcolor(),
                vt100::Color::Idx(1)
            );
            assert_eq!(
                restored.screen().state_formatted(),
                continuous.screen().state_formatted()
            );
            assert_eq!(live.screen().state_formatted(), screen);
        }
    }
}
