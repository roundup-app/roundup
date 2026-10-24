//! A35: the Door rewinds its children to a Checkpoint with `workstream.rewindPlan` and
//! `workstream.rewind`.
use std::collections::HashMap;
use std::sync::Arc;

use crate::Daemon;
use agents::marks::{MarkResume, Resume};
use contracts::agent::{NodeKind, RailNode};
use contracts::workstream::{
    Files, PlanAgent, Rewind, RewindAgent, RewindParams, RewindPlan, RewindPlanParams, RewindState,
    Rewound,
};
use contracts::{Actor, ActorKind, EventData, Verb};
use rpc::{Module, RpcError, code, params, reply};
use serde_json::{Value, json};
use tokio::sync::Mutex;

#[derive(Default)]
pub(crate) struct Rewinding {
    /// One call at a time per Workstream; the slot keeps an unfinished call's progress for a retry.
    slots: Mutex<HashMap<String, Arc<Mutex<Option<Progress>>>>>,
}

/// The work of one rewind on its selected children.
struct Batch {
    key: String,
    checkpoint: u32,
    files: Files,
    marks: Vec<checkpoints::Mark>,
    later: Vec<String>,
    resume: Resume,
    restored: bool,
}

struct Progress {
    checkpoint: u32,
    files: Files,
    agent: Option<String>,
    title: String,
    outcomes: Vec<RewindAgent>,
    batch: Batch,
}

impl Batch {
    fn new(
        key: String,
        checkpoint: u32,
        files: Files,
        marks: Vec<checkpoints::Mark>,
        later: Vec<String>,
    ) -> Self {
        let retained = marks
            .iter()
            .map(|m| MarkResume::new(m.clone(), None))
            .collect();
        Self {
            key,
            checkpoint,
            files,
            marks,
            resume: Resume::new(retained, later.clone()),
            later,
            restored: false,
        }
    }
}

fn belongs(nodes: &[RailNode], node: &RailNode, id: &str) -> bool {
    let mut at = Some(node);
    while let Some(node) = at {
        if node.id == id {
            return true;
        }
        if node.kind == NodeKind::Workstream {
            return false;
        }
        at = node
            .parent
            .as_ref()
            .and_then(|parent| nodes.iter().find(|n| &n.id == parent));
    }
    false
}

fn name_of(nodes: &[RailNode], id: &str) -> String {
    nodes
        .iter()
        .find(|n| n.id == id)
        .map_or_else(|| id.to_owned(), |n| n.name.clone())
}

impl Daemon {
    /// The children a call selects, sorted. Only the Door of Workstream `id` may ask, and it may
    /// select one child below it or, with no `agent`, every child.
    pub(crate) async fn rewind_children(
        &self,
        actor: &Actor,
        method: &str,
        value: &Value,
    ) -> Result<Vec<String>, RpcError> {
        let (id, agent) = if method == "workstream.rewind" {
            let p: RewindParams = params(value.clone())?;
            (p.id, p.agent)
        } else {
            let p: RewindPlanParams = params(value.clone())?;
            (p.id, p.agent)
        };
        let nodes = self.rail().await?;
        let door = nodes
            .iter()
            .find(|n| n.id == id && n.kind == NodeKind::Workstream)
            .ok_or_else(|| RpcError::not_found(&id))?;
        if actor.kind != ActorKind::Agent || actor.id != door.id {
            return Err(RpcError::forbidden(
                "only the Door of a Workstream rewinds its children",
            ));
        }
        let mut children: Vec<String> = nodes
            .iter()
            .filter(|n| n.kind == NodeKind::Agent && belongs(&nodes, n, &id))
            .map(|n| n.id.clone())
            .collect();
        if let Some(agent) = agent {
            if !nodes.iter().any(|n| n.id == agent) {
                return Err(RpcError::not_found(&agent));
            }
            if !children.contains(&agent) {
                return Err(RpcError::forbidden(format!(
                    "{agent} is not a child of Workstream {id}"
                )));
            }
            children = vec![agent];
        } else if children.is_empty() {
            return Err(RpcError::new(
                code::INVALID_PARAMS,
                "the Workstream has no child to rewind",
            ));
        }
        children.sort();
        children.dedup();
        Ok(children)
    }

