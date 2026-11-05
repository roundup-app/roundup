//! DCL2: a Workstream's state is derived from its Door and every Agent below it, and the Door
//! keeps its own Kind.
use super::*;

fn seed(daemon: &Daemon, dir: &Path, door: contracts::Kind, kinds: [contracts::Kind; 2]) {
    let db = rusqlite::Connection::open(dir.join("project.db")).unwrap();
    // 2 is a child of the Door; 3 is its internal child's own child.
    db.execute_batch(
        "INSERT INTO nodes(id,kind,name,parent,ord,attempt,terminal_id) VALUES
         (1,'workstream','Work',NULL,0,1,'door-terminal'),
         (2,'agent','Child',1,0,1,'child-terminal'),
         (3,'agent','Nested',2,0,1,'nested-terminal');",
    )
    .unwrap();
    db.execute("UPDATE nodes SET visibility='internal' WHERE id=2", [])
        .unwrap();
    for (id, kind) in [("1", door), ("2", kinds[0]), ("3", kinds[1])] {
        daemon.agents.set_status_for_test(
            id,
            contracts::Status {
                kind,
                label: String::new(),
                since: 1,
                finished: "0".into(),
            },
        );
    }
}

async fn door_node(daemon: &Daemon) -> Value {
    let tree = crate::tests::ask(daemon, r#"{"id":1,"method":"rail.tree"}"#).await;
    tree["result"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["id"] == "1")
        .unwrap()
        .clone()
}

#[tokio::test]
async fn dcl2_urgency_is_derived_without_overwriting_door_kind() {
    use contracts::Kind::*;
    // The Door idles throughout; the more urgent of its two descendants decides the state, and a
    // nested one counts as much as a direct child.
    let cases = [
        ([Idle, Idle], "idle"),
        ([Idle, Blocked], "waiting"),
        ([Blocked, Working], "working"),
        ([Done, Working], "working"),
        ([Working, Error], "error"),
        ([Error, NeedsYou], "needs-you"),
        ([NeedsYou, Idle], "needs-you"),
    ];
    for (kinds, state) in cases {
        let dir = tempfile::tempdir().unwrap();
        let daemon = test_daemon(dir.path()).unwrap();
        seed(&daemon, dir.path(), Idle, kinds);
        let node = door_node(&daemon).await;
        assert_eq!(node["workstream_state"], state, "{kinds:?}");
        assert_eq!(node["status"]["kind"], "idle", "{kinds:?}: Door Kind kept");
    }
}

#[tokio::test]
async fn dcl2_stopped_door_does_not_hide_work_and_a_crashed_one_stays_urgent() {
    use contracts::Kind::*;
    for (door, children, state) in [
        (Done, [Working, Done], "working"),
        (Done, [Done, Done], "idle"),
        (Error, [Working, Idle], "error"),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let daemon = test_daemon(dir.path()).unwrap();
        seed(&daemon, dir.path(), door, children);
        let node = door_node(&daemon).await;
        assert_eq!(node["workstream_state"], state, "{door:?} {children:?}");
    }
}
