//! RB21 (`scenarios/readback-stops.md`): the result a readback carries for stepping its diagram. A fake
//! `claude` answers, as in `rb_readback`, whose fixture these tests share.

use serde_json::{Value, json};

use super::rb_readback::{account, answer, rb, with};

/// The fixture's account with `stops`.
fn stopping(stops: Value) -> String {
    with(|value| value["stops"] = stops)
}

#[tokio::test]
async fn rb21_a_read_run_carries_its_stops_in_order_and_an_answer_without_them_has_none() {
    let r = rb(&[answer(&stopping(json!([
        {"part": " a ", "text": " Starts here. "},
        {"part": "b", "text": "Then b."},
    ])))])
    .await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["state"], "read");
    assert_eq!(
        state["stops"],
        json!([{"part": "a", "text": "Starts here."}, {"part": "b", "text": "Then b."}])
    );

    let bare = rb(&[answer(&account())]).await;
    bare.start().await;
    let state = bare.settled().await;
    assert_eq!(state["state"], "read");
    assert_eq!(state["stops"], json!([]));
}

#[tokio::test]
async fn rb21_a_stop_without_a_part_or_text_is_dropped_and_twelve_are_kept() {
    let mut stops = vec![
        json!({"part": "", "text": "No part."}),
        json!({"part": "a", "text": "  "}),
        json!({"text": "No key."}),
    ];
    stops.extend((0..15).map(|n| json!({"part": "a", "text": format!("s{n}")})));
    let r = rb(&[answer(&stopping(json!(stops)))]).await;
    r.start().await;
    let state = r.settled().await;
    assert_eq!(state["state"], "read");
    let texts: Vec<_> = state["stops"]
        .as_array()
        .unwrap()
        .iter()
        .map(|each| each["text"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(texts.len(), 12);
    assert_eq!((texts[0].as_str(), texts[11].as_str()), ("s0", "s11"));
}
