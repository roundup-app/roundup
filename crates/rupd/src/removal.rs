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
        let _storage = self.storage_calls.write().await;
        let attachments = [
            ("removal_todos", "todos.db"),
            ("removal_pads", "pads.db"),
            ("removal_touches", "provenance.db"),
        ]
        .into_iter()
        .map(|(name, file)| (name, self.data_dir.join(file)))
        .collect();
        let todos = Arc::clone(&self.todos);
        let pads = Arc::clone(&self.pads);
        let home = id.to_owned();
        let caller = actor.clone();
        let (removal, (files, events)) = self.agents.remove_workstream_with(
            actor.clone(), id, attachments, move |db, removal| {
                let mut events = todos.remove_workstream(db, &home, removal)?;
                let (files, pad_events) = pads.remove_workstream(db, &home, removal)?;
                events.extend(pad_events);
                // Touch rows use the same transaction: a rejected removal leaves no write
                // record, even if earlier Todo, Pad or Agent steps succeeded.
                let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                    .map_err(RpcError::internal)?.as_millis();
                let at = i64::try_from(at).map_err(RpcError::internal)?;
                let touch = |actor: &Actor, item: String| -> Result<(), RpcError> {
                    let kind = serde_json::to_value(actor.kind).map_err(RpcError::internal)?;
                    db.execute("INSERT INTO removal_touches.touches (actor_kind, actor_id, actor_parent, verb, item, at) VALUES (?, ?, ?, 'wrote', ?, ?)",
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
                Ok((files, events))
            },
        ).await?;
        files.commit();
        for event in events {
            self.bus.emit(Actor::daemon(), event);
        }
        rpc::reply(&removal)
    }
}
