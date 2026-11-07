use super::*;
use contracts::{Actor, ActorKind, Verb};

fn agent(id: &str) -> Actor {
    Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    }
}

#[test]
fn history_lists_touches_of_one_item_oldest_first() {
    let log = Touches::in_memory().unwrap();
    log.record(&Actor::user(), Verb::Wrote, "todo:5").unwrap();
    log.record(&agent("a"), Verb::Read, "todo:5").unwrap();
    log.record(&agent("a"), Verb::Wrote, "pad:notes").unwrap();

    let history = log.history("todo:5").unwrap();

    assert_eq!(history.len(), 2);
    assert_eq!(history[0].actor, Actor::user());
    assert_eq!(history[1].verb, Verb::Read);
}

#[test]
fn touched_lists_everything_one_actor_did() {
    let log = Touches::in_memory().unwrap();
    log.record(&agent("a"), Verb::Read, "todo:5").unwrap();
    log.record(&agent("b"), Verb::Read, "todo:5").unwrap();
    log.record(&agent("a"), Verb::Wrote, "pad:notes").unwrap();

    assert_eq!(log.touched("a").unwrap().len(), 2);
}

#[test]
fn b11_an_unknown_stored_kind_or_verb_fails_the_read() {
    for (kind, verb) in [("robot", "wrote"), ("user", "deleted")] {
        let touches = Touches::in_memory().unwrap();
        touches
            .db
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO touches (actor_kind, actor_id, actor_parent, verb, item, at) VALUES (?1, 'a', NULL, ?2, 'i', 1)",
                [kind, verb],
            )
            .unwrap();
        assert!(touches.history("i").is_err());
        assert!(touches.touched("a").is_err());
    }
}
