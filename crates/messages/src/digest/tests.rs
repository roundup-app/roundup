use super::*;
use contracts::message::{MessageKind, MessageStatus};
use contracts::{Kind, Status};

fn status(kind: Kind, label: &str) -> Status {
    Status {
        kind,
        label: label.into(),
        since: 0,
        finished: "0".into(),
    }
}

fn node(id: &str, kind: NodeKind, parent: Option<&str>, label: &str) -> RailNode {
    RailNode {
        name: format!("{id}-name"),
        parent: parent.map(Into::into),
        status: Some(status(Kind::Working, label)),
        status_revision: None,
        ..crate::tests::node(id, kind, false, None)
    }
}

fn todo(id: u32, creator: &str, done: bool) -> Todo {
    let creator = serde_json::json!({"kind": "agent", "id": creator, "parent": null});
    serde_json::from_value(serde_json::json!({
        "id": id, "title": format!("todo {id}"), "body": "", "done": done, "blockers": [],
        "blocked": false, "created_at": 0, "updated_at": 0, "creator": creator, "home": "m", "owner": null,
    }))
    .unwrap()
}

fn pad(name: &str, home: &str, at: i64) -> Pad {
    Pad {
        incarnation: "1".into(),
        name: name.into(),
        text: "ZEBRA".into(),
        updated_at: at,
        revision: 1,
        home: Some(home.into()),
    }
}

fn sent(id: u32, from: &str, to: &str, body: &str) -> Message {
    Message {
        id,
        from: Actor {
            kind: ActorKind::Agent,
            id: from.into(),
            parent: None,
        },
        to: to.into(),
        kind: MessageKind::Note,
        body: body.into(),
        reply_to: None,
        status: MessageStatus::Delivered,
        reason: None,
        at: id.into(),
    }
}

fn rail() -> Vec<RailNode> {
    vec![
        node("m", NodeKind::Workstream, None, "coordinating"),
        node("a", NodeKind::Agent, Some("m"), "reading"),
        node("b", NodeKind::Agent, Some("m"), "testing"),
    ]
}

fn ask(
    seen: &Seen,
    nodes: &[RailNode],
    todos: &[Todo],
    pads: &[Pad],
    messages: &[Message],
) -> Vec<DigestItem> {
    let from = Sources {
        completed: std::collections::HashMap::new(),
        touches: pads
            .iter()
            .map(|pad| contracts::Touch {
                actor: Actor {
                    kind: ActorKind::Agent,
                    id: pad.home.clone().unwrap(),
                    parent: None,
                },
                verb: contracts::Verb::Wrote,
                item: format!("pad:{}", pad.name),
                at: pad.updated_at,
            })
            .collect(),
        nodes,
        todos,
        pads,
        messages,
    };
    let m = Actor {
        kind: ActorKind::Agent,
        id: "m".into(),
        parent: None,
    };
    seen.ask(&m, "m", &from).unwrap().children
}

fn entries(items: &[DigestItem]) -> Vec<&DigestEntry> {
    items
        .iter()
        .filter_map(|item| match item {
            DigestItem::Child(entry) => Some(entry),
            DigestItem::More { .. } => None,
        })
        .collect()
}

#[test]
fn b19_the_envelope_has_exactly_five_fields_and_leaves_out_terminal_output() {
    let items = ask(&Seen::default(), &rail(), &[], &[pad("notes", "a", 5)], &[]);
    let json = serde_json::to_value(&items[0]).unwrap();
    let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["kind", "last", "name", "pads", "todos"]);
    assert!(!json.to_string().contains("ZEBRA"));
    assert_eq!(items.len(), 2, "a Terminal child has no entry");
}

#[test]
fn b19_last_is_the_first_line_of_the_newest_message_to_m_else_the_status_label() {
    let told = [
        sent(1, "a", "m", "old\nline"),
        sent(3, "a", "m", "newest first line\nsecond"),
        sent(2, "a", "other", "elsewhere"),
        sent(4, "b", "a", "not to m"),
    ];
    let items = ask(&Seen::default(), &rail(), &[], &[], &told);
    let items = entries(&items);
    assert_eq!(items[0].last, "newest first line");
    assert_eq!(items[1].last, "testing");
    assert_eq!(items[1].kind, Kind::Working);
}

