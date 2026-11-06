use super::*;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

fn node(id: &str, kind: &str, parent: Option<&str>, status: Option<&str>) -> RailNode {
    serde_json::from_value(json!({
        "id": id, "kind": kind, "name": id, "parent": parent, "order": 0,
        "status": status.map(|k| json!({"kind": k, "label": k, "since": 0,"finished":"0"})),
        "attempt": null, "status_revision": null, "terminal_id": null, "worktree": null,
        "can_resume": false, "channel": null, "work": null, "stray": [],
        "model": null, "effort": null,
    }))
    .unwrap()
}

fn launcher(project: &Path) -> agents::claude_code::Launcher {
    let fake = project.join("fake-claude");
    std::fs::write(
        &fake,
        "#!/bin/sh\nif [ \"$1\" = plugin ] && [ \"$2\" = test ]; then echo 'Q11 runtime hook closure: 1 pass'; exit 0; fi\nwhile read line; do :; done\n",
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    let rup = project.join("rup");
    std::fs::write(&rup, "").unwrap();
    agents::claude_code::Launcher::new(
        fake.to_str().unwrap(),
        project.join("claude.json"),
        rup,
        None,
    )
}

/// A Daemon whose Queue watcher is off, so a test drives each pass itself.
fn daemon(project: &Path) -> Daemon {
    let daemon = watched(project);
    daemon
        .queue
        .watching
        .store(true, std::sync::atomic::Ordering::SeqCst);
    daemon
}

fn watched(project: &Path) -> Daemon {
    let data = project.join(".roundup");
    Daemon::open_stores(project, &data, |_| {
        let bus = Bus::new();
        let terminals = Arc::new(terminal::Terminals::open(&data, bus.clone()).unwrap());
        Agents::open_in(
            project,
            &data,
            bus,
            terminals,
            launcher(project),
            agents::worktree::Git::from_env(),
        )
        .unwrap()
    })
    .unwrap()
}

async fn call(daemon: &Daemon, method: &str, params: Value) -> Result<Value, RpcError> {
    let (events, _) = tokio::sync::mpsc::unbounded_channel();
    let mut conn = super::super::Conn {
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    };
    daemon.route(&mut conn, method, params).await
}

async fn todo(daemon: &Daemon, title: &str, body: &str) -> u32 {
    let made = call(daemon, "todo.create", json!({"title": title, "body": body}))
        .await
        .unwrap();
    made["id"].as_u64().unwrap() as u32
}

async fn start(daemon: &Daemon, id: u32, start: Value) -> Result<Value, RpcError> {
    call(
        daemon,
        "todo.startWorkstream",
        json!({"id": id, "name": "Ship it", "start": start}),
    )
    .await
}

async fn queue(daemon: &Daemon) -> QueueState {
    serde_json::from_value(call(daemon, "workstream.queue", Value::Null).await.unwrap())
        .unwrap()
}

fn changes(daemon: &Daemon) -> impl FnMut() -> usize + use<> {
    let mut events = daemon.bus.subscribe();
    move || {
        let mut seen = 0;
        while let Ok(event) = events.try_recv() {
            if matches!(event.data, EventData::WorkstreamQueueChanged) {
                seen += 1;
            }
        }
        seen
    }
}

#[tokio::test]
async fn a3194_the_todo_moves_to_the_new_workstream_and_is_owned_by_its_door() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let id = todo(&daemon, "Ship it", "").await;
    let made = start(&daemon, id, json!({"kind": "queued"})).await.unwrap();
    let ws = made["id"].as_str().unwrap();
    assert_eq!(
        (made["kind"].as_str(), made["name"].as_str()),
        (Some("workstream"), Some("Ship it"))
    );
    assert!(made["attempt"].is_null(), "the Door stays stopped");
    let got = call(&daemon, "todo.get", json!({"id": id})).await.unwrap();
    assert_eq!(got["home"], ws);
    assert_eq!(
        got["owner"],
        json!({"kind": "agent", "id": ws, "parent": null})
    );
    let history = call(&daemon, "todo.getHistory", json!({"id": id}))
        .await
        .unwrap();
    assert!(history["changes"].as_array().unwrap().len() >= 2);
}

