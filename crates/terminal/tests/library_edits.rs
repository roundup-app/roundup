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
        assert!(parser.screen_mut().set_cell_source(0, offset - 1, Some(u64::from(offset))));
    }
    parser.process(b"\x1b[H\x1b[P");
    assert_eq!(parser.screen().contents(), "aa");
    assert_eq!(parser.screen().cell(0, 0).unwrap().source(), Some(2));
    assert_eq!(parser.screen().cell(0, 1).unwrap().source(), Some(3));
    assert_eq!(parser.screen().cell(0, 2).unwrap().source(), None);
}
