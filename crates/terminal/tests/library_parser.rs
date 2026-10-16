//! Library-only prerequisites for X14; these do not exercise selected output streams.

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
    let mut parser = vt100::Parser::new(3, 80, 0);
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
    parser.process(b"hidden\x07visible");
    let completed = rss_kib();
    println!("1MiB={one_mib}KiB 64MiB={sixty_four_mib}KiB terminated={completed}KiB");
    // Isolated process; 1 MiB allowance covers RSS page/accounting noise, not payload.
    assert!(sixty_four_mib <= one_mib + 1024);
    assert!(completed <= one_mib + 1024);
    assert_eq!(parser.screen().contents(), "visible");
    parser.process(b"\x1b]2;short\x1b\\later");
    assert_eq!(parser.screen().contents(), "visiblelater");
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
