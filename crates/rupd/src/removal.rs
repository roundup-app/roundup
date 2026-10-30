//! A34: one coordinated removal, including deferred publication and Provenance.

use std::sync::Arc;

use contracts::{Actor, agent::RemoveScope};
use rpc::RpcError;
use rusqlite::params;
use serde_json::Value;

use crate::Daemon;

impl Daemon {
    pub(crate) async fn remove_workstream(
        &self,
        actor: &Actor,
        id: &str,
        scope: RemoveScope,
    ) -> Result<Value, RpcError> {
        self.remove_workstream_observed(actor, id, scope, None, |_| {})
            .await
    }

    async fn remove_workstream_observed(
        &self,
        actor: &Actor,
        id: &str,
        scope: RemoveScope,
        operation: Option<&str>,
        observe: impl Fn(&str) + Send + Sync + 'static,
    ) -> Result<Value, RpcError> {
        let observe = Arc::new(observe);
        let before = Arc::clone(&observe);
        let todos = Arc::clone(&self.todos);
        let pads = Arc::clone(&self.pads);
        let home = id.to_owned();
        let caller = actor.clone();
        let retention = operation.map(str::to_owned);
        let apply = move |db: &rusqlite::Connection, removal: &mut contracts::agent::Removal| {
            let workstream: bool = db
                .query_row(
                    "SELECT kind='workstream' FROM nodes WHERE CAST(id AS TEXT)=?",
                    [&home],
                    |r| r.get(0),
                )
                .map_err(RpcError::internal)?;
            if let Some(operation) = &retention {
                todos::Todos::retain_workstream_in(
                    db,
                    &caller,
                    operation,
                    workstream.then_some(home.as_str()),
                )?;
                if workstream {
                    db.execute("INSERT INTO rail_removal_items(operation,kind,id,home) SELECT ?1,'deliverable-home',id,home FROM deliverables WHERE home=?2 AND removed=0",params![operation,home]).map_err(RpcError::internal)?;
                    pads.retain_workstream(db, &caller, operation, &home, removal)?;
                }
            }
            let (files, events) = if workstream {
                let mut events = todos.remove_workstream(db, &home, &caller, removal, scope)?;
                let (files, pad_events) = pads.remove_workstream(db, &home, removal)?;
                events.extend(pad_events);
                db.execute("UPDATE deliverables SET home=NULL, record=json_set(record,'$.home',NULL) WHERE home=? AND removed=0",[&home]).map_err(RpcError::internal)?;
                (files, events)
            } else {
                (pads::RemovalFiles::default(), Vec::new())
            };
            let owners = if let Some(operation) = &retention {
                let mut removed = vec![home.clone()];
                removed.extend(
                    removal
                        .removed
                        .iter()
                        .filter(|i| i.kind == contracts::agent::RemovalKind::Agent)
                        .map(|i| i.id.clone()),
                );
                todos::Todos::remove_owners_in(db, &Actor::daemon(), operation, &removed)?
            } else {
                Vec::new()
            };
            // Every participant's write record rolls back with the Project graph.
            removal_touch(db, &caller, &home, retention.as_deref(), removal)?;
            before("before_commit");
            Ok((files, events, owners))
        };
        let (removal, (files, events, owners)) = if let Some(operation) = operation {
            self.agents
                .remove_reversible_with(actor.clone(), id, operation, apply)
                .await?
        } else {
            self.agents
                .remove_workstream_with(actor.clone(), id, scope, apply)
                .await?
        };
        observe("after_commit");
        files.commit();
        self.publish_removal(events, owners)?;
        rpc::reply(&removal)
    }
}