#[test]
fn b19_last_is_cut_at_120_bytes_ending_in_cut() {
    let long = "é".repeat(100);
    let items = ask(
        &Seen::default(),
        &rail(),
        &[],
        &[],
        &[sent(1, "a", "m", &long)],
    );
    let last = &entries(&items)[0].last;
    assert!(last.len() <= 120 && last.ends_with("[cut]"));
    assert!(long.starts_with(last.trim_end_matches("[cut]")));
}

#[test]
fn b19_todos_counts_only_open_todos_created_by_the_agent() {
    let mut todos = vec![
        todo(1, "a", false),
        todo(2, "a", false),
        todo(3, "a", true),
        todo(4, "b", false),
        todo(5, "other", false),
    ];
    for kind in [ActorKind::User, ActorKind::Ext] {
        let mut other = todo(6, "a", false);
        other.creator.kind = kind;
        todos.push(other);
    }
    let items = ask(&Seen::default(), &rail(), &todos, &[], &[]);
    let counts: Vec<_> = entries(&items).iter().map(|e| e.todos).collect();
    assert_eq!(counts, [2, 1]);
}

#[test]
fn b19_completing_a_created_todo_reduces_the_count() {
    let mut todos = [todo(1, "a", false), todo(2, "a", false)];
    todos[0].done = true;
    let items = ask(&Seen::default(), &rail(), &todos, &[], &[]);
    assert_eq!(entries(&items)[0].todos, 1);
}

#[test]
fn b19_home_changes_keep_creator_attribution_until_completion() {
    for home in [Some("other-workstream"), None] {
        for done in [false, true] {
            let mut moved = todo(1, "a", done);
            moved.home = home.map(Into::into);
            let items = ask(&Seen::default(), &rail(), &[moved], &[], &[]);
            assert_eq!(entries(&items)[0].todos, if done { 0 } else { 1 });
        }
    }
}

#[test]
fn b19_pads_name_only_pads_written_since_the_previous_envelope() {
    let seen = Seen::default();
    let first = ask(
        &seen,
        &rail(),
        &[],
        &[pad("one", "a", 10), pad("x", "b", 11)],
        &[],
    );
    assert_eq!(entries(&first)[0].pads, ["one"]);
    let pads = [pad("one", "a", 10), pad("two", "a", 20), pad("x", "b", 11)];
    let second = ask(&seen, &rail(), &[], &pads, &[]);
    assert_eq!(entries(&second)[0].pads, ["two"]);
    assert!(entries(&second)[1].pads.is_empty());
}

#[test]
fn b19_the_user_asking_does_not_hide_pads_from_m() {
    let seen = Seen::default();
    let pads = [pad("one", "a", 10)];
    let from = Sources {
        completed: std::collections::HashMap::new(),
        touches: pads
            .iter()
            .map(|pad| contracts::Touch {
                actor: Actor {
                    kind: ActorKind::Agent,
                    id: pad.home.clone().unwrap(),
                    parent: None,
                },
                verb: contracts::Verb::Wrote,
                item: format!("pad:{}", pad.name),
                at: pad.updated_at,
            })
            .collect(),
        nodes: &rail(),
        todos: &[],
        pads: &pads,
        messages: &[],
    };
    let m = Actor {
        kind: ActorKind::Agent,
        id: "m".into(),
        parent: None,
    };
    let pads_of = |caller: &Actor| match &seen.ask(caller, "m", &from).unwrap().children[0] {
        DigestItem::Child(entry) => entry.pads.clone(),
        DigestItem::More { .. } => unreachable!(),
    };
    assert_eq!(pads_of(&Actor::user()), ["one"]);
    assert_eq!(pads_of(&Actor::user()), ["one"]);
    assert_eq!(pads_of(&m), ["one"]);
    assert!(pads_of(&m).is_empty());
}