#[tokio::test]
async fn a3194_a_refused_call_changes_nothing() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let open = todo(&daemon, "open", "").await;
    let done = todo(&daemon, "done", "").await;
    call(&daemon, "todo.complete", json!({"id": done}))
        .await
        .unwrap();
    let before = call(&daemon, "todo.list", Value::Null).await.unwrap();
    let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    let refused = [
        (done, "w", json!({"kind": "queued"}), code::INVALID_PARAMS),
        (99, "w", json!({"kind": "queued"}), code::NOT_FOUND),
        (open, "  ", json!({"kind": "queued"}), code::INVALID_PARAMS),
        (
            open,
            "w",
            json!({"kind": "afterTodo", "todo": open}),
            code::INVALID_PARAMS,
        ),
        (
            open,
            "w",
            json!({"kind": "afterTodo", "todo": 99}),
            code::NOT_FOUND,
        ),
    ];
    for (id, name, choice, expected) in refused {
        let err = call(
            &daemon,
            "todo.startWorkstream",
            json!({"id": id, "name": name, "start": choice}),
        )
        .await
        .unwrap_err();
        assert_eq!(err.code, expected, "{id} {name} {choice}");
    }
    assert_eq!(
        call(&daemon, "todo.list", Value::Null).await.unwrap(),
        before
    );
    assert_eq!(call(&daemon, "rail.tree", Value::Null).await.unwrap(), tree);
    assert!(queue(&daemon).await.entries.is_empty());
}

#[tokio::test]
async fn a3194_the_orders_seed_comes_from_the_todo() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let id = todo(&daemon, "Fix the login flow now", "Users get logged out").await;
    let made = start(&daemon, id, json!({"kind": "queued"})).await.unwrap();
    assert_eq!(made["work"]["kind"], "work");
    assert_eq!(made["work"]["title"], "Fix the login flow now");
    assert!(
        made["work"]["ask"]
            .as_str()
            .unwrap()
            .contains("Users get logged out")
    );
}

#[tokio::test]
async fn a3195_now_starts_the_door_over_the_cap() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    call(&daemon, "project.setWorkstreamCap", json!({"cap": 1}))
        .await
        .unwrap();
    let first = todo(&daemon, "one", "").await;
    let second = todo(&daemon, "two", "").await;
    for id in [first, second] {
        let made = start(&daemon, id, json!({"kind": "now"})).await.unwrap();
        assert!(made["terminal_id"].is_string(), "the Door started: {made}");
    }
    assert!(queue(&daemon).await.entries.is_empty());
    daemon.stop_terminals().await.unwrap();
}

#[tokio::test]
async fn a3195_queued_and_after_todo_start_nothing_by_themselves() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let first = todo(&daemon, "one", "").await;
    let second = todo(&daemon, "two", "").await;
    let a = start(&daemon, first, json!({"kind": "queued"}))
        .await
        .unwrap();
    let b = start(&daemon, second, json!({"kind": "afterTodo", "todo": first}))
        .await
        .unwrap();
    assert!(a["terminal_id"].is_null() && b["terminal_id"].is_null());
    let state = queue(&daemon).await;
    assert_eq!(
        state
            .entries
            .iter()
            .map(|e| (e.workstream.as_str(), e.start.clone()))
            .collect::<Vec<_>>(),
        [
            (a["id"].as_str().unwrap(), StartChoice::Queued),
            (
                b["id"].as_str().unwrap(),
                StartChoice::AfterTodo { todo: first }
            ),
        ]
    );
    assert_eq!((state.running, state.cap), (0, None));
}

