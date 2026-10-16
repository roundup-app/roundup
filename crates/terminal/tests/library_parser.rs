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
        (b"old\rnew\x1b[K\xff!".as_slice(), "new!"),
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