#[test]
fn b19_five_pads_name_the_newest_four_and_end_in_cut_and_a_long_name_is_cut_at_32() {
    let long = "n".repeat(40);
    let pads = [
        pad("p1", "a", 1),
        pad("p2", "a", 2),
        pad("p3", "a", 3),
        pad("p4", "a", 4),
        pad(&long, "a", 5),
    ];
    let items = ask(&Seen::default(), &rail(), &[], &pads, &[]);
    let names = &entries(&items)[0].pads;
    assert_eq!(names.len(), 5);
    assert_eq!(&names[..3], ["p2", "p3", "p4"]);
    assert!(names[3].len() == 32 && names[3].ends_with("[cut]"));
    assert_eq!(names[4], "[cut]");
}

#[test]
fn b19_the_whole_entry_is_at_most_512_bytes() {
    let mut nodes = rail();
    nodes[1].name = "w".repeat(600);
    let quotes = "\"".repeat(200);
    let pads: Vec<_> = (0..6).map(|n| pad(&"\"".repeat(40), "a", n)).collect();
    let items = ask(
        &Seen::default(),
        &nodes,
        &[],
        &pads,
        &[sent(1, "a", "m", &quotes)],
    );
    for entry in entries(&items) {
        assert!(serde_json::to_string(entry).unwrap().len() <= 512);
    }
}

#[test]
fn b20_children_are_in_rail_order_at_most_20_then_more() {
    let mut nodes = vec![node("m", NodeKind::Workstream, None, "x")];
    nodes.extend((0..23).map(|n| node(&format!("c{n}"), NodeKind::Agent, Some("m"), "x")));
    let items = ask(&Seen::default(), &nodes, &[], &[], &[]);
    assert_eq!(items.len(), 21);
    assert_eq!(entries(&items)[0].name, "c0-name");
    assert_eq!(entries(&items)[19].name, "c19-name");
    assert_eq!(items[20], DigestItem::More { more: 3 });
}

#[test]
fn b20_forbidden_not_found_and_conflict() {
    let nodes = rail();
    let from = Sources {
        completed: std::collections::HashMap::new(),
        touches: Vec::new(),
        nodes: &nodes,
        todos: &[],
        pads: &[],
        messages: &[],
    };
    let seen = Seen::default();
    let agent = |id: &str| Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    };
    let code = |caller: &Actor, id: &str| seen.ask(caller, id, &from).unwrap_err().code;
    assert_eq!(code(&agent("a"), "m"), rpc::code::FORBIDDEN);
    assert_eq!(code(&Actor::daemon(), "m"), rpc::code::FORBIDDEN);
    assert_eq!(code(&Actor::user(), "nobody"), rpc::code::NOT_FOUND);
    assert_eq!(code(&Actor::user(), "t"), rpc::code::NOT_FOUND);
    assert_eq!(code(&Actor::user(), "a"), rpc::code::CONFLICT);
    assert!(seen.ask(&agent("m"), "m", &from).is_ok());
}

#[test]
fn b2705a_digest_errors_use_rail_names() {
    let agent = |id: &str| Actor {
        kind: ActorKind::Agent,
        id: id.into(),
        parent: None,
    };
    for (
        case,
        target_name,
        caller_name,
        target_present,
        caller_present,
        caller,
        target,
        expected_code,
        expected,
    ) in [
        (
            "outside caller",
            "sad",
            "review",
            true,
            true,
            agent("8027"),
            "7013",
            rpc::code::FORBIDDEN,
            "review may not read the digest of sad",
        ),
        (
            "renamed",
            "glad",
            "checked",
            true,
            true,
            agent("8027"),
            "7013",
            rpc::code::FORBIDDEN,
            "checked may not read the digest of glad",
        ),
        (
            "gone target still forbidden",
            "sad",
            "review",
            false,
            true,
            agent("8027"),
            "7013",
            rpc::code::FORBIDDEN,
            "review may not read the digest of an Agent that is gone",
        ),
        (
            "gone caller",
            "sad",
            "review",
            true,
            false,
            agent("8027"),
            "7013",
            rpc::code::FORBIDDEN,
            "an Agent that is gone may not read the digest of sad",
        ),
        (
            "user missing target",
            "sad",
            "review",
            false,
            true,
            Actor::user(),
            "7013",
            rpc::code::NOT_FOUND,
            "not found: an Agent that is gone",
        ),
        (
            "non Door",
            "sad",
            "review",
            true,
            true,
            Actor::user(),
            "8027",
            rpc::code::CONFLICT,
            "review is no Door",
        ),
    ] {
        let mut nodes = Vec::new();
        if target_present {
            let mut target = node("7013", NodeKind::Workstream, None, "working");
            target.name = target_name.into();
            nodes.push(target);
        }
        if caller_present {
            let mut caller = node("8027", NodeKind::Agent, Some("7013"), "working");
            caller.name = caller_name.into();
            nodes.push(caller);
        }
        let from = sources(&nodes, &[], &[], &[]);
        let error = Seen::default().ask(&caller, target, &from).unwrap_err();
        assert_eq!(error.code, expected_code, "{case}");
        assert_eq!(error.message, expected, "{case}");
    }
}

