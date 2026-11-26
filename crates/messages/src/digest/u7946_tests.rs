use super::tests::{rail, sources};
use super::*;

#[test]
fn u7946b_an_undelivered_prompt_shows_in_the_parents_digest_and_messages() {
    let nodes = rail();
    let mut from = sources(&nodes, &[], &[], &[]);
    let seen = Seen::default();
    let last = |from: &Sources| match &seen.ask(&Actor::user(), "m", from).unwrap().children[0] {
        DigestItem::Child(entry) => entry.last.clone(),
        DigestItem::More { .. } => unreachable!("one child"),
    };
    assert!(!last(&from).starts_with("prompt not delivered"));
    from.undelivered.insert("a".into(), "no receipt".into());
    assert_eq!(last(&from), "prompt not delivered: no receipt");
}
