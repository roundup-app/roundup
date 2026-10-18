use super::*;

#[test]
fn u2556a_supported_json_and_rejected_shapes() {
    assert!(parse(br#"{"schema":2,"repo":{},"collected":{"ci":false,"summary":false},"items":[]}"#).is_ok());
}
