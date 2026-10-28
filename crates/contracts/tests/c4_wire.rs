use contracts::Event;

#[test]
fn c4_wire_bytes_match_before_migration() {
    // Captured with e9485a975 before the migration, using the Event values in event_wire.rs.
    for wire in include_str!("fixtures/c4-before-events.jsonl").lines() {
        let event: Event = serde_json::from_str(wire).unwrap();
        assert_eq!(serde_json::to_vec(&event).unwrap(), wire.as_bytes());
    }
}