#[test]
fn a3195_running_counts_a_workstream_while_any_agent_is_working() {
    let nodes = [
        node("1", "workstream", None, Some("idle")),
        node("2", "agent", Some("1"), Some("working")),
        node("3", "workstream", None, Some("working")),
        node("4", "workstream", None, Some("needs-you")),
        node("5", "agent", Some("4"), Some("blocked")),
        node("6", "workstream", None, Some("error")),
        node("7", "workstream", None, Some("done")),
    ];
    let mut now: Vec<_> = running(&nodes, &HashSet::new()).into_iter().collect();
    now.sort();
    assert_eq!(now, ["1", "3"]);
}

#[test]
fn a3195_a_just_started_workstream_counts_before_its_first_status() {
    let nodes = [
        node("1", "workstream", None, None),
        node("2", "workstream", None, Some("idle")),
    ];
    let launching: HashSet<String> = ["1".to_owned(), "9".to_owned()].into();
    let now = running(&nodes, &launching);
    assert_eq!(now, ["1".to_owned()].into());
    assert!(running(&nodes, &HashSet::new()).is_empty());
}

#[tokio::test]
async fn a3195_an_invalid_cap_changes_nothing() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    call(&daemon, "project.setWorkstreamCap", json!({"cap": 2}))
        .await
        .unwrap();
    let mut seen = changes(&daemon);
    for bad in [json!(0), json!(-1), json!(1.5), json!("2")] {
        let err = call(&daemon, "project.setWorkstreamCap", json!({"cap": bad}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::INVALID_PARAMS, "{bad}");
    }
    assert_eq!((queue(&daemon).await.cap, seen()), (Some(2), 0));
    let get = call(&daemon, "project.get", Value::Null).await.unwrap();
    assert_eq!(get["workstreamCap"], 2);
    call(&daemon, "project.setWorkstreamCap", json!({"cap": null}))
        .await
        .unwrap();
    let get = call(&daemon, "project.get", Value::Null).await.unwrap();
    assert!(get["workstreamCap"].is_null());
}

