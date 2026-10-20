use super::*;

impl Shared {
    pub(super) async fn remove(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        self.end_with(actor, id, Ending::Remove, RailPublication::Immediate)
            .await
    }

    /// A34: remove Workstream `id`. The Door stops first; every Agent under it is judged before any
    /// moves; then finished Agents go, the rest move to the Project root, and the Workstream goes last.
    pub(super) async fn remove_workstream(
        self: &Arc<Self>,
        actor: Actor,
        id: &str,
    ) -> Result<Removal, RpcError> {
        self.remove_workstream_with(actor, id, |_, _| Ok(()))
            .await
            .map(|(r, ())| r)
    }

    pub(super) async fn remove_workstream_with<T: Send + 'static>(
        self: &Arc<Self>,
        actor: Actor,
        id: &str,
        apply: impl FnOnce(&rusqlite::Connection, &mut Removal) -> Result<T, RpcError> + Send + 'static,
    ) -> Result<(Removal, T), RpcError> {
        let _lifecycle = self.door_lifecycle.write().await;
        let door = self.rail().node(id)?;
        if let Some(worktree) = &door.worktree {
            let git = self.git.bounded();
            let project = self.project_dir.clone();
            let worktree = worktree::Worktree::from(worktree);
            tokio::task::spawn_blocking(move || git.require_landed(&project, &worktree))
                .await
                .map_err(RpcError::internal)??;
        }
        let mut stopped_live = false;
        let result = async {
            self.end_with(
                actor.clone(),
                id,
                Ending::StopForRemoval,
                RailPublication::Coordinator,
            )
            .await?;
            stopped_live = door.terminal_id.is_some();
            let tree = self.tree()?;
            let mut below = Vec::new();
            collect_below(&tree, id, &mut below);
            let mut judged = Vec::new();
            for node in below.into_iter().filter(|n| n.kind == NodeKind::Agent) {
                let reason = self.keep_reason(&node).await?;
                judged.push((node, reason));
            }
            // D9: overlap finite exit waits so sixteen removable Agents do not exceed
            // the App bound. Drain every accepted stop even when another stop fails;
            // returning early would abandon its closing slot and race a removal retry.
            let mut stops = tokio::task::JoinSet::new();
            for (node, reason) in &judged {
                if reason.is_none() {
                    let shared = Arc::clone(self);
                    let actor = actor.clone();
                    let id = node.id.clone();
                    stopped_live |= node.terminal_id.is_some();
                    stops.spawn(async move {
                        shared
                            .end_with(
                                actor,
                                &id,
                                Ending::StopForRemoval,
                                RailPublication::Coordinator,
                            )
                            .await
                    });
                }
            }
            let mut failure = None;
            while let Some(result) = stops.join_next().await {
                if let Err(err) = result.map_err(RpcError::internal).and_then(|r| r) {
                    failure.get_or_insert(err);
                }
            }
            if let Some(err) = failure {
                return Err(err);
            }
            // G5: rejudge after every stop completes, before any file or row changes.
            for (node, reason) in &mut judged {
                if reason.is_none() {
                    *reason = self.keep_reason(node).await?;
                }
            }
            let mut removal = Removal::default();
            let mut worktrees = Vec::new();
            for (node, reason) in &judged {
                if let Some(reason) = reason {
                    removal.kept.push(kept_agent(node, *reason));
                } else {
                    removal.removed.push(RemovedItem {
                        id: node.id.clone(),
                        kind: RemovalKind::Agent,
                        name: node.name.clone(),
                    });
                    if let Some(worktree) = &node.worktree {
                        worktrees.push(worktree::Worktree::from(worktree));
                    }
                }
            }
            if let Some(worktree) = &door.worktree {
                worktrees.push(worktree::Worktree::from(worktree));
            }
            let git = self.git.bounded();
            let project = self.project_dir.clone();
            let id_owned = id.to_owned();
            // Only SQLite and git run in the blocking task; no Agent or Terminal waits while a
            // storage transaction is open.
            let shared = Arc::clone(self);
            let (removal, out) = tokio::task::spawn_blocking(move || {
                let mut undo = git.prepare_removal(&project, &worktrees)?;
                let mut rail = shared.rail();
                // Recheck the judged tree: a spawn or move during the judgement must be retried.
                let current = rail.tree()?;
                let mut current_below = Vec::new();
                collect_below(&current, &id_owned, &mut current_below);
                let expected: Vec<_> = judged.iter().map(|(n, _)| &n.id).collect();
                let actual: Vec<_> = current_below
                    .iter()
                    .filter(|n| n.kind == NodeKind::Agent)
                    .map(|n| &n.id)
                    .collect();
                if expected != actual {
                    return Err(RpcError::conflict(
                        "Workstream changed during removal judgement",
                    ));
                }
                let mut runs = shared.runs();
                let current_door = current.iter().find(|n| n.id == id_owned).ok_or_else(|| {
                    RpcError::not_found("Workstream changed during removal judgement")
                })?;
                if current_door.worktree != door.worktree
                    || current_door.attempt != door.attempt
                    || runs
                        .get(&id_owned)
                        .is_some_and(|slot| !matches!(slot, Slot::Running(r) if r.ended))
                {
                    return Err(RpcError::conflict("Door changed during removal judgement"));
                }
                for (node, reason) in &judged {
                    let unchanged = current.iter().any(|n| {
                        n.id == node.id
                            && n.parent == node.parent
                            && n.worktree == node.worktree
                            && n.attempt == node.attempt
                    });
                    if !unchanged
                        || (reason.is_none()
                            && runs
                                .get(&node.id)
                                .is_some_and(|slot| !matches!(slot, Slot::Running(r) if r.ended)))
                    {
                        return Err(RpcError::conflict("Agent changed during removal judgement"));
                    }
                }
                let rail_removal = removal.clone();
                let result = rail.remove_workstream(&id_owned, &rail_removal, |db| {
                    let out = apply(db, &mut removal)?;
                    undo.remove(&git, &project)?;
                    Ok(out)
                });
                match result {
                    Ok(out) => {
                        for item in &removal.removed {
                            if item.kind == RemovalKind::Agent {
                                runs.remove(&item.id);
                            }
                        }
                        runs.remove(&id_owned);
                        Ok((removal, out))
                    }
                    Err(err) => {
                        undo.restore(&git.bounded(), &project)?;
                        Err(err)
                    }
                }
            })
            .await
            .map_err(RpcError::internal)??;
            for item in &removal.removed {
                if item.kind == RemovalKind::Agent {
                    report_undo(
                        "close the node's Terminals",
                        self.terminals.close_owned_by(&item.id).await,
                    );
                }
            }
            report_undo(
                "close the Workstream's Terminals",
                self.terminals.close_owned_by(id).await,
            );
            self.bus.emit(actor.clone(), EventData::RailChanged);
            Ok((removal, out))
        }
        .await;
        // G5 permits a stopped Door to remain after failure. A22 still requires the App
        // to refetch its now-resumable node; this announces no deletion or Home change.
        if result.is_err() && stopped_live {
            self.bus.emit(actor, EventData::RailChanged);
        }
        result
    }

    /// A34: why Agent `node` stays when its Workstream goes; `None` when it goes with it.
    pub(super) async fn keep_reason(
        &self,
        node: &RailNode,
    ) -> Result<Option<KeptReason>, RpcError> {
        let finished = node
            .status
            .as_ref()
            .is_some_and(|s| matches!(s.kind, Kind::Done | Kind::Error));
        if !finished {
            return Ok(Some(KeptReason::Running));
        }
        let Some(worktree) = node.worktree.as_ref() else {
            return Ok(None);
        };
        let git = self.git.bounded();
        let project = self.project_dir.clone();
        let worktree = worktree::Worktree::from(worktree);
        let (dirty, ahead) = tokio::task::spawn_blocking(move || git.unlanded(&project, &worktree))
            .await
            .map_err(RpcError::internal)??;
        Ok(if ahead != 0 {
            Some(KeptReason::Ahead)
        } else if dirty != 0 {
            Some(KeptReason::Dirty)
        } else {
            None
        })
    }
}