fn sources<'a>(
    nodes: &'a [RailNode],
    todos: &'a [Todo],
    pads: &'a [Pad],
    messages: &'a [Message],
) -> Sources<'a> {
    Sources {
        completed: std::collections::HashMap::new(),
        touches: pads
            .iter()
            .map(|pad| contracts::Touch {
                actor: Actor {
                    kind: ActorKind::Agent,
                    id: pad.home.clone().unwrap(),
                    parent: None,
                },
                verb: contracts::Verb::Wrote,
                item: format!("pad:{}", pad.name),
                at: pad.updated_at,
            })
            .collect(),
        nodes,
        todos,
        pads,
        messages,
    }
}

#[test]
fn b21_only_a_change_to_kind_todos_or_pads_is_pushed_and_once() {
    let seen = Seen::default();
    let mut nodes = rail();
    let none: Vec<Todo> = vec![];
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());

    // A Kind change.
    nodes[1].status = Some(status(Kind::Idle, "done"));
    let pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0].meta, "m");
    assert_eq!(pushes[0].entry.kind, Kind::Idle);
    assert!(push_body(&pushes[0].entry).starts_with("[digest] a-name is "));
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());

    // A label that leaves Kind, Todos and Pads as they were.
    nodes[1].status = Some(status(Kind::Idle, "still done"));
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());

    // A Todo, then a Pad.
    let todos = vec![todo(1, "a", false)];
    let pushes = seen.changed(&sources(&nodes, &todos, &[], &[]));
    assert_eq!(pushes[0].entry.todos, 1);
    let pads = vec![pad("notes", "a", 5)];
    let pushes = seen.changed(&sources(&nodes, &todos, &pads, &[]));
    assert_eq!(pushes[0].entry.pads, ["notes"]);
    assert!(
        seen.changed(&sources(&nodes, &todos, &pads, &[]))
            .is_empty()
    );
}

#[test]
fn b35_ten_idle_working_flips_push_nothing() {
    let seen = Seen::default();
    let mut nodes = rail();
    let none: Vec<Todo> = vec![];
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    for n in 0..10 {
        let kind = if n % 2 == 0 {
            Kind::Idle
        } else {
            Kind::Working
        };
        nodes[1].status = Some(status(kind, "reading"));
        assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
    }
}

#[test]
fn b35_a_flip_pair_between_two_changes_leaves_the_weight_total_exact() {
    let seen = Seen::default();
    let mut nodes = rail();
    let none: Vec<Todo> = vec![];
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    let one = vec![todo(1, "a", false)];
    let two = vec![todo(1, "a", false), todo(2, "a", false)];
    let mut total = 0;
    let mut step = |nodes: &[RailNode], todos: &[Todo], expect: usize| {
        let pushes = seen.changed(&sources(nodes, todos, &[], &[]));
        assert_eq!(pushes.len(), expect);
        total += pushes
            .iter()
            .map(|p| crate::pushes::weight(&push_body(&p.entry)))
            .sum::<u32>();
    };
    step(&nodes, &one, 1);
    nodes[1].status = Some(status(Kind::Idle, "reading"));
    step(&nodes, &one, 0);
    nodes[1].status = Some(status(Kind::Working, "reading"));
    step(&nodes, &one, 0);
    step(&nodes, &two, 1);
    assert_eq!(total, 2);
}