impl Daemon {
    pub(crate) async fn remove_reversible(
        &self,
        actor: &Actor,
        p: contracts::agent::RemoveParams,
    ) -> Result<Value, RpcError> {
        use contracts::ActorKind;
        if p.scope == Some(RemoveScope::All) {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "scope all cannot retain a removal operation",
            ));
        }
        if actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user retains a Rail removal"));
        }
        let operation = p.operation.expect("reversible request");
        if operation.is_empty() || operation.len() > 96 {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "removal needs a key of 1–96 bytes",
            ));
        }
        if let Some(result) = self.agents.rail_deletion(actor, &operation)? {
            if result.deletion.as_ref().expect("retained operation").id != p.id {
                return Err(RpcError::conflict("removal key already names another node"));
            }
            return rpc::reply(&result);
        }
        self.remove_workstream_observed(actor, &p.id, RemoveScope::This, Some(&operation), |_| {})
            .await
    }

    pub(super) async fn rail_deletion_call(
        &self,
        conn: &mut crate::Conn,
        method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        use contracts::ActorKind;
        let p: contracts::agent::DeletionParams = rpc::params(value)?;
        if conn.actor.kind != ActorKind::User {
            return Err(RpcError::forbidden("only the user restores a Rail removal"));
        }
        let Some(receipt) = self.agents.rail_deletion(&conn.actor, &p.operation)? else {
            return if method == "rail.deletion" {
                rpc::reply(&Option::<contracts::agent::Removal>::None)
            } else {
                Err(RpcError::not_found("Rail removal"))
            };
        };
        if receipt
            .deletion
            .as_ref()
            .expect("retained operation")
            .project
            != p.project
        {
            return Err(RpcError::forbidden("removal belongs to another Project"));
        }
        if method == "rail.deletion"
            || receipt
                .deletion
                .as_ref()
                .expect("retained operation")
                .restored
        {
            return rpc::reply(&receipt);
        }
        let actor = conn.actor.clone();
        let after_touch = self.touches.sequence().map_err(RpcError::internal)?;
        let todos = Arc::clone(&self.todos);
        let pads = Arc::clone(&self.pads);
        let (result, (files, events, moved)) = self
            .agents
            .restore_reversible_with(actor.clone(), move || {
                let mut graph = None;
                let mut files = Vec::new();
                let mut events = Vec::new();
                let mut moved = Vec::new();
                let participant = todos.rail_operation(&actor, &p.operation)?;
                let (_, todo_events) = todos.restore_with(
                    &actor,
                    &participant,
                    after_touch,
                    |db| {
                        let result = agents::Agents::restore_reversible_in(db, &actor, &p)?;
                        todos::Todos::validate_rail_targets_in(db, &participant)?;
                        moved = todos::Todos::restore_workstream_homes_in(db, &p.operation)?;
                        moved.extend(todos::Todos::restore_owners_in(
                            db,
                            &Actor::daemon(),
                            &p.operation,
                        )?);
                        moved.sort_unstable();
                        moved.dedup();
                        let (mirrors, pad_events) =
                            pads.restore_workstream_in(db, &actor, &p.operation)?;
                        files = mirrors;
                        events = pad_events;
                        removal_touch(
                            db,
                            &actor,
                            &result.deletion.as_ref().expect("retained operation").id,
                            Some(&p.operation),
                            &result,
                        )?;
                        graph = Some(result);
                        Ok(())
                    },
                    |db| agents::Agents::acknowledge_restoration_in(db, &p.operation),
                )?;
                events.extend(todo_events);
                Ok((
                    graph.ok_or_else(|| {
                        RpcError::conflict("Todo operation was consumed separately")
                    })?,
                    (files, events, moved),
                ))
            })
            .await?;
        for file in files {
            file.keep().map_err(RpcError::internal)?;
        }
        self.publish_removal(events, moved)?;
        rpc::reply(&result)
    }

    fn publish_removal(
        &self,
        mut events: Vec<contracts::EventData>,
        ids: Vec<u32>,
    ) -> Result<(), RpcError> {
        use contracts::EventData;
        for event in self.todos.rail_events(ids)? {
            let EventData::TodoUpdated(todo) = &event else {
                unreachable!("Todo participant event")
            };
            if let Some(existing)=events.iter_mut().find(|e|matches!(e,EventData::TodoUpdated(t)|EventData::TodoRestored(t) if t.id==todo.id)) {
                if matches!(existing,EventData::TodoUpdated(_)) {*existing=event;}
            } else {events.push(event);}
        }
        // Home, ownership and blocker participants announce one final committed value,
        // in A34's Todo order, before the existing Pad events.
        events.sort_by_key(|e| match e {
            EventData::TodoUpdated(t) | EventData::TodoRestored(t) => (0, t.id),
            EventData::TodoDeleted(t) | EventData::TodoUnblocked(t) => (0, t.id),
            _ => (1, 0),
        });
        for event in events {
            self.bus.emit(Actor::daemon(), event);
        }
        Ok(())
    }
}