#[tokio::test]
async fn a3195_dequeue_move_and_start_now_change_the_queue_once_each() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let mut ids = Vec::new();
    for title in ["a", "b", "c"] {
        let t = todo(&daemon, title, "").await;
        ids.push(
            start(&daemon, t, json!({"kind": "queued"})).await.unwrap()["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    let mut seen = changes(&daemon);
    let order = |state: QueueState| {
        state
            .entries
            .into_iter()
            .map(|e| e.workstream)
            .collect::<Vec<_>>()
    };
    call(
        &daemon,
        "workstream.queueMove",
        json!({"workstream": ids[2], "index": 0}),
    )
    .await
    .unwrap();
    assert_eq!(
        (order(queue(&daemon).await), seen()),
        ([&ids[2], &ids[0], &ids[1]].map(String::clone).to_vec(), 1)
    );
    call(&daemon, "workstream.dequeue", json!({"workstream": ids[0]}))
        .await
        .unwrap();
    assert_eq!(
        (order(queue(&daemon).await), seen()),
        ([&ids[2], &ids[1]].map(String::clone).to_vec(), 1)
    );
    let started = call(
        &daemon,
        "workstream.startNow",
        json!({"workstream": ids[1]}),
    )
    .await
    .unwrap();
    assert!(started["terminal_id"].is_string());
    assert_eq!(
        (order(queue(&daemon).await), seen()),
        (vec![ids[2].clone()], 1)
    );
    let err = call(&daemon, "workstream.dequeue", json!({"workstream": ids[0]}))
        .await
        .unwrap_err();
    assert_eq!(err.code, code::NOT_FOUND);
    daemon.stop_terminals().await.unwrap();
}

/// A pass over `nodes` and `todos` with a fake start; returns the ids it started in order.
async fn pass(
    daemon: &Daemon,
    nodes: &[RailNode],
    todos: &[(u32, bool)],
    failing: &[&str],
) -> Vec<String> {
    let started = Arc::new(Mutex::new(Vec::new()));
    let log = Arc::clone(&started);
    let failing: Vec<String> = failing.iter().map(|s| (*s).to_owned()).collect();
    let mut fake = move |id: String| -> Starting<'static> {
        let log = Arc::clone(&log);
        let fail = failing.contains(&id);
        Box::pin(async move {
            if fail {
                return Err(RpcError::conflict("no claude"));
            }
            log.lock().unwrap().push(id);
            Ok(())
        })
    };
    daemon
        .queuer()
        .pass(nodes, &todos.iter().copied().collect(), &mut fake)
        .await
        .unwrap();
    started.lock().unwrap().clone()
}

/// Queue `n` Workstreams (Rail ids), each from its own Todo; `after[i]` is the Todo it waits for.
async fn queued(daemon: &Daemon, after: &[Option<u32>]) -> Vec<String> {
    let mut ids = Vec::new();
    for (i, wait) in after.iter().enumerate() {
        let t = todo(daemon, &format!("t{i}"), "").await;
        let choice = wait.map_or(
            json!({"kind": "queued"}),
            |todo| json!({"kind": "afterTodo", "todo": todo}),
        );
        ids.push(
            start(daemon, t, choice).await.unwrap()["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
    }
    ids
}

#[tokio::test]
async fn a3196_a_freed_slot_starts_the_head_in_order() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let ids = queued(&daemon, &[None, None, None]).await;
    call(&daemon, "project.setWorkstreamCap", json!({"cap": 2}))
        .await
        .unwrap();
    let busy = [node("90", "workstream", None, Some("working"))];
    assert_eq!(pass(&daemon, &busy, &[], &[]).await, [ids[0].clone()]);
    // The started one counts as launching, so one count change never starts two over the cap.
    let launched = [busy[0].clone(), node(&ids[0], "workstream", None, None)];
    assert!(pass(&daemon, &launched, &[], &[]).await.is_empty());
    daemon.queue.launching.lock().unwrap().clear();
    let idle = [node("90", "workstream", None, Some("idle"))];
    assert_eq!(
        pass(&daemon, &idle, &[], &[]).await,
        [ids[1].clone(), ids[2].clone()]
    );
    assert!(queue(&daemon).await.entries.is_empty());
}

#[tokio::test]
async fn a3196_an_after_todo_entry_waits_for_its_todo_and_blocks_none_behind_it() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let gate = todo(&daemon, "gate", "").await;
    let ids = queued(&daemon, &[Some(gate), None]).await;
    assert_eq!(
        pass(&daemon, &[], &[(gate, false)], &[]).await,
        [ids[1].clone()]
    );
    let left = queue(&daemon).await.entries;
    assert_eq!(left.len(), 1);
    assert_eq!(
        (left[0].workstream.as_str(), &left[0].start),
        (ids[0].as_str(), &StartChoice::AfterTodo { todo: gate })
    );
    assert_eq!(
        pass(&daemon, &[], &[(gate, true)], &[]).await,
        [ids[0].clone()]
    );
}

#[tokio::test]
async fn a3196_a_deleted_todo_frees_its_entry_as_queued() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let gate = todo(&daemon, "gate", "").await;
    let ids = queued(&daemon, &[Some(gate)]).await;
    assert_eq!(pass(&daemon, &[], &[], &["x"]).await, [ids[0].clone()]);
}

#[tokio::test]
async fn a3196_no_cap_starts_every_eligible_entry() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let gate = todo(&daemon, "gate", "").await;
    let ids = queued(&daemon, &[None, Some(gate), None]).await;
    let busy = [node("90", "workstream", None, Some("working"))];
    assert_eq!(
        pass(&daemon, &busy, &[(gate, false)], &[]).await,
        [ids[0].clone(), ids[2].clone()]
    );
}