    /// The Checkpoint's title and its usable Marks.
    async fn rewind_marks(
        &self,
        nodes: &[RailNode],
        id: &str,
        checkpoint: u32,
    ) -> Result<(String, checkpoints::Marks), RpcError> {
        let door = nodes
            .iter()
            .find(|n| n.id == id && n.kind == NodeKind::Workstream)
            .ok_or_else(|| RpcError::not_found(id))?;
        let cards: Vec<contracts::checkpoint::Checkpoint> = serde_json::from_value(
            self.checkpoints
                .call(
                    &self.ctx(Actor::daemon()),
                    "checkpoint.list",
                    json!({"workstream": id}),
                )
                .await?,
        )
        .map_err(RpcError::internal)?;
        let card = cards
            .iter()
            .find(|c| c.id == checkpoint)
            .ok_or_else(|| RpcError::not_found("Checkpoint"))?;
        let marks = self
            .checkpoints
            .marks(id, checkpoint, door.iteration.unwrap_or(1))?;
        Ok((card.title.clone(), marks))
    }

    /// A removed child must not leave a descendant that is not selected without its parent.
    fn rewind_orphans(
        nodes: &[RailNode],
        selected: &[String],
        marks: &checkpoints::Marks,
    ) -> Result<(), RpcError> {
        for later in selected
            .iter()
            .filter(|c| !marks.agents.iter().any(|m| &m.agent == *c))
        {
            if let Some(orphan) = nodes
                .iter()
                .find(|n| n.id != *later && !selected.contains(&n.id) && belongs(nodes, n, later))
            {
                return Err(RpcError::conflict(format!(
                    "{} started after the Checkpoint; removing it would leave {} without its parent",
                    name_of(nodes, later),
                    orphan.name
                )));
            }
        }
        Ok(())
    }

    pub(crate) async fn rewind_call(
        &self,
        actor: &Actor,
        method: &str,
        value: Value,
        children: Vec<String>,
    ) -> Result<Value, RpcError> {
        if method == "workstream.rewindPlan" {
            let RewindPlanParams { id, checkpoint, .. } = params(value)?;
            return reply(&self.rewind_plan(&id, checkpoint, &children).await?);
        }
        let rewind: RewindParams = params(value)?;
        reply(&self.rewind_run(actor, rewind, children).await?)
    }

    async fn rewind_plan(
        &self,
        id: &str,
        checkpoint: u32,
        children: &[String],
    ) -> Result<RewindPlan, RpcError> {
        let nodes = self.rail().await?;
        let (_, marks) = self.rewind_marks(&nodes, id, checkpoint).await?;
        Self::rewind_orphans(&nodes, children, &marks)?;
        let mut agents = Vec::new();
        for child in children {
            let mark = marks.agents.iter().find(|m| &m.agent == child);
            let files_changed = match mark {
                Some(mark) => agents::marks::changed_files(mark)
                    .await?
                    .iter()
                    .map(|path| String::from_utf8_lossy(path).into_owned())
                    .collect(),
                None => Vec::new(),
            };
            agents.push(PlanAgent {
                agent: child.clone(),
                name: name_of(&nodes, child),
                created_after: mark.is_none(),
                files_changed,
            });
        }
        let files_changed = agents.iter().any(|a| !a.files_changed.is_empty());
        Ok(RewindPlan {
            agents,
            files_changed,
        })
    }