fn removal_touch(
    db: &rusqlite::Connection,
    actor: &Actor,
    id: &str,
    operation: Option<&str>,
    removal: &contracts::agent::Removal,
) -> Result<(), RpcError> {
    use contracts::agent::RemovalKind;
    let nanos = u128::try_from(time::OffsetDateTime::now_utc().unix_timestamp_nanos())
        .map_err(RpcError::internal)?;
    let at = nanos / 1_000_000;
    let at = i64::try_from(at).map_err(RpcError::internal)?;
    let prefix = |kind| match kind {
        RemovalKind::Agent => "rail",
        RemovalKind::Todo => "todo",
        RemovalKind::Pad => "pad",
    };
    let mut items: Vec<_> = removal
        .removed
        .iter()
        .map(|i| (prefix(i.kind).to_owned(), i.id.clone()))
        .chain(
            removal
                .kept
                .iter()
                .map(|i| (prefix(i.kind).to_owned(), i.id.clone())),
        )
        .collect();
    if let Some(operation) = operation {
        let mut q=db.prepare("SELECT CASE WHEN kind LIKE 'todo-%' THEN 'todo' ELSE 'pad' END,id FROM rail_removal_items WHERE operation=? AND kind IN ('todo-home','todo-owner','pad','pad-home') ORDER BY kind,CAST(id AS INTEGER),id").map_err(RpcError::internal)?;
        items.extend(
            q.query_map([operation], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(RpcError::internal)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(RpcError::internal)?,
        );
    }
    items.push(("rail".into(), id.into()));
    let mut seen = std::collections::HashSet::new();
    for (prefix, id) in items {
        let item = format!("{prefix}:{id}");
        if !seen.insert(item.clone()) {
            continue;
        }
        let author = if prefix == "rail" {
            actor.clone()
        } else {
            Actor::daemon()
        };
        let kind = serde_json::to_value(author.kind).map_err(RpcError::internal)?;
        db.execute("INSERT INTO touches(actor_kind,actor_id,actor_parent,verb,item,at) VALUES(?,?,?,'wrote',?,?)",params![kind.as_str(),author.id,author.parent,item,at]).map_err(RpcError::internal)?;
    }
    Ok(())
}

impl Daemon {
    pub(super) async fn rail_redo_call(
        &self,
        conn: &mut crate::Conn,
        _method: &str,
        value: Value,
    ) -> Result<Value, RpcError> {
        if conn.actor.kind != contracts::ActorKind::User {
            return Err(RpcError::forbidden("only the user redoes a Rail removal"));
        }
        let p: contracts::agent::RedoParams = rpc::params(value)?;
        let actor = conn.actor.clone();
        let caller = actor.clone();
        let source = p.source.clone();
        let operation = p.operation.clone();
        let pads = Arc::clone(&self.pads);
        let (result, out) = self
            .agents
            .redo_reversible_with(actor, p, move |db, removal| {
                let mut events =
                    todos::Todos::redo_workstream_in(db, &caller, &source, &operation)?;
                let (files, pad_events) =
                    pads.redo_workstream_in(db, &caller, &source, &operation)?;
                events.extend(pad_events);
                let id: String = db
                    .query_row(
                        "SELECT node FROM rail_deletions WHERE operation=?",
                        [&source],
                        |r| r.get(0),
                    )
                    .map_err(RpcError::internal)?;
                let mut owners=vec![id.clone()];
                owners.extend(removal.removed.iter().filter(|item|item.kind==contracts::agent::RemovalKind::Agent).map(|item|item.id.clone()));
                todos::Todos::remove_owners_in(db,&Actor::daemon(),&operation,&owners)?;
                db.execute("INSERT INTO rail_removal_items(operation,kind,id,home) SELECT ?2,kind,id,home FROM rail_removal_items r WHERE operation=?1 AND kind='deliverable-home' AND EXISTS(SELECT 1 FROM deliverables d WHERE d.id=r.id AND d.home=r.home AND d.removed=0)",params![source,operation]).map_err(RpcError::internal)?;
                db.execute("INSERT OR IGNORE INTO rail_removal_items(operation,kind,id,home) SELECT ?1,'deliverable-home',id,home FROM deliverables WHERE home=?2 AND removed=0",params![operation,id]).map_err(RpcError::internal)?;
                db.execute("UPDATE deliverables SET home=NULL,record=json_set(record,'$.home',NULL) WHERE id IN (SELECT id FROM rail_removal_items WHERE operation=? AND kind='deliverable-home')",[&operation]).map_err(RpcError::internal)?;
                let mut q=db.prepare("SELECT DISTINCT CAST(id AS INTEGER) FROM rail_removal_items WHERE operation=? AND kind IN ('todo-home','todo-owner')").map_err(RpcError::internal)?;
                let moved=q.query_map([&operation],|r|r.get::<_,u32>(0)).map_err(RpcError::internal)?.collect::<Result<Vec<_>,_>>().map_err(RpcError::internal)?;
                removal_touch(db, &caller, &id, Some(&operation), removal)?;
                Ok((files, events, moved))
            })
            .await?;
        if let Some((files, events, moved)) = out {
            files.commit();
            self.publish_removal(events, moved)?;
        }
        rpc::reply(&result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Conn;
    use serde_json::json;
    use std::time::Duration;
    use tokio::sync::{Semaphore, mpsc};

    #[tokio::test]
    async fn p12_move_checks_the_rail() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let r1 = call(&daemon, "rail.createWorkstream", json!({"name":"r1"}))
            .await
            .unwrap()["id"]
            .clone();
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute(
            "INSERT INTO nodes(kind,name,ord) SELECT 'agent','agent',COUNT(*) FROM nodes",
            [],
        )
        .unwrap();
        let agent = db.last_insert_rowid().to_string();
        call(&daemon, "pad.create", json!({"name":"notes"}))
            .await
            .unwrap();
        let before = call(&daemon, "pad.list", Value::Null).await.unwrap();
        let touched = daemon.touches.history("pad:notes").unwrap();
        let mut events = daemon.bus.subscribe();
        for (name, home, code) in [
            ("notes", json!("nope"), rpc::code::NOT_FOUND),
            ("notes", json!(agent), rpc::code::INVALID_PARAMS),
        ] {
            let err = call(&daemon, "pad.move", json!({"name":name,"home":home}))
                .await
                .unwrap_err();
            assert_eq!(err.code, code);
            assert_eq!(
                call(&daemon, "pad.list", Value::Null).await.unwrap(),
                before
            );
            assert_eq!(daemon.touches.history("pad:notes").unwrap(), touched);
            assert!(matches!(
                events.try_recv(),
                Err(tokio::sync::broadcast::error::TryRecvError::Empty)
            ));
        }
        let (send, _) = mpsc::unbounded_channel();
        let mut conn = Conn {
            actor: Actor {
                kind: contracts::ActorKind::Agent,
                id: agent,
                parent: None,
            },
            peer: None,
            events: send,
            output: None,
        };
        daemon
            .route(&mut conn, "pad.move", json!({"name":"notes","home":r1}))
            .await
            .unwrap();
        assert_eq!(
            call(&daemon, "pad.read", json!({"name":"notes"}))
                .await
                .unwrap()["home"],
            r1
        );
        assert!(matches!(
            events.try_recv().unwrap().data,
            contracts::EventData::PadChanged(_)
        ));
    }

    #[tokio::test]
    async fn p12_a_failed_removal_keeps_pads_and_emits_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let r1 = call(&daemon, "rail.createWorkstream", json!({"name":"r1"}))
            .await
            .unwrap()["id"]
            .clone();
        call(&daemon, "pad.create", json!({"name":"a"}))
            .await
            .unwrap();
        call(&daemon, "pad.move", json!({"name":"a","home":r1}))
            .await
            .unwrap();
        let before = call(&daemon, "pad.list", Value::Null).await.unwrap();
        let mut events = daemon.bus.subscribe();
        let err = call(&daemon, "rail.remove", json!({"id":"nope"}))
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::NOT_FOUND);
        assert_eq!(
            call(&daemon, "pad.list", Value::Null).await.unwrap(),
            before
        );
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test]
    async fn p12_removal_deletes_only_home_pads_in_name_order() {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::test_daemon(dir.path()).unwrap();
        let r1 = call(&daemon, "rail.createWorkstream", json!({"name":"r1"}))
            .await
            .unwrap()["id"]
            .clone();
        let r2 = call(&daemon, "rail.createWorkstream", json!({"name":"r2"}))
            .await
            .unwrap()["id"]
            .clone();
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute(
            "INSERT INTO nodes(kind,name,parent,ord) SELECT 'agent','kept',?1,COUNT(*) FROM nodes",
            [r1.as_str().unwrap()],
        )
        .unwrap();
        let agent = db.last_insert_rowid().to_string();
        daemon.agents.set_status_for_test(
            &agent,
            contracts::Status {
                kind: contracts::Kind::Idle,
                label: String::new(),
                since: 0,
                finished: "0".into(),
            },
        );
        for (name, home) in [("c", &r1), ("a", &r1), ("b", &r1), ("other", &r2)] {
            call(&daemon, "pad.create", json!({"name":name}))
                .await
                .unwrap();
            call(&daemon, "pad.move", json!({"name":name,"home":home}))
                .await
                .unwrap();
        }
        let kept = call(&daemon, "pad.read", json!({"name":"other"}))
            .await
            .unwrap();
        let mut events = daemon.bus.subscribe();
        call(&daemon, "rail.remove", json!({"id":r1}))
            .await
            .unwrap();
        let tree = call(&daemon, "rail.tree", Value::Null).await.unwrap();
        assert!(!tree.as_array().unwrap().iter().any(|node| node["id"] == r1));
        assert!(
            tree.as_array()
                .unwrap()
                .iter()
                .any(|node| node["id"] == agent)
        );
        let mut names = Vec::new();
        while let Ok(event) = events.try_recv() {
            if let contracts::EventData::PadDeleted(pad) = event.data {
                names.push(pad.name);
            }
        }
        assert_eq!(names, ["a", "b", "c"]);
        for name in &names {
            assert_eq!(
                call(&daemon, "pad.read", json!({"name":name}))
                    .await
                    .unwrap_err()
                    .code,
                rpc::code::NOT_FOUND
            );
        }
        assert_eq!(
            call(&daemon, "pad.list", Value::Null).await.unwrap(),
            json!([kept])
        );
    }

    struct DoorStop {
        entered: mpsc::UnboundedSender<()>,
        release: Semaphore,
    }

    impl DoorStop {
        async fn kill(&self, terminal: &str) -> Result<(), RpcError> {
            assert_eq!(terminal, "door-stop-gate");
            self.entered.send(()).unwrap();
            self.release.acquire().await.unwrap().forget();
            Ok(())
        }
    }

    pub(super) async fn call(
        daemon: &Daemon,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let (events, _) = mpsc::unbounded_channel();
        let mut conn = Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        daemon.route(&mut conn, method, params).await
    }

    async fn progress(other_project: bool) {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        let (entered, mut entries) = mpsc::unbounded_channel();
        let stop = Arc::new(DoorStop {
            entered,
            release: Semaphore::new(0),
        });
        let dependency = stop.clone();
        let a = Arc::new(
            crate::test_daemon_with_agents(first.path(), |agents| {
                agents.with_terminal_kills(move |terminal| {
                    let dependency = dependency.clone();
                    async move { dependency.kill(&terminal).await }
                })
            })
            .unwrap(),
        );
        let b = if other_project {
            Arc::new(crate::test_daemon(second.path()).unwrap())
        } else {
            a.clone()
        };
        let home = call(&b, "rail.createWorkstream", json!({"name":"unrelated"}))
            .await
            .unwrap()["id"]
            .clone();
        let removed = call(&a, "rail.createWorkstream", json!({"name":"removed"}))
            .await
            .unwrap()["id"]
            .clone();
        let db = rusqlite::Connection::open(first.path().join("project.db")).unwrap();
        // The kill dependency is the external Terminal seam. Give the real removal a Door to
        // stop; entry is acknowledged inside KillsTerminals, before its future can complete.
        db.execute(
            "UPDATE nodes SET terminal_id='door-stop-gate' WHERE id=?",
            [removed.as_str().unwrap()],
        )
        .unwrap();
        let removing =
            tokio::spawn(async move { call(&a, "rail.remove", json!({"id":removed})).await });
        tokio::time::timeout(Duration::from_secs(5), entries.recv())
            .await
            .unwrap()
            .unwrap();
        let written = tokio::time::timeout(Duration::from_secs(2), async {
            let todo = call(
                &b,
                "todo.create",
                json!({"title":"made while Door stop waits"}),
            )
            .await
            .unwrap();
            call(&b, "todo.move", json!({"id":todo["id"], "home":home}))
                .await
                .unwrap();
            call(&b, "todo.list", Value::Null).await.unwrap()
        })
        .await;
        // Always drain the accepted removal, including when a restored exclusion makes the
        // completion bound fail. Release cannot turn the earlier timeout into a success.
        stop.release.add_permits(1);
        tokio::time::timeout(Duration::from_secs(5), removing)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let todos = written.expect("Todo write and read complete before Door stop releases");
        assert_eq!(todos.as_array().unwrap().len(), 1);
        assert_eq!(todos[0]["title"], "made while Door stop waits");
        assert_eq!(todos[0]["home"], home);
    }

    #[tokio::test]
    async fn n19_same_project_writes_while_door_stops() {
        progress(false).await;
    }

    #[tokio::test]
    async fn n19_other_project_writes_during_removal() {
        progress(true).await;
    }
    #[tokio::test]
    async fn n18_removal_commit_survives_restart() {
        use std::io::{BufRead, Write};
        use std::process::{Command, Stdio};
        const CHILD: &str = "ROUNDUP_REMOVAL_CHILD";
        if let Some(dir) = std::env::var_os(CHILD) {
            let daemon = crate::test_daemon(std::path::Path::new(&dir)).unwrap();
            let stage = std::env::var("ROUNDUP_REMOVAL_STAGE").unwrap();
            let id = std::env::var("ROUNDUP_REMOVAL_ID").unwrap();
            daemon
                .remove_workstream_observed(
                    &Actor::user(),
                    &id,
                    RemoveScope::This,
                    None,
                    move |phase| {
                        if phase == stage {
                            println!("REMOVAL_GATE");
                            std::io::stdout().flush().unwrap();
                            let mut release = String::new();
                            std::io::stdin().read_line(&mut release).unwrap();
                        }
                    },
                )
                .await
                .unwrap();
            panic!("parent must kill at the acknowledged commit gate");
        }
        for stage in ["before_commit", "after_commit"] {
            let dir = tempfile::tempdir().unwrap();
            let daemon = crate::test_daemon(dir.path()).unwrap();
            let ws = call(&daemon, "rail.createWorkstream", json!({"name":"removed"}))
                .await
                .unwrap()["id"]
                .clone();
            let done = call(&daemon, "todo.create", json!({"title":"done"}))
                .await
                .unwrap()["id"]
                .clone();
            call(&daemon, "todo.move", json!({"id":done,"home":ws}))
                .await
                .unwrap();
            call(&daemon, "todo.complete", json!({"id":done}))
                .await
                .unwrap();
            let kept = call(
                &daemon,
                "todo.create",
                json!({"title":"open", "blockers":[done]}),
            )
            .await
            .unwrap()["id"]
                .clone();
            call(&daemon, "todo.move", json!({"id":kept,"home":ws}))
                .await
                .unwrap();
            call(
                &daemon,
                "pad.create",
                json!({"name":"remove","text":"payload"}),
            )
            .await
            .unwrap();
            call(&daemon, "pad.move", json!({"name":"remove","home":ws}))
                .await
                .unwrap();
            let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
            let touches: i64 = db
                .query_row("SELECT COUNT(*) FROM touches", [], |r| r.get(0))
                .unwrap();
            let before_todos = call(&daemon, "todo.list", Value::Null).await.unwrap();
            let before_pads = call(&daemon, "pad.list", Value::Null).await.unwrap();
            let mut before_rail = call(&daemon, "rail.tree", Value::Null).await.unwrap();
            for node in before_rail.as_array_mut().unwrap() {
                node["status"].as_object_mut().unwrap().remove("since");
            }
            drop(daemon);
            drop(db);
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "removal::tests::n18_removal_commit_survives_restart",
                    "--nocapture",
                ])
                .env(CHILD, dir.path())
                .env("ROUNDUP_REMOVAL_STAGE", stage)
                .env("ROUNDUP_REMOVAL_ID", ws.as_str().unwrap())
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let output = child.stdout.take().unwrap();
            let (send, receive) = std::sync::mpsc::channel();
            let reader = std::thread::spawn(move || {
                for line in std::io::BufReader::new(output).lines() {
                    if line.unwrap() == "REMOVAL_GATE" {
                        send.send(()).unwrap();
                        break;
                    }
                }
            });
            let entered = receive.recv_timeout(Duration::from_secs(10));
            child.kill().unwrap();
            child.wait().unwrap();
            reader.join().unwrap();
            entered.expect("removal acknowledges the commit stage before kill");
            let daemon = crate::test_daemon(dir.path()).unwrap();
            let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
            if stage == "before_commit" {
                let mut after_rail = call(&daemon, "rail.tree", Value::Null).await.unwrap();
                for node in after_rail.as_array_mut().unwrap() {
                    node["status"].as_object_mut().unwrap().remove("since");
                }
                assert_eq!(after_rail, before_rail);
                assert_eq!(
                    call(&daemon, "todo.list", Value::Null).await.unwrap(),
                    before_todos
                );
                assert_eq!(
                    call(&daemon, "pad.list", Value::Null).await.unwrap(),
                    before_pads
                );
                assert_eq!(
                    db.query_row("SELECT COUNT(*) FROM touches", [], |r| r.get::<_, i64>(0))
                        .unwrap(),
                    touches
                );
                call(&daemon, "rail.remove", json!({"id":ws}))
                    .await
                    .unwrap();
            }
            assert_eq!(
                call(&daemon, "rail.tree", Value::Null).await.unwrap(),
                json!([])
            );
            let todos = call(&daemon, "todo.list", Value::Null).await.unwrap();
            assert_eq!(todos.as_array().unwrap().len(), 1);
            assert_eq!(todos[0]["title"], "open");
            assert_eq!(todos[0]["home"], Value::Null);
            assert_eq!(todos[0]["blockers"], json!([]));
            assert_eq!(
                call(&daemon, "pad.list", Value::Null).await.unwrap(),
                json!([])
            );
            assert_eq!(
                db.query_row("SELECT COUNT(*) FROM touches WHERE verb='wrote'", [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                touches + 4
            );
        }
    }
}

#[cfg(test)]
mod redo_tests;
#[cfg(test)]
mod restoration_tests;

#[cfg(test)]
mod refusal_tests;

#[cfg(test)]
mod todo_tests;
