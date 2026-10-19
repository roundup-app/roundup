//! A34: one coordinated removal, including deferred publication and Provenance.

use std::sync::Arc;

use contracts::Actor;
use rpc::RpcError;
use rusqlite::params;
use serde_json::Value;

use crate::Daemon;

impl Daemon {
    pub(crate) async fn remove_workstream(
        &self,
        actor: &Actor,
        id: &str,
    ) -> Result<Value, RpcError> {
        self.remove_workstream_observed(actor, id, |_| {}).await
    }

    async fn remove_workstream_observed(
        &self,
        actor: &Actor,
        id: &str,
        observe: impl Fn(&str) + Send + Sync + 'static,
    ) -> Result<Value, RpcError> {
        let observe = Arc::new(observe);
        let before = Arc::clone(&observe);
        let todos = Arc::clone(&self.todos);
        let pads = Arc::clone(&self.pads);
        let home = id.to_owned();
        let caller = actor.clone();
        let (removal, (files, events)) = self.agents.remove_workstream_with(
            actor.clone(), id, move |db, removal| {
                let mut events = todos.remove_workstream(db, &home, removal)?;
                let (files, pad_events) = pads.remove_workstream(db, &home, removal)?;
                events.extend(pad_events);
                db.execute("UPDATE deliverables SET home=NULL, record=json_set(record,'$.home',NULL) WHERE home=?1 AND removed=0",[&home]).map_err(RpcError::internal)?;
                // Touch rows use the same transaction: a rejected removal leaves no write
                // record, even if earlier Todo, Pad or Agent steps succeeded.
                let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                    .map_err(RpcError::internal)?.as_millis();
                let at = i64::try_from(at).map_err(RpcError::internal)?;
                let touch = |actor: &Actor, item: String| -> Result<(), RpcError> {
                    let kind = serde_json::to_value(actor.kind).map_err(RpcError::internal)?;
                    db.execute("INSERT INTO touches (actor_kind, actor_id, actor_parent, verb, item, at) VALUES (?, ?, ?, 'wrote', ?, ?)",
                        params![kind.as_str(), actor.id, actor.parent, item, at]).map_err(RpcError::internal)?;
                    Ok(())
                };
                for item in removal.removed.iter().map(|i| (&i.id, i.kind))
                    .chain(removal.kept.iter().map(|i| (&i.id, i.kind))) {
                    use contracts::agent::RemovalKind;
                    match item.1 {
                        RemovalKind::Agent => touch(&caller, format!("rail:{}", item.0))?,
                        RemovalKind::Todo => touch(&Actor::daemon(), format!("todo:{}", item.0))?,
                        RemovalKind::Pad => touch(&Actor::daemon(), format!("pad:{}", item.0))?,
                    }
                }
                touch(&caller, format!("rail:{home}"))?;
                before("before_commit");
                Ok((files, events))
            },
        ).await?;
        observe("after_commit");
        files.commit();
        for event in events {
            self.bus.emit(Actor::daemon(), event);
        }
        rpc::reply(&removal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Conn;
    use serde_json::json;
    use std::time::Duration;
    use tokio::sync::{Semaphore, mpsc};

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

    async fn call(daemon: &Daemon, method: &str, params: Value) -> Result<Value, RpcError> {
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
                .remove_workstream_observed(&Actor::user(), &id, move |phase| {
                    if phase == stage {
                        println!("REMOVAL_GATE");
                        std::io::stdout().flush().unwrap();
                        let mut release = String::new();
                        std::io::stdin().read_line(&mut release).unwrap();
                    }
                })
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
