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

/// A second connection to `path` that makes `door_told` refuse every write, as a full DB does.
fn refuse_told_writes(path: &std::path::Path, refuse: bool) {
    let db = rusqlite::Connection::open(path).unwrap();
    let sql = if refuse {
        "CREATE TRIGGER refuse_told BEFORE INSERT ON door_told \
         BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END"
    } else {
        "DROP TRIGGER refuse_told"
    };
    db.execute(sql, []).unwrap();
}

#[test]
fn dcl10a_a_refused_told_write_keeps_the_fact_untold() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("digest.db");
    let seen = Seen::open(&path).unwrap();
    let mut nodes = rail();
    let none: Vec<Todo> = vec![];
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    nodes[1].status = Some(status(Kind::Idle, "done"));

    refuse_told_writes(&path, true);
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
    // Still untold: the next pass offers it again, and queues it once the DB accepts writes.
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
    refuse_told_writes(&path, false);
    assert_eq!(seen.changed(&sources(&nodes, &none, &[], &[])).len(), 1);
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());

    refuse_told_writes(&path, true);
    let mut map = TellMap {
        map: Default::default(),
        db: Some(rusqlite::Connection::open(&path).unwrap()),
    };
    let key = ("m".to_owned(), "a".to_owned());
    let fact = seen.book().told.get(&key).cloned().unwrap();
    assert!(map.insert(key.clone(), fact).is_err());
    assert!(!map.contains_key(&key));
}

#[test]
fn dcl10a_reopen_after_a_refused_write_queues_the_fact_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("digest.db");
    let mut nodes = rail();
    let none: Vec<Todo> = vec![];
    let seen = Seen::open(&path).unwrap();
    seen.baseline(&sources(&nodes, &none, &[], &[]));
    nodes[1].status = Some(status(Kind::Idle, "done"));
    refuse_told_writes(&path, true);
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
    drop(seen);
    refuse_told_writes(&path, false);

    let seen = Seen::open(&path).unwrap();
    assert_eq!(seen.changed(&sources(&nodes, &none, &[], &[])).len(), 1);
    drop(seen);
    let seen = Seen::open(&path).unwrap();
    assert!(seen.changed(&sources(&nodes, &none, &[], &[])).is_empty());
}
