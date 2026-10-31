use super::*;

fn record(id: &str, state: ProgramState, msg: Option<&str>, applied: f64) -> Arc<Record> {
    Arc::new(Record {
        id: id.to_owned(),
        state,
        kind: None,
        progress: None,
        app: None,
        title: Some("title".to_owned()),
        msg: msg.map(str::to_owned),
        applied,
    })
}

fn kind(records: &[Arc<Record>]) -> Option<Kind> {
    fold(records, None, 0).map(|status| status.kind)
}

fn label(msg: Option<&str>) -> String {
    fold(&[record("", ProgramState::Idle, msg, 1.0)], None, 0)
        .unwrap()
        .label
}

#[test]
fn ps7_each_state_maps_to_its_kind_and_blocked_to_needs_you() {
    for (state, want) in [
        (ProgramState::Idle, Kind::Idle),
        (ProgramState::Working, Kind::Working),
        (ProgramState::Done, Kind::Done),
        (ProgramState::Error, Kind::Error),
        (ProgramState::Blocked, Kind::NeedsYou),
    ] {
        assert_eq!(kind(&[record("", state, None, 1.0)]), Some(want));
    }
    assert_eq!(kind(&[]), None);
}

#[test]
fn ps7_the_most_urgent_record_wins_and_ties_go_to_the_latest() {
    let all = [
        record("a", ProgramState::Done, None, 5.0),
        record("b", ProgramState::Idle, None, 4.0),
        record("c", ProgramState::Working, None, 3.0),
        record("d", ProgramState::Blocked, None, 2.0),
        record("e", ProgramState::Error, None, 1.0),
    ];
    assert_eq!(kind(&all), Some(Kind::Error));
    assert_eq!(kind(&all[..4]), Some(Kind::NeedsYou));
    assert_eq!(kind(&all[..3]), Some(Kind::Working));
    assert_eq!(kind(&all[..2]), Some(Kind::Idle));
    let tie = [
        record("a", ProgramState::Working, Some("old"), 1.0),
        record("b", ProgramState::Working, Some("new"), 2.0),
    ];
    assert_eq!(fold(&tie, None, 0).unwrap().label, "new");
}

#[test]
fn ps7_label_is_msg_then_title_and_is_cut_to_one_line() {
    assert_eq!(label(Some("tests")), "tests");
    assert_eq!(label(None), "title");
    assert_eq!(label(Some("one\ntwo")), "one");
    let cut = label(Some(&"x".repeat(300)));
    assert_eq!(cut.chars().count(), 200);
    assert!(cut.ends_with('…'));
    assert_eq!(label(Some(&"y".repeat(200))), "y".repeat(200));
    assert_eq!(label(Some("<b>&amp;")), "<b>&amp;");
}

#[test]
fn ps7_since_changes_only_when_the_kind_changes() {
    let first = fold(&working("a", 1.0), None, 100).unwrap();
    let again = fold(&working("b", 2.0), Some(&first), 900).unwrap();
    assert_eq!(
        (again.since, again.label.as_str(), again.finished.as_str()),
        (100, "b", "0")
    );
    let done = fold(
        &[record("", ProgramState::Done, None, 3.0)],
        Some(&again),
        950,
    )
    .unwrap();
    assert_eq!(done.since, 950);
}

fn working(msg: &str, applied: f64) -> Vec<Arc<Record>> {
    vec![record("", ProgramState::Working, Some(msg), applied)]
}

fn labels(events: &[EventData]) -> Vec<Option<String>> {
    events
        .iter()
        .map(|event| match event {
            EventData::TerminalStatus(e) => e.status.as_ref().map(|s| s.label.clone()),
            other => panic!("{other:?}"),
        })
        .collect()
}

#[test]
fn ps8_status_events_are_coalesced_per_terminal_and_the_last_is_delivered() {
    let statuses = Statuses::default();
    assert_eq!(
        labels(&statuses.changed("1", &working("a", 1.0), 0)),
        [Some("a".into())]
    );
    assert!(statuses.changed("1", &working("b", 2.0), 10).is_empty());
    assert!(statuses.changed("1", &working("c", 3.0), 20).is_empty());
    // Another Terminal has its own window.
    assert_eq!(statuses.changed("2", &working("z", 4.0), 30).len(), 1);
    assert_eq!(statuses.next_due(), Some(250));
    assert!(statuses.due(249).is_empty());
    assert_eq!(labels(&statuses.due(250)), [Some("c".into())]);
    assert_eq!(statuses.next_due(), None);
    // A report that leaves the Status as it was emits nothing.
    assert!(statuses.changed("1", &working("c", 5.0), 600).is_empty());
    // A held change that returns to what was sent emits nothing.
    assert_eq!(statuses.changed("1", &working("d", 6.0), 700).len(), 1);
    assert!(statuses.changed("1", &working("e", 7.0), 710).is_empty());
    assert!(statuses.changed("1", &working("d", 8.0), 720).is_empty());
    assert!(statuses.due(1000).is_empty());
}

#[test]
fn ps8_a_removed_terminal_loses_its_status_once() {
    let statuses = Statuses::default();
    statuses.changed("1", &working("a", 1.0), 0);
    assert_eq!(labels(&statuses.changed("1", &[], 500)), [None]);
    assert!(statuses.changed("1", &[], 600).is_empty());
    // A Terminal that never had a status sends nothing when removed.
    assert!(statuses.changed("9", &[], 700).is_empty());
}
