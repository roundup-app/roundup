use super::*;

impl Shared {
    pub(super) async fn remove(&self, actor: Actor, id: &str) -> Result<(), RpcError> {
        self.end_with(actor, id, Ending::Remove, RailPublication::Immediate)
            .await
    }

    /// A34/U4461: stop the Door, judge descendants, then remove the chosen contents atomically.
    /// Scope `this` lifts unfinished work; `all` stops descendants and keeps nothing.
    pub(super) async fn remove_workstream(
        self: &Arc<Self>,
        actor: Actor,
        id: &str,
        scope: RemoveScope,
    ) -> Result<Removal, RpcError> {
        self.remove_workstream_with(actor, id, scope, |_, _| Ok(()))
            .await
            .map(|(r, ())| r)
    }

    pub(super) async fn remove_workstream_with<T: Send + 'static>(
        self: &Arc<Self>,
        actor: Actor,
        id: &str,
        scope: RemoveScope,
        apply: impl FnOnce(&rusqlite::Connection, &mut Removal) -> Result<T, RpcError> + Send + 'static,
    ) -> Result<(Removal, T), RpcError> {
        let _lifecycle = self.door_lifecycle.write().await;
        let door = self.rail().node(id)?;
        if scope == RemoveScope::This
            && let Some(worktree) = &door.worktree
        {
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
            for node in below
                .into_iter()
                .filter(|n| scope == RemoveScope::All || n.kind == NodeKind::Agent)
            {
                let reason = if scope == RemoveScope::All {
                    None
                } else {
                    self.keep_reason(&node).await?
                };
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
                if scope == RemoveScope::This && reason.is_none() {
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
                let mut undo = git.prepare_removal(&project, &worktrees, scope)?;
                let mut rail = shared.rail();
                // Recheck the judged tree: a spawn or move during the judgement must be retried.
                let current = rail.tree()?;
                let mut current_below = Vec::new();
                collect_below(&current, &id_owned, &mut current_below);
                let expected: Vec<_> = judged.iter().map(|(n, _)| &n.id).collect();
                let actual: Vec<_> = current_below
                    .iter()
                    .filter(|n| scope == RemoveScope::All || n.kind == NodeKind::Agent)
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
                let result =
                    rail.remove_workstream(&id_owned, &mut removal, None, |db, removal| {
                        let out = apply(db, removal)?;
                        undo.remove(&git, &project)?;
                        Ok(out)
                    });
                match result {
                    Ok(out) => {
                        let mut calls = shared
                            .events
                            .tool_calls
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        for item in &removal.removed {
                            if item.kind == RemovalKind::Agent {
                                runs.remove(&item.id);
                                calls.remove(&item.id);
                            }
                        }
                        runs.remove(&id_owned);
                        calls.remove(&id_owned);
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
        scope: RemoveScope,
        apply: impl FnOnce(&rusqlite::Connection, &mut Removal) -> Result<T, RpcError> + Send + 'static,
    ) -> Result<(Removal, T), RpcError> {
        self.shared.guard_reach(&actor, id, false)?;
        self.shared
            .remove_workstream_with(actor, id, scope, apply)
            .await
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

impl Agents {
    /// Read the retained operation after an uncertain reply, without repeating removal.
    pub fn rail_deletion(
        &self,
        actor: &Actor,
        operation: &str,
    ) -> Result<Option<Removal>, RpcError> {
        self.shared.rail().deletion(actor, operation)
    }

    /// Data-only removal uses the same Project graph transaction as A34. No stop, git,
    /// Terminal close or other external effect is permitted on this path.
    pub async fn remove_reversible_with<T: Send + 'static>(
        &self,
        actor: Actor,
        id: &str,
        operation: &str,
        apply: impl FnOnce(&rusqlite::Connection, &mut Removal) -> Result<T, RpcError> + Send + 'static,
    ) -> Result<(Removal, T), RpcError> {
        let shared = &self.shared;
        let _lifecycle = shared.door_lifecycle.write().await;
        shared.guard_reach(&actor, id, false)?;
        let tree = shared.tree()?;
        let node = tree
            .iter()
            .find(|n| n.id == id)
            .ok_or_else(|| RpcError::not_found("Rail node"))?;
        let mut removal = Removal::default();
        let mut below = Vec::new();
        collect_below(&tree, id, &mut below);
        if node.kind == NodeKind::Workstream {
            for child in &below {
                if let Some(reason) = shared.keep_reason(child).await? {
                    removal.kept.push(kept_agent(child, reason));
                } else {
                    removal.removed.push(RemovedItem {
                        id: child.id.clone(),
                        kind: RemovalKind::Agent,
                        name: child.name.clone(),
                    });
                }
            }
        } else {
            for child in tree.iter().filter(|n| n.parent.as_deref() == Some(id)) {
                removal.kept.push(kept_agent(child, KeptReason::Running));
            }
        }
        let shared = Arc::clone(shared);
        let id = id.to_owned();
        let operation = operation.to_owned();
        let listed = shared.terminals.list().await;
        tokio::task::spawn_blocking(move || {
            let mut rail = shared.rail();
            // A node moved, born or launched during judgement is not consent to remove it.
            let now = rail.tree()?;
            if now.len()!=tree.len() || now.iter().zip(&tree).any(|(a,b)| a.id!=b.id || a.parent!=b.parent || a.order!=b.order || a.attempt!=b.attempt || a.worktree!=b.worktree) {
                return Err(RpcError::conflict("Rail changed during removal judgement"));
            }
            let runs = shared.runs();
            let selected = |n: &&RailNode| n.id == id || removal.removed.iter().any(|i| i.kind==RemovalKind::Agent && i.id==n.id);
            for node in tree.iter().filter(selected) {
                if node.worktree.is_some()
                    || runs.get(&node.id).is_some_and(|slot| !matches!(slot, Slot::Running(run) if run.ended && !run.closing))
                    || listed.iter().any(|t| t.running && (t.owner.as_deref()==Some(&node.id) || node.terminal_id.as_deref()==Some(&t.id))) {
                    return Err(RpcError::conflict("Removing this item would stop a running process or discard its Worktree. Confirm removal to continue."));
                }
            }
            drop(runs);
            let out=rail.remove_workstream(&id,&mut removal,Some((&actor,&operation)),apply)?;
            let result=(removal,out);
            // Ended run facts stay in their existing holder so undo recovers their Status.
            // They own no live process, and cannot be addressed while their Rail row is absent.
            shared.bus.emit(actor, EventData::RailChanged);
            Ok(result)
        }).await.map_err(RpcError::internal)?
    }
}

impl Agents {
    /// Restoration holds the same lifecycle and Rail locks as removal; the owner callback
    /// commits its Project transaction before Rail observers see the restored graph.
    pub async fn restore_reversible_with<T: Send + 'static>(
        &self,
        actor: Actor,
        apply: impl FnOnce() -> Result<(Removal, T), RpcError> + Send + 'static,
    ) -> Result<(Removal, T), RpcError> {
        let _lifecycle = self.shared.door_lifecycle.write().await;
        let shared = Arc::clone(&self.shared);
        tokio::task::spawn_blocking(move || {
            let _rail = shared.rail();
            let result = apply()?;
            shared.bus.emit(actor, EventData::RailChanged);
            Ok(result)
        })
        .await
        .map_err(RpcError::internal)?
    }

    /// Participate in the owning Todo transaction; this starts no processes.
    pub fn restore_reversible_in(
        db: &rusqlite::Connection,
        actor: &Actor,
        p: &contracts::agent::DeletionParams,
    ) -> Result<Removal, RpcError> {
        rail::Rail::restore_removal_in(db, actor, p)
    }
}

impl Agents {
    /// Redo only the retained boundary; this path never stops or launches a program.
    pub async fn redo_reversible_with<T: Send + 'static>(
        &self,
        actor: Actor,
        p: contracts::agent::RedoParams,
        apply: impl FnOnce(&rusqlite::Connection, &mut Removal) -> Result<T, RpcError> + Send + 'static,
    ) -> Result<(Removal, Option<T>), RpcError> {
        let _lifecycle = self.shared.door_lifecycle.write().await;
        let listed = self.shared.terminals.list().await;
        let shared = Arc::clone(&self.shared);
        tokio::task::spawn_blocking(move || {
            let mut rail = shared.rail();
            let source = rail.deletion(&actor,&p.source)?.ok_or_else(||RpcError::not_found("Rail removal"))?;
            if rail.deletion(&actor,&p.operation)?.is_none() {
                let id=&source.deletion.as_ref().expect("retained operation").id;
                let tree=rail.tree()?;
                let runs=shared.runs();
                for node in tree.iter().filter(|n|n.id==*id || source.removed.iter().any(|i|i.kind==RemovalKind::Agent && i.id==n.id)) {
                    if node.worktree.is_some() || runs.get(&node.id).is_some_and(|s|!matches!(s,Slot::Running(r) if r.ended && !r.closing)) || listed.iter().any(|t|t.running && (t.owner.as_deref()==Some(&node.id) || node.terminal_id.as_deref()==Some(&t.id))) {
                        return Err(RpcError::conflict("Redo would stop a program or discard a Worktree; confirm removal instead."));
                    }
                }
            }
            let result=rail.redo_removal(&actor,&p,apply)?;
            if result.1.is_some() {shared.bus.emit(actor,EventData::RailChanged);}
            Ok(result)
        }).await.map_err(RpcError::internal)?
    }

    /// Capture authoritative restored participant values before the owning transaction commits.
    pub fn acknowledge_restoration_in(
        db: &rusqlite::Connection,
        operation: &str,
    ) -> Result<(), RpcError> {
        rail::Rail::acknowledge_restoration_in(db, operation)
    }
}

#[cfg(test)]
mod tests {

    use std::sync::Arc;

    use std::time::Duration;

    use async_trait::async_trait;
    use contracts::agent::{NodeKind, RemoveScope};
    use contracts::terminal::ExitedEvent;
    use contracts::{Actor, EventData, Kind};

    use crate::claude_code::ClaudeCode;
    use crate::{KillsTerminals, Observation, Run, Slot};

    use crate::tests::*;
    fn record_call(shared: &crate::Shared, id: &str) {
        shared
            .observe(
                Actor::daemon(),
                id,
                "1",
                Observation::Signal(serde_json::json!({
                    "hook_event_name": "PreToolUse", "tool_use_id": "call",
                    "tool_name": "Bash", "tool_input": {"command": "pwd"}
                })),
            )
            .unwrap();
        assert!(shared.events.tool_calls.lock().unwrap().contains_key(id));
    }

    #[tokio::test]
    async fn a3342a_removing_agents_leaves_no_tool_call_entries() {
        let (_dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let survivor = running_agent(&shared, None);
        record_call(&shared, &survivor);
        let expected = shared.events.tool_calls.lock().unwrap().clone();
        for finished in [false, true, false, true] {
            let id = running_agent(&shared, None);
            record_call(&shared, &id);
            if finished {
                shared.observe(Actor::daemon(), &id, "1", Observation::Signal(
                    serde_json::json!({"hook_event_name": "PostToolUse", "tool_use_id": "call", "tool_response": "ok"})
                )).unwrap();
            }
            shared.remove(Actor::user(), &id).await.unwrap();
            assert_eq!(*shared.events.tool_calls.lock().unwrap(), expected);
        }
        let silent = running_agent(&shared, None);
        shared.remove(Actor::user(), &silent).await.unwrap();
        assert_eq!(*shared.events.tool_calls.lock().unwrap(), expected);
    }

    #[tokio::test]
    async fn a3342a_a_late_signal_after_removal_adds_no_entry() {
        let (_dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let id = running_agent(&shared, None);
        record_call(&shared, &id);
        shared.remove(Actor::user(), &id).await.unwrap();
        assert!(shared.events.tool_calls.lock().unwrap().is_empty());

        let error = shared
            .observe(
                Actor::daemon(),
                &id,
                "1",
                Observation::Signal(
                    serde_json::json!({"hook_event_name": "PreToolUse", "tool_use_id": "late",
                "tool_name": "Read", "tool_input": {"file_path": "/late"}}),
                ),
            )
            .unwrap_err();

        assert_eq!(error.code, rpc::code::NOT_FOUND);
        assert!(shared.events.tool_calls.lock().unwrap().is_empty());
        assert!(shared.tree().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a3342a_stopping_without_removal_keeps_the_last_call() {
        let (_dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let id = running_agent(&shared, None);
        record_call(&shared, &id);
        shared.observe(Actor::daemon(), &id, "1", Observation::Signal(
            serde_json::json!({"hook_event_name": "PostToolUse", "tool_use_id": "call", "tool_response": "ok"})
        )).unwrap();
        let before = shared.events.tool_calls.lock().unwrap().clone();

        shared.stop(Actor::user(), &id).await.unwrap();

        assert_eq!(*shared.events.tool_calls.lock().unwrap(), before);
        assert_eq!(
            shared.node(&id).unwrap().tool_call.as_ref(),
            Some(&before[&id].call)
        );
    }

    #[tokio::test]
    async fn a3342a_workstream_removal_prunes_only_its_agents() {
        let (_dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
        let ws = shared
            .rail()
            .insert(NodeKind::Workstream, "w", None, None)
            .unwrap()
            .id;
        shared.rail().allocate_attempt(&ws).unwrap();
        shared.runs().insert(
            ws.clone(),
            Slot::Running(Run {
                yolo: false,
                startup_context: true,
                input_started: true,
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
                session_started: None,
                starred: false,
                interrupt: None,
                named: true,
                terminal_id: "1".into(),
                cwd: "/".into(),
            }),
        );
        let finished = running_agent(&shared, Some(&ws));
        let living = running_agent(&shared, Some(&ws));
        let sibling = shared
            .rail()
            .insert(NodeKind::Workstream, "sibling", None, None)
            .unwrap()
            .id;
        let survivor = running_agent(&shared, Some(&sibling));
        for id in [&ws, &finished, &living, &survivor] {
            record_call(&shared, id);
        }
        shared
            .observe(
                Actor::daemon(),
                &finished,
                "1",
                Observation::Signal(serde_json::json!({"hook_event_name": "SessionEnd"})),
            )
            .unwrap();
        let before = shared.events.tool_calls.lock().unwrap().clone();

        let removal = shared
            .remove_workstream(Actor::user(), &ws, RemoveScope::This)
            .await
            .unwrap();

        assert!(removal.removed.iter().any(|item| item.id == finished));
        assert!(removal.kept.iter().any(|item| item.id == living));
        assert_eq!(shared.node(&living).unwrap().parent, None);
        assert_eq!(
            shared.node(&survivor).unwrap().parent.as_deref(),
            Some(sibling.as_str())
        );
        let calls = shared.events.tool_calls.lock().unwrap();
        assert!(!calls.contains_key(&ws));
        assert!(!calls.contains_key(&finished));
        assert_eq!(calls.len(), 2);
        for id in [&living, &survivor] {
            assert_eq!(calls.get(id), before.get(id));
        }
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
                input_started: true,
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
                session_started: None,
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
        let removal =
            shared.remove_workstream_with(Actor::daemon(), &ws, RemoveScope::This, |_, _| Ok(()));
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
        let parked = running_agent(&shared, Some(&ws));
        for (id, terminal) in [(&failed, "failed"), (&parked, "parked")] {
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
            .find(|node| node.id == parked)
            .unwrap()
            .terminal_id = None;
        let applied = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let applied_by_transaction = applied.clone();
        let removal =
            shared.remove_workstream_with(Actor::daemon(), &ws, RemoveScope::This, move |_, _| {
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
        // There is no completion signal while shutdown is deliberately parked.
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
        for id in [&failed, &parked] {
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
    async fn a3342a_a_failed_removal_keeps_the_entries() {
        let (_dir, shared) = shared_with_a_flaky_kill();
        let id = running_agent(&shared, None);
        record_call(&shared, &id);
        let before = shared.events.tool_calls.lock().unwrap().clone();

        let err = shared.remove(Actor::daemon(), &id).await.unwrap_err();

        assert_eq!(err.code, rpc::code::INTERNAL);
        let node = shared.node(&id).unwrap();
        assert_eq!(node.status.unwrap().kind, Kind::Done);
        assert_eq!(*shared.events.tool_calls.lock().unwrap(), before);

        shared.remove(Actor::daemon(), &id).await.unwrap();

        assert!(shared.rail().tree().unwrap().is_empty());
        assert!(shared.events.tool_calls.lock().unwrap().is_empty());
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
    async fn a3342a_a_failed_deletion_keeps_the_entries() {
        for workstream in [false, true] {
            let (dir, _, shared) = shared_over_temp_dir(Arc::new(|| 0));
            let ws = workstream.then(|| {
                shared
                    .rail()
                    .insert(NodeKind::Workstream, "w", None, None)
                    .unwrap()
                    .id
            });
            let id = running_agent(&shared, ws.as_deref());
            record_call(&shared, &id);
            if workstream {
                shared
                    .observe(
                        Actor::daemon(),
                        &id,
                        "1",
                        Observation::Signal(serde_json::json!({"hook_event_name": "SessionEnd"})),
                    )
                    .unwrap();
            }
            let before = shared.events.tool_calls.lock().unwrap().clone();
            let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
            db.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON nodes BEGIN SELECT RAISE(ABORT,'delete refused'); END;").unwrap();
            let error = if let Some(ws) = &ws {
                shared
                    .remove_workstream(Actor::user(), ws, RemoveScope::This)
                    .await
                    .unwrap_err()
            } else {
                shared.remove(Actor::user(), &id).await.unwrap_err()
            };
            assert_eq!(error.code, rpc::code::INTERNAL);
            assert_eq!(shared.tree().unwrap().len(), if workstream { 2 } else { 1 });
            assert_eq!(shared.node(&id).unwrap().status.unwrap().kind, Kind::Done);
            assert_eq!(*shared.events.tool_calls.lock().unwrap(), before);
            db.execute_batch("DROP TRIGGER fail_delete").unwrap();
            if let Some(ws) = &ws {
                shared
                    .remove_workstream(Actor::user(), ws, RemoveScope::This)
                    .await
                    .unwrap();
            } else {
                shared.remove(Actor::user(), &id).await.unwrap();
            }
            assert!(shared.tree().unwrap().is_empty());
            assert!(shared.events.tool_calls.lock().unwrap().is_empty());
        }
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
