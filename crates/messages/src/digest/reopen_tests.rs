use super::tests::{rail, sources, status, todo};
use super::*;

/// DCL8: what was told survives a reopen, and a change that happened while the Daemon was closed
/// is still untold: no baseline marks it told.
#[test]
fn dcl8_reopen_keeps_told_and_marks_no_untold_fact_told() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("digest.db");
    let none: Vec<Todo> = vec![];
    let mut nodes = rail();
    let seen = Seen::open(&path).unwrap();
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    nodes[1].status = Some(status(Kind::Idle, "done"));
    assert_eq!(seen.changed(&sources(&nodes, &none, &[], &[])).len(), 1);
    drop(seen);

    // Told stays told: the same fact is not queued again.
    let seen = Seen::open(&path).unwrap();
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
    drop(seen);

    // A change while closed is untold after the reopen, and queued once.
    let todos = vec![todo(1, "a", false)];
    let seen = Seen::open(&path).unwrap();
    seen.baseline(&sources(&nodes, &todos, &[], &[]));
    let pushes = seen.changed(&sources(&nodes, &todos, &[], &[]));
    assert_eq!(pushes.len(), 1);
    assert_eq!(pushes[0].entry.todos, 1);
    assert!(seen.changed(&sources(&nodes, &todos, &[], &[])).is_empty());
}
