use contracts::common::ActorKind;
use contracts::message::{Message, MessageKind, MessageStatus, Reason};
use contracts::todo::Todo;
use contracts::{Actor, Event, EventData};
use serde_json::json;

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
        updated_at: 123,
        creator: Actor {
            kind: ActorKind::Agent,
            id: "a1".into(),
            parent: Some("door".into()),
        },
        home: Some("w1".into()),
        owner: None,
        refs: vec![],
    };
    let todo_wire = json!({"id":7,"title":"title","body":"body","done":true,"blockers":[2,3],"blocked":true,"created_at":123,"updated_at":123,"creator":{"kind":"agent","id":"a1","parent":"door"},"home":"w1","owner":null,"refs":[]});
    let message = Message {
        id: 9,
        from: todo.creator.clone(),
        to: "a1".into(),
        kind: MessageKind::Question,
        body: "question".into(),
        reply_to: Some(4),
        status: MessageStatus::Dropped,
        reason: Some(Reason::NotAccepted),
        at: 456,
    };
    let message_wire = json!({"id":9,"from":{"kind":"agent","id":"a1","parent":"door"},"to":"a1","kind":"question","body":"question","replyTo":4,"status":"dropped","reason":"not accepted","at":456});
    let status = contracts::agent::StatusEvent {
        ended: true,
        id: "a1".into(),
        attempt: "2".into(),
        status_revision: "3".into(),
        status: contracts::common::Status {
            kind: contracts::common::Kind::Working,
            label: "building".into(),
            since: 123,
            finished: "0".into(),
        },
    };
    let cases = [
        (
            "agent.status",
            EventData::AgentStatus(status.into()),
            json!({"id":"a1","attempt":"2","status_revision":"3","ended":true,"status":{"kind":"working","label":"building","since":123,"finished":"0"}}),
        ),
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
            "message.delivered",
            EventData::MessageDelivered(message.clone().into()),
            message_wire.clone(),
        ),
        (
            "message.dropped",
            EventData::MessageDropped(message.into()),
            message_wire,
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
            | (EventData::MessageDelivered(a), EventData::MessageDelivered(b))
            | (EventData::MessageDropped(a), EventData::MessageDropped(b)) => assert_eq!(a, b),
            (EventData::AgentStatus(a), EventData::AgentStatus(b)) => {
                assert_eq!(a.id, b.id);
                assert_eq!(a.attempt, b.attempt);
                assert_eq!(a.status_revision, b.status_revision);
                assert_eq!(a.status, b.status);
            }
            _ => panic!("wrong variant for {name}"),
        }
        let event = Event {
            seq: None,
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
    assert!(committed.contains(&contracts::export::event_data_declaration().unwrap().0));
}

#[test]
fn a34_pad_deleted_round_trips_the_pad_name() {
    let wire = json!({"name":"pad.deleted","data":{"name":"plan"}});
    let decoded: EventData = serde_json::from_value(wire.clone()).unwrap();
    assert!(
        matches!(&decoded, EventData::PadDeleted(contracts::pad::PadName { name }) if name == "plan")
    );
    assert_eq!(serde_json::to_value(decoded).unwrap(), wire);
}

#[test]
fn a34_pad_deleted_is_in_generated_typescript() {
    assert!(
        include_str!("../../../contracts/generated/EventData.ts")
            .contains("{ \"name\": \"pad.deleted\", \"data\": PadName }")
    );
}

#[test]
fn t30_a_todo_json_without_updated_at_stays_valid() {
    let old = json!({"id":7,"title":"t","body":"","done":false,"blockers":[],"blocked":false,"created_at":5,"creator":{"kind":"user","id":"you","parent":null},"home":null,"owner":null});
    let todo: contracts::todo::Todo = serde_json::from_value(old).unwrap();
    assert_eq!(todo.updated_at, 0);
}
