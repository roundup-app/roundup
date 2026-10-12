use contracts::common::ActorKind;
use contracts::decision::Decision;
use contracts::message::{Message, MessageKind, MessageStatus, Reason};
use contracts::todo::Todo;
use contracts::{Actor, Event, EventData};
use serde_json::json;
use ts_rs::TS;

#[test]
fn r16_large_event_payloads_keep_the_exact_wire_envelope() {
    let todo = Todo {
        id: 7,
        title: "title".into(),
        body: "body".into(),
        done: true,
        blockers: vec![2, 3],
        blocked: true,
        created_at: 123,
        creator: Actor {
            kind: ActorKind::Agent,
            id: "a1".into(),
            parent: Some("door".into()),
        },
        home: Some("w1".into()),
    };
    let todo_wire = json!({"id":7,"title":"title","body":"body","done":true,"blockers":[2,3],"blocked":true,"created_at":123,"creator":{"kind":"agent","id":"a1","parent":"door"},"home":"w1"});
    let message = Message {
        id: 9,
        from: Actor::user(),
        to: "a1".into(),
        kind: MessageKind::Question,
        body: "question".into(),
        reply_to: Some(4),
        status: MessageStatus::Held,
        reason: Some(Reason::Escalated),
        passed_from: Some(8),
        at: 456,
        iteration: Some(2),
    };
    let message_wire = json!({"id":9,"from":{"kind":"user","id":"you","parent":null},"to":"a1","kind":"question","body":"question","replyTo":4,"status":"held","reason":"escalated","passedFrom":8,"at":456,"iteration":2});
    let decision = Decision {
        id: "d1".into(),
        agent: "a1".into(),
        tool: "Bash".into(),
        args: "echo hi".into(),
        opened_at: 789,
        answerable: true,
    };
    let decision_wire = json!({"id":"d1","agent":"a1","tool":"Bash","args":"echo hi","opened_at":789,"answerable":true});
    let cases = [
        (
            "todo.created",
            EventData::TodoCreated(todo.clone().into()),
            todo_wire.clone(),
        ),
        (
            "todo.updated",
            EventData::TodoUpdated(todo.into()),
            todo_wire,
        ),
        (
            "message.sent",
            EventData::MessageSent(message.clone().into()),
            message_wire.clone(),
        ),
        (
            "message.held",
            EventData::MessageHeld(message.clone().into()),
            message_wire.clone(),
        ),
        (
            "message.delivered",
            EventData::MessageDelivered(message.clone().into()),
            message_wire.clone(),
        ),
        (
            "message.dropped",
            EventData::MessageDropped(message.into()),
            message_wire,
        ),
        (
            "decision.opened",
            EventData::DecisionOpened(decision.into()),
            decision_wire,
        ),
    ];
    for (name, data, payload) in cases {
        let expected = json!({"name":name,"data":payload});
        assert_eq!(serde_json::to_value(&data).unwrap(), expected, "{name}");
        let decoded: EventData = serde_json::from_value(expected.clone()).unwrap();
        match (&data, &decoded) {
            (EventData::TodoCreated(a), EventData::TodoCreated(b))
            | (EventData::TodoUpdated(a), EventData::TodoUpdated(b)) => assert_eq!(a, b),
            (EventData::MessageSent(a), EventData::MessageSent(b))
            | (EventData::MessageHeld(a), EventData::MessageHeld(b))
            | (EventData::MessageDelivered(a), EventData::MessageDelivered(b))
            | (EventData::MessageDropped(a), EventData::MessageDropped(b)) => assert_eq!(a, b),
            (EventData::DecisionOpened(a), EventData::DecisionOpened(b)) => assert_eq!(a, b),
            _ => panic!("wrong variant for {name}"),
        }
        let event = Event {
            actor: Actor::user(),
            data,
        };
        let mut envelope = expected;
        envelope["actor"] = json!({"kind":"user","id":"you","parent":null});
        assert_eq!(serde_json::to_value(&event).unwrap(), envelope);
        let decoded: Event = serde_json::from_value(envelope.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), envelope);
    }
}

#[test]
fn r16_event_data_keeps_the_generated_typescript_shape() {
    let committed = include_str!("../../../contracts/generated/EventData.ts");
    assert!(committed.contains(&format!(
        "export {}",
        EventData::decl(&ts_rs::Config::default())
    )));
}
