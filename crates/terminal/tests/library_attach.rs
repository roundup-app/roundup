//! X14 library capability only; production snapshot integration remains separate.
#[derive(Default, Debug, PartialEq)]
struct Titles(Vec<Vec<u8>>);
impl vt100::Callbacks for Titles {
    fn set_window_title(&mut self, _: &mut vt100::Screen, title: &[u8]) {
        self.0.push(title.to_vec());
    }
}

#[test]
fn x14_library_attach_restores_pending_state() {
    for (input, expected) in [
        (b"abc\x1b[2D@".as_slice(), "a@c"),
        (b"\x1b]2;privatehidden\x07visible".as_slice(), "visible"),
        (b"\x1b]2;privatehidden\x1b\\visible".as_slice(), "visible"),
        ("é🦀".as_bytes(), "é🦀"),
        (b"old\rnew\x1b[K\xff!".as_slice(), "new�!"),
        (b"a\xc3Z\xe2\x82!".as_slice(), "a�Z�!"),
        (b"abc\x1b[00000000000000000000002D@".as_slice(), "a@c"),
    ] {
        let mut continuous = vt100::Parser::new(3, 80, 0);
        continuous.process(input);
        assert_eq!(continuous.screen().contents(), expected);
        for cut in 0..=input.len() {
            let mut live = vt100::Parser::new_with_callbacks(3, 80, 0, Titles::default());
            live.process(&input[..cut]);
            let before = live.screen().state_formatted();
            let titles = live.callbacks().0.clone();
            for _ in 0..3 {
                let pending = live.pending_formatted();
                let mut restored = vt100::Parser::new(3, 80, 0);
                restored.process(&before);
                restored.process(&pending);
                restored.process(&input[cut..]);
                assert_eq!(restored.screen().contents(), expected, "cut={cut} input={input:?}");
                assert_eq!(restored.screen().cursor_position(), continuous.screen().cursor_position());
                assert_eq!(restored.screen().state_formatted(), continuous.screen().state_formatted());
            }
            assert_eq!(live.screen().state_formatted(), before);
            assert_eq!(live.callbacks().0, titles);
            live.process(&input[cut..]);
            assert_eq!(live.screen().contents(), expected);
        }
    }
}

#[test]
fn x14_library_attach_state_is_bounded() {
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
                assert!(pending.len() <= 1042);
                assert_eq!(std::mem::size_of_val(&live), storage);
                if count == 128 { first = pending.clone(); } else { assert_eq!(pending, first); }
                let mut restored = vt100::Parser::new_with_callbacks(3, 80, 0, Titles::default());
                restored.process(&live.screen().state_formatted());
                restored.process(&pending);
                assert!(restored.callbacks().0.is_empty());
                restored.process(b"hidden");
                restored.process(end);
                restored.process(b"visible\x1b]2;short\x07");
                assert_eq!(restored.screen().contents(), "visible");
                assert_eq!(restored.callbacks().0, [vec![b'x'; 1023], b"short".to_vec()]);
                println!("payload={} retained_parser={} representation={}", count * 8192, storage, pending.len());
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