impl Agents {
    /// H11: Steer Agent `id` with `text`. The one function that writes a prompt to a Terminal;
    /// `agent.prompt` and the mailbox series' in-process delivery both call it.
    /// A32: stop the Agent `id` and take it off the Rail; its Worktree and branch stay.
    pub async fn retire(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        self.shared.retire(actor, id).await
    }

    /// A34: extend the Project removal transaction. `apply` returns a file
    /// rollback guard, which is dropped on any later failure and returned only after commit.
    pub async fn remove_workstream_with<T: Send + 'static>(
        &self,
        actor: Actor,
        id: &str,
        apply: impl FnOnce(&rusqlite::Connection, &mut Removal) -> Result<T, RpcError> + Send + 'static,
    ) -> Result<(Removal, T), RpcError> {
        self.shared.guard_reach(&actor, id, false)?;
        self.shared.remove_workstream_with(actor, id, apply).await
    }
}

/// The nodes under `id` at any depth, each parent before its children.
pub(super) fn collect_below(tree: &[RailNode], id: &str, out: &mut Vec<RailNode>) {
    let mut children: Vec<&RailNode> = tree
        .iter()
        .filter(|n| n.parent.as_deref() == Some(id))
        .collect();
    children.sort_by_key(|n| n.order);
    for child in children {
        out.push(child.clone());
        collect_below(tree, &child.id, out);
    }
}