#[tokio::test]
async fn a3196_a_failed_start_keeps_its_place_and_does_not_stop_the_pass() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let ids = queued(&daemon, &[None, None]).await;
    let mut seen = changes(&daemon);
    assert_eq!(
        pass(&daemon, &[], &[], &[ids[0].as_str()]).await,
        [ids[1].clone()]
    );
    assert_eq!(seen(), 1);
    let left = queue(&daemon).await.entries;
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].workstream, ids[0]);
    assert_eq!(
        left[0].failure.as_ref().map(|f| f.code),
        Some(code::CONFLICT)
    );
}

#[tokio::test]
async fn a3196_a_removed_workstream_leaves_the_queue() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let ids = queued(&daemon, &[None, None]).await;
    call(&daemon, "rail.remove", json!({"id": ids[0]}))
        .await
        .unwrap();
    let left: Vec<_> = queue(&daemon)
        .await
        .entries
        .into_iter()
        .map(|e| e.workstream)
        .collect();
    assert_eq!(left, [ids[1].clone()]);
}

#[tokio::test]
async fn a3197_the_queue_and_cap_survive_a_restart_and_start_nothing() {
    let project = tempfile::tempdir().unwrap();
    let ids = {
        let daemon = daemon(project.path());
        call(&daemon, "project.setWorkstreamCap", json!({"cap": 3}))
            .await
            .unwrap();
        let gate = todo(&daemon, "gate", "").await;
        queued(&daemon, &[None, Some(gate), None]).await
    };
    let daemon = daemon(project.path());
    let state = queue(&daemon).await;
    assert_eq!(state.cap, Some(3));
    assert_eq!(
        state
            .entries
            .iter()
            .map(|e| e.workstream.clone())
            .collect::<Vec<_>>(),
        ids
    );
    let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .all(|n| n["terminal_id"].is_null())
    );
}

#[tokio::test]
async fn a3197_changing_the_cap_starts_and_stops_nothing_by_itself() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let ids = queued(&daemon, &[None, None]).await;
    for step in [
        ("project.setWorkstreamCap", json!({"cap": 5})),
        ("project.setWorkstreamCap", json!({"cap": null})),
        (
            "workstream.queueMove",
            json!({"workstream": ids[1], "index": 0}),
        ),
        ("workstream.dequeue", json!({"workstream": ids[0]})),
    ] {
        call(&daemon, step.0, step.1).await.unwrap();
    }
    let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
    assert!(
        tree.as_array()
            .unwrap()
            .iter()
            .all(|n| n["terminal_id"].is_null())
    );
    assert_eq!(queue(&daemon).await.entries.len(), 1);
}

#[tokio::test]
async fn a3197_the_next_count_change_uses_the_new_cap() {
    let project = tempfile::tempdir().unwrap();
    let daemon = daemon(project.path());
    let ids = queued(&daemon, &[None, None]).await;
    call(&daemon, "project.setWorkstreamCap", json!({"cap": 1}))
        .await
        .unwrap();
    let busy = [node("90", "workstream", None, Some("working"))];
    assert!(pass(&daemon, &busy, &[], &[]).await.is_empty());
    call(&daemon, "project.setWorkstreamCap", json!({"cap": 2}))
        .await
        .unwrap();
    assert_eq!(pass(&daemon, &busy, &[], &[]).await, [ids[0].clone()]);
}

#[tokio::test]
async fn a3196_a_done_todo_wakes_the_watcher_and_its_entry_starts() {
    let project = tempfile::tempdir().unwrap();
    let daemon = watched(project.path());
    let gate = todo(&daemon, "gate", "").await;
    let ids = queued(&daemon, &[Some(gate)]).await;
    call(&daemon, "todo.complete", json!({"id": gate}))
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
            let started = tree
                .as_array()
                .unwrap()
                .iter()
                .any(|n| n["id"] == ids[0] && n["terminal_id"].is_string());
            if started {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert!(queue(&daemon).await.entries.is_empty());
    daemon.stop_terminals().await.unwrap();
}