    async fn rewind_run(
        &self,
        actor: &Actor,
        rewind: RewindParams,
        children: Vec<String>,
    ) -> Result<Rewind, RpcError> {
        let RewindParams {
            id,
            checkpoint,
            files,
            agent,
        } = rewind.clone();
        let slot = self
            .rewinding
            .slots
            .lock()
            .await
            .entry(id.clone())
            .or_default()
            .clone();
        let mut slot = slot
            .try_lock()
            .map_err(|_| RpcError::conflict("Workstream is already being rewound"))?;
        let nodes = self.rail().await?;
        if let Some(p) = slot.as_ref() {
            if p.checkpoint != checkpoint || p.files != files || p.agent != agent {
                return Err(RpcError::conflict(
                    "continue the unfinished rewind with the same choices",
                ));
            }
        } else {
            let (title, marks) = self.rewind_marks(&nodes, &id, checkpoint).await?;
            Self::rewind_orphans(&nodes, &children, &marks)?;
            let mut later = Vec::new();
            let mut retained = Vec::new();
            let mut outcomes = Vec::new();
            for child in &children {
                let node = nodes
                    .iter()
                    .find(|n| &n.id == child)
                    .ok_or_else(|| RpcError::not_found(child))?;
                match marks.agents.iter().find(|m| &m.agent == child) {
                    Some(mark) => retained.push(mark.clone()),
                    None => later.push(child.clone()),
                }
                outcomes.push(RewindAgent {
                    agent: child.clone(),
                    name: node.name.clone(),
                    state: if later.contains(child) {
                        RewindState::Removed
                    } else {
                        RewindState::Rewound
                    },
                    reason: None,
                });
            }
            let key = format!(
                "rewind:{id}:{checkpoint}:{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(RpcError::internal)?
                    .as_nanos()
            );
            *slot = Some(Progress {
                checkpoint,
                files,
                agent,
                title,
                outcomes,
                batch: Batch::new(key, checkpoint, files, retained, later),
            });
        }
        let p = slot.as_mut().expect("selected above");
        let ctx = self.ctx(actor.clone());
        self.rewind_batch(&ctx, &id, &mut p.batch).await?;
        let result = Rewind {
            checkpoint: p.title.clone(),
            files,
            agents: p.outcomes.clone(),
        };
        *slot = None;
        drop(slot);
        let ctx = self.ctx(Actor::daemon());
        ctx.emit(EventData::RailChanged);
        ctx.emit(EventData::WorkstreamRewound(Rewound {
            id: id.clone(),
            checkpoint,
        }));
        Ok(result)
    }