#[test]
fn b35_a_flip_with_a_new_last_line_is_pushed() {
    let seen = Seen::default();
    let mut nodes = rail();
    let none: Vec<Todo> = vec![];
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    nodes[1].status = Some(status(Kind::Idle, "I filed #1077"));
    let pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0].entry.last, "I filed #1077");
}

#[test]
fn b35_entering_each_of_blocked_and_done_is_pushed() {
    for kind in [Kind::Blocked, Kind::Done] {
        let seen = Seen::default();
        let mut nodes = rail();
        let none: Vec<Todo> = vec![];
        seen.baseline(&sources(&nodes, &none, &[], &[]));
        nodes[1].status = Some(status(kind, "reading"));
        assert_eq!(seen.changed(&sources(&nodes, &none, &[], &[])).len(), 1);
    }
}

#[test]
fn b43_other_kind_changes_are_pushed_as_b21_says() {
    for kind in [Kind::Error, Kind::NeedsYou] {
        let seen = Seen::default();
        let mut nodes = rail();
        let none: Vec<Todo> = vec![];
        seen.baseline(&sources(&nodes, &none, &[], &[]));
        nodes[1].status = Some(status(kind, "reading"));
        assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
        // The change is told, so the way out of it is a change again.
        nodes[1].status = Some(status(Kind::Done, "reading"));
        assert_eq!(seen.changed(&sources(&nodes, &none, &[], &[])).len(), 1);
    }
}

#[test]
fn b21_a_push_is_told_at_once_and_offered_again_once_released() {
    let seen = Seen::default();
    let mut nodes = rail();
    let none: Vec<Todo> = vec![];
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    nodes[1].status = Some(status(Kind::Idle, "done"));
    let mut pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    assert_eq!(pushes.len(), 1);
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
    seen.release(pushes.remove(0));
    assert_eq!(seen.changed(&sources(&nodes, &none, &[], &[])).len(), 1);
}

#[test]
fn b21_pads_the_baseline_found_are_not_news_and_an_ask_by_m_tells_them() {
    let seen = Seen::default();
    let nodes = rail();
    let none: Vec<Todo> = vec![];
    let pads = vec![pad("old", "a", 5)];
    seen.baseline(&sources(&nodes, &none, &pads, &[]));
    assert!(seen.changed(&sources(&nodes, &none, &pads, &[])).is_empty());

    let pads = vec![pad("old", "a", 5), pad("new", "a", 9)];
    assert_eq!(seen.changed(&sources(&nodes, &none, &pads, &[])).len(), 1);
    ask(&seen, &nodes, &none, &pads, &[]);
    assert!(seen.changed(&sources(&nodes, &none, &pads, &[])).is_empty());
}

#[test]
fn b23_a_removed_child_gets_one_last_push_with_its_kind_and_a_gone_door_none() {
    let seen = Seen::default();
    let none: Vec<Todo> = vec![];
    let mut nodes = rail();
    seen.baseline(&sources(&nodes, &none, &[], &[]));

    nodes.remove(1);
    let pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    assert_eq!(pushes.len(), 1);
    assert_eq!(
        (pushes[0].meta.as_str(), pushes[0].entry.name.as_str()),
        ("m", "a-name")
    );
    assert_eq!(pushes[0].entry.kind, Kind::Working);
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());

    // The Door goes with its child: nobody is left to tell.
    nodes.retain(|node| node.id == "t");
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
}

#[test]
fn b23_a_child_that_ended_before_it_was_removed_and_one_that_moved_get_no_second_push() {
    let seen = Seen::default();
    let none: Vec<Todo> = vec![];
    let mut nodes = rail();
    nodes.push(node("n", NodeKind::Workstream, None, "other"));
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    nodes[1].status = Some(status(Kind::Done, "finished"));
    assert_eq!(seen.changed(&sources(&nodes, &none, &[], &[])).len(), 1);

    nodes.remove(1);
    let pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    assert!(
        pushes.is_empty(),
        "the ended child was told of when it ended"
    );

    // `b` moves under `n`: `n` is told of its new child, and `m` is told of no removal.
    nodes[1].parent = Some("n".into());
    let pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    assert_eq!(
        pushes.iter().map(|p| p.meta.as_str()).collect::<Vec<_>>(),
        ["n"]
    );
}