pub(super) fn kept_agent(node: &RailNode, reason: KeptReason) -> KeptItem {
    KeptItem {
        id: node.id.clone(),
        kind: RemovalKind::Agent,
        name: node.name.clone(),
        reason,
    }
}

#[cfg(test)]
mod tests {

    use std::sync::Arc;

    use std::time::Duration;

    use async_trait::async_trait;
    use contracts::agent::NodeKind;
    use contracts::terminal::ExitedEvent;
    use contracts::{Actor, EventData, Kind};

    use crate::claude_code::ClaudeCode;
    use crate::{KillsTerminals, Observation, Run, Slot};

    use crate::tests::*;
    #[tokio::test]
    async fn a16_a_failed_stop_returns_the_error_and_deletes_nothing() {
        let shared = shared_with_a_failing_kill();
        let id = running_agent(&shared, None);

        let err = shared.remove(Actor::daemon(), &id).await.unwrap_err();

        assert_eq!(err.code, rpc::code::INTERNAL);
        assert_eq!(shared.rail().tree().unwrap().len(), 1);
    }
    /// A Door whose kill fails must not have its children lifted either: `stop` returning
    /// early before it calls `lift_children` is what this proves.
    #[tokio::test]
    async fn a16_a_failed_stop_of_a_door_leaves_its_children_in_place() {
        let shared = shared_with_a_failing_kill();
        let group = shared
            .rail()
            .insert(NodeKind::Workstream, "g", None, None)
            .unwrap()
            .id;
        shared.rail().allocate_attempt(&group).unwrap();
        shared.runs().insert(
            group.clone(),
            Slot::Running(Run {
                yolo: false,
                startup_context: true,
                attempt: "1".into(),
                status_revision: 1,
                closing: false,
                ended: false,
                adapter: ClaudeCode::starting(|| 0),
                prompt: None,
                first_pending: false,
                first_completion: None,
                first_prompt: None,
                steer: None,
                session_started: false,
                starred: false,
                interrupt: None,
                named: true,
                terminal_id: "1".into(),
                cwd: "/".into(),
            }),
        );
        let child = shared
            .rail()
            .insert(NodeKind::Agent, "child", Some(&group), None)
            .unwrap()
            .id;

        shared.remove(Actor::daemon(), &group).await.unwrap_err();

        let tree = shared.rail().tree().unwrap();
        let child_node = tree.iter().find(|n| n.id == child).unwrap();
        assert_eq!(child_node.parent.as_deref(), Some(group.as_str()));
    }
    #[tokio::test]
    async fn a16_a_failed_kill_of_a_terminal_returns_the_error_and_deletes_nothing() {
        let shared = shared_with_a_failing_kill();
        let id = terminal_node(&shared, None);

        let err = shared.remove(Actor::daemon(), &id).await.unwrap_err();

        assert_eq!(err.code, rpc::code::INTERNAL);
        assert_eq!(shared.rail().tree().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn d9_workstream_removal_enters_all_sixteen_stops_before_any_is_released() {
        use crate::AgentAdapter;
        struct Shutdown {
            entered: tokio::sync::mpsc::UnboundedSender<()>,
            release: tokio::sync::Semaphore,
        }
        #[async_trait]
        impl KillsTerminals for Shutdown {
            async fn kill(&self, _id: &str) -> Result<(), rpc::RpcError> {
                self.entered.send(()).unwrap();
                self.release.acquire().await.unwrap().forget();
                Ok(())
            }
        }
        let (entered, mut entries) = tokio::sync::mpsc::unbounded_channel();
        let shutdown = Arc::new(Shutdown {
            entered,
            release: tokio::sync::Semaphore::new(0),
        });
        let mut shared = shared_with_a_failing_kill();
        Arc::get_mut(&mut shared).unwrap().ending.kill = shutdown.clone();
        let ws = shared
            .rail()
            .insert(NodeKind::Workstream, "w", None, None)
            .unwrap()
            .id;
        for _ in 0..16 {
            let id = running_agent(&shared, Some(&ws));
            let mut runs = shared.runs();
            let Slot::Running(run) = runs.get_mut(&id).unwrap() else {
                unreachable!()
            };
            run.adapter.observe(Observation::Signal(
                serde_json::json!({"hook_event_name": "SessionEnd"}),
            ));
        }
        let removal = shared.remove_workstream_with(Actor::daemon(), &ws, |_, _| Ok(()));
        tokio::pin!(removal);
        // Entry/release proves overlap without depending on the OS's PTY hangup behavior.
        tokio::time::timeout(Duration::from_secs(5), async {
            for _ in 0..16 {
                tokio::select! {
                    entry = entries.recv() => entry.unwrap(),
                    result = &mut removal => panic!("stop completed before release: {result:?}"),
                }
            }
        })
        .await
        .expect("all sixteen shutdowns overlap");
        shutdown.release.add_permits(16);
        tokio::time::timeout(Duration::from_secs(5), removal)
            .await
            .unwrap()
            .unwrap();
        assert!(shared.rail().tree().unwrap().is_empty());
    }
    #[tokio::test]
    async fn a34_a_failed_stop_waits_for_every_accepted_stop_before_returning() {
        use crate::AgentAdapter;
        struct Shutdown {
            entered: tokio::sync::mpsc::UnboundedSender<String>,
            release: tokio::sync::Semaphore,
        }
        #[async_trait]
        impl KillsTerminals for Shutdown {
            async fn kill(&self, id: &str) -> Result<(), rpc::RpcError> {
                self.entered.send(id.to_owned()).unwrap();
                if id == "failed" {
                    return Err(rpc::RpcError::internal("shutdown refused"));
                }
                self.release.acquire().await.unwrap().forget();
                Ok(())
            }
        }
        let (entered, mut entries) = tokio::sync::mpsc::unbounded_channel();
        let shutdown = Arc::new(Shutdown {
            entered,
            release: tokio::sync::Semaphore::new(0),
        });
        let mut shared = shared_with_a_failing_kill();
        Arc::get_mut(&mut shared).unwrap().ending.kill = shutdown.clone();
        let ws = shared
            .rail()
            .insert(NodeKind::Workstream, "w", None, None)
            .unwrap()
            .id;
        let failed = running_agent(&shared, Some(&ws));
        let held = running_agent(&shared, Some(&ws));
        for (id, terminal) in [(&failed, "failed"), (&held, "held")] {
            let mut runs = shared.runs();
            let Slot::Running(run) = runs.get_mut(id).unwrap() else {
                unreachable!()
            };
            run.terminal_id = terminal.into();
            run.adapter.observe(Observation::Signal(
                serde_json::json!({"hook_event_name": "SessionEnd"}),
            ));
        }
        let mut before = shared.rail().tree().unwrap();
        before
            .iter_mut()
            .find(|node| node.id == held)
            .unwrap()
            .terminal_id = None;
        let applied = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let applied_by_transaction = applied.clone();
        let removal = shared.remove_workstream_with(Actor::daemon(), &ws, move |_, _| {
            applied_by_transaction.store(true, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        });
        tokio::pin!(removal);
        for _ in 0..2 {
            tokio::select! {
                entry = entries.recv() => { entry.unwrap(); }
                result = &mut removal => panic!("accepted stop abandoned: {result:?}"),
            }
        }
        // There is no completion signal while shutdown is deliberately held.
        assert!(
            tokio::time::timeout(Duration::from_millis(100), &mut removal)
                .await
                .is_err()
        );
        shutdown.release.add_permits(1);
        let err = tokio::time::timeout(Duration::from_secs(5), removal)
            .await
            .unwrap()
            .unwrap_err();
        assert_eq!(err.code, rpc::code::INTERNAL);
        assert!(!applied.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(shared.rail().tree().unwrap(), before);
        for id in [&failed, &held] {
            let runs = shared.runs();
            let Slot::Running(run) = runs.get(id).unwrap() else {
                unreachable!()
            };
            assert!(!run.closing);
        }
    }
    /// The Status a failed stop leaves (`done`, from `agent.stop`'s own Stopped observation, set
    /// before the kill that then fails) is exactly what lets a second `rail.remove` retry and
    /// succeed.
    #[tokio::test]
    async fn a16_a_failed_stops_done_status_lets_a_second_remove_retry_and_succeed() {
        let (_dir, shared) = shared_with_a_flaky_kill();
        let id = running_agent(&shared, None);

        let err = shared.remove(Actor::daemon(), &id).await.unwrap_err();

        assert_eq!(err.code, rpc::code::INTERNAL);
        let node = shared.node(&id).unwrap();
        assert_eq!(node.status.unwrap().kind, Kind::Done);

        shared.remove(Actor::daemon(), &id).await.unwrap();

        assert!(shared.rail().tree().unwrap().is_empty());
    }
    /// `remove`'s eviction of `id` from `runs` can race a Terminal exit already in flight: the
    /// watcher must end quietly, not panic through `REGISTERED`'s `.expect`.
    #[tokio::test(start_paused = true)]
    async fn a16_a_terminal_exit_after_its_id_is_evicted_from_runs_does_not_panic_the_watcher() {
        let w = Watched::start();
        w.shared.runs().remove("1");

        w.send(EventData::TerminalExited(ExitedEvent {
            id: "1".into(),
            code: Some(0),
        }));

        tokio::time::timeout(PATIENCE, w.watcher)
            .await
            .expect("the watch ends")
            .unwrap();
    }

    #[tokio::test]
    async fn a16_a_delete_failure_after_a_successful_stop_leaves_the_node_with_its_exited_agent() {
        let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let id = running_agent(&shared, None);
        let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
        db.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON nodes BEGIN SELECT RAISE(ABORT,'delete refused'); END;").unwrap();
        let error = shared.remove(Actor::user(), &id).await.unwrap_err();
        assert_eq!(error.code, rpc::code::INTERNAL);
        let tree = shared.tree().unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].id, id);
        assert_eq!(tree[0].status.as_ref().unwrap().kind, Kind::Done);
        db.execute_batch("DROP TRIGGER fail_delete").unwrap();
        shared.remove(Actor::user(), &id).await.unwrap();
        assert!(shared.tree().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a16_a_workstreams_failed_delete_leaves_its_children_under_it() {
        let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let group = shared
            .rail()
            .insert(NodeKind::Workstream, "group", None, None)
            .unwrap()
            .id;
        let child = running_agent(&shared, Some(&group));
        let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
        db.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON nodes BEGIN SELECT RAISE(ABORT,'delete refused'); END;").unwrap();
        let error = shared.remove(Actor::user(), &group).await.unwrap_err();
        assert_eq!(error.code, rpc::code::INTERNAL);
        assert_eq!(
            shared.node(&child).unwrap().parent.as_deref(),
            Some(group.as_str())
        );
        db.execute_batch("DROP TRIGGER fail_delete").unwrap();
        shared.remove(Actor::user(), &group).await.unwrap();
        let tree = shared.tree().unwrap();
        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].id, child);
        assert_eq!(tree[0].parent, None);
    }
}