    /// Stop, restore and resume the batch's children, as `agent.stop` and A22's resume do. Steps
    /// already done are kept in `batch`, so a retry does not repeat them.
    async fn rewind_batch(
        &self,
        ctx: &rpc::Ctx,
        id: &str,
        batch: &mut Batch,
    ) -> Result<(), RpcError> {
        let messages = self
            .sender
            .get()
            .ok_or_else(|| RpcError::internal("Messages unavailable"))?;
        let retained: Vec<String> = batch.marks.iter().map(|m| m.agent.clone()).collect();
        // Reserve before stopping anything: queued Messages stay put until the restart.
        for agent in &retained {
            messages.reserve_restart(agent, &batch.key, None).await?;
        }
        for agent in &batch.later {
            messages.reserve_retirement(agent, &batch.key).await?;
        }
        self.agents.stop_marks(ctx, &mut batch.resume).await?;
        if !batch.restored {
            if batch.files == Files::Restore {
                for mark in &batch.marks {
                    agents::marks::restore_files(mark).await?;
                }
            }
            batch.restored = true;
        }
        self.agents.resume_marks(ctx, &mut batch.resume).await?;
        let nodes = self.rail().await?;
        for agent in &retained {
            let attempt = nodes
                .iter()
                .find(|n| &n.id == agent)
                .and_then(|n| n.attempt.as_deref())
                .ok_or_else(|| RpcError::conflict("restarted Agent missing"))?;
            messages.release_restart(agent, &batch.key, attempt).await?;
        }
        for agent in &batch.later {
            messages.complete_retirement(agent, &batch.key).await?;
        }
        self.checkpoints.invalidate_after(id, batch.checkpoint)?;
        ctx.touch(Verb::Wrote, &format!("rail:{id}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rpc::Module;

    // Open production stores only: no server, socket, PTY, git or vendor program.
    // Persisted Rail rows model a reopened Project, rather than substituting a Rail module.
    fn fixture() -> (tempfile::TempDir, Daemon) {
        let dir = tempfile::tempdir().unwrap();
        crate::storage::open(dir.path()).unwrap();
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute_batch(
            "INSERT INTO nodes(id,kind,name,parent,ord) VALUES
            (1,'workstream','Door',NULL,0), (2,'agent','Child',1,0),
            (3,'agent','Nested',2,0), (4,'workstream','Other',NULL,1);",
        )
        .unwrap();
        let daemon = crate::tests::daemon_in(dir.path());
        (dir, daemon)
    }

    fn door() -> Actor {
        Actor {
            kind: ActorKind::Agent,
            id: "1".into(),
            parent: None,
        }
    }

    async fn call(
        daemon: &Daemon,
        actor: Actor,
        method: &str,
        params: Value,
    ) -> Result<Value, RpcError> {
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = crate::Conn {
            actor,
            peer: None,
            events,
            output: None,
        };
        let request = json!({"jsonrpc":"2.0", "id":1, "method":method, "params":params});
        let reply = daemon
            .dispatch(&mut conn, &request.to_string(), None)
            .await
            .unwrap();
        if let Some(error) = reply.get("error") {
            Err(serde_json::from_value(error.clone()).unwrap())
        } else {
            Ok(reply["result"].clone())
        }
    }

    fn card(dir: &std::path::Path, id: u32, marks: Option<checkpoints::Marks>) {
        let db = rusqlite::Connection::open(dir.join("project.db")).unwrap();
        db.execute(
            "INSERT INTO checkpoints VALUES ('1',?1,1,'ready','[]')",
            [id],
        )
        .unwrap();
        if let Some(marks) = marks {
            db.execute(
                "INSERT INTO marks(workstream,checkpoint,iteration,content) VALUES ('1',?1,?2,?3)",
                rusqlite::params![id, marks.iteration, serde_json::to_string(&marks).unwrap()],
            )
            .unwrap();
        }
    }

    fn marks() -> checkpoints::Marks {
        checkpoints::Marks {
            iteration: 1,
            agents: vec![],
        }
    }

    async fn listed(daemon: &Daemon) -> Value {
        daemon
            .checkpoints
            .call(
                &daemon.ctx(door()),
                "checkpoint.list",
                json!({"workstream": "1"}),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a35_rewind_refuses_another_workstream_or_its_door() {
        let (_dir, daemon) = fixture();
        let before = daemon.rail().await.unwrap();
        for method in ["workstream.rewind", "workstream.rewindPlan"] {
            for (agent, code) in [
                ("1", code::FORBIDDEN),
                ("4", code::FORBIDDEN),
                ("nobody", code::NOT_FOUND),
            ] {
                let error = call(
                    &daemon,
                    door(),
                    method,
                    json!({"id":"1", "checkpoint":1, "agent":agent, "files":"keep"}),
                )
                .await
                .unwrap_err();
                assert_eq!(error.code, code);
            }
            for (actor, id) in [
                (
                    Actor {
                        id: "4".into(),
                        ..door()
                    },
                    "1",
                ),
                (door(), "4"),
                (Actor::user(), "1"),
                (
                    Actor {
                        id: "2".into(),
                        ..door()
                    },
                    "1",
                ),
            ] {
                assert_eq!(
                    call(
                        &daemon,
                        actor,
                        method,
                        json!({"id":id,"checkpoint":1,"files":"keep"})
                    )
                    .await
                    .unwrap_err()
                    .code,
                    code::FORBIDDEN
                );
            }
            assert_eq!(
                call(
                    &daemon,
                    door(),
                    method,
                    json!({"id":"1","checkpoint":9,"files":"keep"})
                )
                .await
                .unwrap_err()
                .code,
                code::NOT_FOUND
            );
        }
        assert_eq!(daemon.rail().await.unwrap(), before);
        assert!(daemon.terminals.list().is_empty());
    }

    #[tokio::test]
    async fn a35_plan_refuses_an_unrewindable_checkpoint() {
        let (dir, daemon) = fixture();
        card(dir.path(), 1, Some(marks()));
        daemon.checkpoints.invalidate_after("1", 0).unwrap();
        for method in ["workstream.rewind", "workstream.rewindPlan"] {
            assert_eq!(
                call(
                    &daemon,
                    door(),
                    method,
                    json!({"id":"1","checkpoint":1,"files":"keep"})
                )
                .await
                .unwrap_err()
                .code,
                code::CONFLICT
            );
        }
    }

    #[tokio::test]
    async fn a35_an_old_checkpoint_is_not_rewindable() {
        let (dir, daemon) = fixture();
        card(dir.path(), 1, None);
        card(dir.path(), 2, Some(marks()));
        card(dir.path(), 3, Some(marks()));
        daemon.checkpoints.invalidate_after("1", 2).unwrap();
        drop(daemon);
        let daemon = crate::tests::daemon_in(dir.path());
        let cards = listed(&daemon).await;
        assert_eq!(cards.as_array().unwrap().len(), 3);
        assert_eq!(cards[0]["rewindable"], false);
        assert_eq!(cards[1]["rewindable"], true);
        assert_eq!(cards[2]["rewindable"], false);
        for (id, iteration) in [(1, 1), (3, 1), (2, 2)] {
            assert_eq!(
                daemon
                    .checkpoints
                    .marks("1", id, iteration)
                    .unwrap_err()
                    .code,
                code::CONFLICT
            );
        }
    }

    #[tokio::test]
    async fn a35_a_missing_saved_conversation_is_a_recording_failure() {
        let (dir, daemon) = fixture();
        let db = rusqlite::Connection::open(dir.path().join("project.db")).unwrap();
        db.execute("UPDATE nodes SET conversation_id='12345678-1234-4234-8234-123456789abc', conversation_cwd=?1 WHERE id=3",
            [dir.path().to_str().unwrap()]).unwrap();
        let error = daemon
            .checkpoints
            .call(
                &daemon.ctx(door()),
                "checkpoint.write",
                json!({"title":"failed","blocks":[{"kind":"text","text":"facts"}]}),
            )
            .await
            .unwrap_err();
        assert!(error.message.contains("cannot record Mark"), "{error:?}");
        assert_eq!(listed(&daemon).await[0]["rewindable"], false);
        assert_eq!(
            daemon.checkpoints.marks("1", 1, 1).unwrap_err().code,
            code::CONFLICT
        );
    }

    #[tokio::test]
    async fn a35_one_rewind_at_a_time() {
        let (_dir, daemon) = fixture();
        let slot = Arc::new(Mutex::new(None));
        daemon
            .rewinding
            .slots
            .lock()
            .await
            .insert("1".into(), slot.clone());
        let _running = slot.lock().await;
        let error = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            call(
                &daemon,
                door(),
                "workstream.rewind",
                json!({"id":"1","checkpoint":1,"agent":"3","files":"keep"}),
            ),
        )
        .await
        .expect("a contending rewind must refuse rather than wait")
        .unwrap_err();
        assert_eq!(error.code, code::CONFLICT);
        assert!(error.message.contains("already being rewound"));
        assert!(daemon.terminals.list().is_empty());
    }
    #[tokio::test]
    async fn a35_a_selected_later_child_cannot_orphan_an_unselected_descendant() {
        let (dir, daemon) = fixture();
        card(dir.path(), 1, Some(marks()));
        let before = daemon.rail().await.unwrap();
        for method in ["workstream.rewind", "workstream.rewindPlan"] {
            let error = call(
                &daemon,
                door(),
                method,
                json!({"id":"1","checkpoint":1,"agent":"2","files":"keep"}),
            )
            .await
            .unwrap_err();
            assert_eq!(error.code, code::CONFLICT);
            assert!(error.message.contains("Nested"), "{error:?}");
        }
        assert_eq!(daemon.rail().await.unwrap(), before);
        assert!(daemon.terminals.list().is_empty());
    }
}