#[test]
fn b23_a_moved_child_that_is_then_removed_is_told_only_to_its_new_door() {
    let seen = Seen::default();
    let none: Vec<Todo> = vec![];
    let mut nodes = rail();
    nodes.push(node("n", NodeKind::Workstream, None, "other"));
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    nodes[1].parent = Some("n".into());
    let pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    assert_eq!(
        pushes.iter().map(|p| p.meta.as_str()).collect::<Vec<_>>(),
        ["n"]
    );
    nodes.remove(1);
    let pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    assert_eq!(
        pushes.iter().map(|p| p.meta.as_str()).collect::<Vec<_>>(),
        ["n"]
    );
}

#[test]
fn b23_a_last_push_that_failed_is_offered_again() {
    let seen = Seen::default();
    let none: Vec<Todo> = vec![];
    let mut nodes = rail();
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    nodes.remove(1);
    let mut pushes = seen.changed(&sources(&nodes, &none, &[], &[]));
    seen.release(pushes.remove(0));
    assert_eq!(seen.changed(&sources(&nodes, &none, &[], &[])).len(), 1);
}

#[test]
fn a5482c_non_door_coordinator_receives_the_fallback() {
    let mut nodes = rail();
    nodes[0].kind = NodeKind::Agent;
    let attempt = nodes[1].attempt.clone().unwrap();
    let seen = Seen::default();
    let mut from = sources(&nodes, &[], &[], &[]);
    seen.baseline(&from);
    from.completed.insert(
        "a".into(),
        (
            format!("{attempt}:1"),
            10,
            "Should I publish three pages or five".into(),
        ),
    );
    let pushes = seen.changed(&from);
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0].meta, "m");
    assert_eq!(pushes[0].subagent(), "a");
    assert_eq!(pushes[0].entry.last, "Should I publish three pages or five");
    assert!(push_body(&pushes[0].entry).starts_with("[digest] a-name is working\n"));
    assert!(
        seen.changed(&from).is_empty(),
        "a replay repeated the fallback"
    );
    assert_eq!(
        seen.ask(&Actor::user(), "m", &from).unwrap_err().code,
        rpc::code::CONFLICT
    );
}

#[test]
fn b5519a_a_later_turn_note_replaces_the_previous_final_text() {
    for pushed in [false, true] {
        let mut nodes = rail();
        nodes[1].status = Some(Status {
            since: 30,
            finished: "1".into(),
            ..status(Kind::Working, "reading page two")
        });
        let attempt = nodes[1].attempt.clone().unwrap();
        let seen = Seen::default();
        let notes = [sent(40, "a", "m", "starting page two")];
        let mut from = sources(&nodes, &[], &[], &[]);
        from.completed.insert(
            "a".into(),
            (format!("{attempt}:1"), 10, "Done with page one".into()),
        );
        seen.baseline(&from);
        from.messages = &notes;
        let entry = if pushed {
            // Progress alone is silent; an open Todo makes the next push eligible (B21).
            assert!(seen.changed(&from).is_empty());
            let todos = [todo(1, "a", false)];
            from.todos = &todos;
            let pushes = seen.changed(&from);
            assert_eq!(pushes.len(), 1);
            assert_eq!(pushes[0].subagent(), "a");
            assert_eq!(pushes[0].meta, "m");
            pushes[0].entry.clone()
        } else {
            let caller = Actor {
                kind: ActorKind::Agent,
                id: "m".into(),
                parent: None,
            };
            let digest = seen.ask(&caller, "m", &from).unwrap();
            entries(&digest.children)[0].clone()
        };
        assert_eq!(entry.name, "a-name");
        assert_eq!(entry.last, "starting page two", "pushed={pushed}");
    }
}
