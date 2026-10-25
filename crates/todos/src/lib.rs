//! Todos: items with blockers, in SQLite. Owner: todos Builder.

mod comments;
mod cycle;
mod handoff;
#[doc(hidden)]
pub mod schema;
mod store;

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;
use contracts::todo::{
    AssignParams, CreateParams, History, MoveParams, ReadHistoryParams, RefParams, ReorderParams,
    SetBlockersParams, TodoId, UpdateParams,
};
use contracts::{EventData, Verb};
use rpc::{Bus, Ctx, Module, OpenError, RpcError, params, reply};
use serde_json::Value;
use store::Store;

pub struct Todos {
    store: Mutex<Store>,
}

impl Todos {
    /// `dir` is the Project's data folder (N1). `bus` is for events no call caused.
    pub fn open(dir: &Path, _bus: Bus) -> Result<Self, OpenError> {
        Ok(Self {
            store: Mutex::new(Store::open(&dir.join(
                if dir.join("project.db").exists() {
                    "project.db"
                } else {
                    "todos.db"
                },
            ))?),
        })
    }

    /// A34: apply this Workstream's Todos through the coordinator's Project transaction.
    /// Events are returned for publication only after every store and the Rail commit.
    pub fn remove_workstream(
        &self,
        db: &rusqlite::Connection,
        id: &str,
        actor: &contracts::Actor,
        removal: &mut contracts::agent::Removal,
    ) -> Result<Vec<EventData>, RpcError> {
        self.store()?.remove_workstream(db, id, actor, removal)
    }

    /// The creator is the calling Actor; a `creator` field sent in the params is ignored.
    fn create(&self, ctx: &Ctx, p: CreateParams) -> Result<Value, RpcError> {
        let todo = self.store()?.insert(
            &p.title,
            &p.body.unwrap_or_default(),
            &p.blockers.unwrap_or_default(),
            &ctx.actor,
            p.owner.as_ref(),
            valid_estimate(p.estimate_minutes)?,
            ctx.touches.sequence().map_err(RpcError::internal)?,
        )?;
        ctx.touch(Verb::Wrote, &item(todo.id))?;
        ctx.emit(EventData::TodoCreated(todo.clone().into()));
        reply(&todo)
    }

    fn get(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        let through = store
            .history(p.id)?
            .last()
            .map_or(0, |(change, _)| change.seq);
        ctx.touches
            .record_todo_read(&ctx.actor, &item(p.id), through)
            .map_err(RpcError::internal)?;
        reply(&todo)
    }

    fn get_history(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let rows = store.history(p.id)?;
        let read = ctx
            .touches
            .todo_read(&ctx.actor, &item(p.id))
            .map_err(RpcError::internal)?;
        let unread = rows
            .iter()
            .find(|(change, touch)| match read {
                None => true,
                Some((_, Some(through))) => change.seq > through,
                Some((seq, None)) => *touch >= seq,
            })
            .map(|(change, _)| change.seq);
        reply(&History {
            changes: rows.into_iter().map(|(change, _)| change).collect(),
            unread,
        })
    }

    fn read_history(&self, ctx: &Ctx, p: ReadHistoryParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let history = store.history(p.id)?;
        if !history.iter().any(|(change, _)| change.seq == p.through) {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "read must acknowledge a fetched change",
            ));
        }
        // A delayed acknowledgement cannot move an Actor's read backwards.
        let prior = ctx
            .touches
            .todo_read(&ctx.actor, &item(p.id))
            .map_err(RpcError::internal)?;
        let through = prior
            .and_then(|(_, revision)| revision)
            .unwrap_or(0)
            .max(p.through);
        ctx.touches
            .record_todo_read(&ctx.actor, &item(p.id), through)
            .map_err(RpcError::internal)?;
        Ok(Value::Null)
    }

    fn update(&self, ctx: &Ctx, p: UpdateParams) -> Result<Value, RpcError> {
        if p.title.is_none() && p.body.is_none() && p.estimate_minutes.is_none() {
            return Err(RpcError::new(
                rpc::code::INVALID_PARAMS,
                "update needs a title, a body or an estimate",
            ));
        }
        valid_estimate(p.estimate_minutes.flatten())?;
        let store = self.store()?;
        if p.title.is_none() && p.body.is_none() {
            let todo = store.get(p.id)?;
            if p.estimate_minutes == Some(todo.estimate_minutes) {
                store.require_change(p.id, p.expected_change)?;
                return reply(&todo);
            }
        }
        let todo = store.update(
            p.id,
            p.title.as_deref(),
            p.body.as_deref(),
            p.estimate_minutes,
            p.expected_change,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    fn complete(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let was_blocked = store.blocked_ids()?;
        let todo = store.set_done(
            p.id,
            true,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        emit_unblocked(ctx, &was_blocked, &store.blocked_ids()?);
        reply(&todo)
    }

    fn reopen(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if !todo.done {
            return reply(&todo);
        }
        let todo = store.set_done(
            p.id,
            false,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    fn set_blockers(&self, ctx: &Ctx, p: SetBlockersParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let was_blocked = store.blocked_ids()?;
        store.get(p.id)?;
        store.require_all(&p.blockers)?;
        if cycle::creates_cycle(&store.edges()?, p.id, &p.blockers) {
            return Err(RpcError::conflict(format!(
                "blockers {:?} would make todo {} block itself",
                p.blockers, p.id
            )));
        }
        let todo = store.set_blockers(
            p.id,
            &p.blockers,
            p.expected_change,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        emit_unblocked(ctx, &was_blocked, &store.blocked_ids()?);
        reply(&todo)
    }

    fn delete(&self, ctx: &Ctx, p: TodoId) -> Result<Value, RpcError> {
        let store = self.store()?;
        let mut was_blocked = store.blocked_ids()?;
        store.delete(
            p.id,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        was_blocked.remove(&p.id);
        ctx.emit(EventData::TodoDeleted(p));
        emit_unblocked(ctx, &was_blocked, &store.blocked_ids()?);
        Ok(Value::Null)
    }

    /// T27: the links of a Todo as added, for the Daemon to read their state. It logs no Touch.
    pub fn refs(&self, id: u32) -> Result<Vec<String>, RpcError> {
        let store = self.store()?;
        store.get(id)?;
        store.refs(id)
    }

    /// T27: a link that is no Pad link is `INVALID_PARAMS` before the Todo is looked up. The Daemon has checked the Pad and heading exist (`pads::Pads::holds`).
    fn add_ref(&self, ctx: &Ctx, p: RefParams) -> Result<Value, RpcError> {
        let link = pads::reference::parse(&p.url).map_err(|why| {
            RpcError::new(rpc::code::INVALID_PARAMS, format!("not a Pad link: {why}"))
        })?;
        let store = self.store()?;
        if store.add_ref(p.id, &link.target(), &p.url)? {
            ctx.touch(Verb::Wrote, &item(p.id))?;
            ctx.emit(EventData::TodoRefAdded(TodoId { id: p.id }));
        }
        reply(&store.get(p.id)?)
    }

    fn remove_ref(&self, ctx: &Ctx, p: RefParams) -> Result<Value, RpcError> {
        let link = pads::reference::parse(&p.url).map_err(|why| {
            RpcError::new(rpc::code::INVALID_PARAMS, format!("not a Pad link: {why}"))
        })?;
        let store = self.store()?;
        if store.remove_ref(p.id, &link.target())? {
            ctx.touch(Verb::Wrote, &item(p.id))?;
            ctx.emit(EventData::TodoRefRemoved(TodoId { id: p.id }));
        }
        reply(&store.get(p.id)?)
    }

    /// The Daemon has checked `home` against the Rail (T13). A move to the Home it has changes nothing.
    fn move_to(&self, ctx: &Ctx, p: MoveParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if todo.home == p.home {
            return reply(&todo);
        }
        let todo = store.set_home(p.id, p.home.as_deref())?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    /// T17: the Daemon has checked the Agent against the Rail. The owner it has changes nothing.
    fn assign(&self, ctx: &Ctx, p: AssignParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if todo.owner == p.owner {
            store.require_change(p.id, p.expected_change)?;
            return reply(&todo);
        }
        let todo = store.set_owner(
            p.id,
            p.owner.as_ref(),
            p.expected_change,
            ctx.touches.sequence().map_err(RpcError::internal)?,
            &ctx.actor,
        )?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    /// T11: the Todo goes before `before`, or last. A move to the place it holds changes nothing.
    fn reorder(&self, ctx: &Ctx, p: ReorderParams) -> Result<Value, RpcError> {
        let store = self.store()?;
        let todo = store.get(p.id)?;
        if let Some(before) = p.before {
            store.get(before)?;
            if before == p.id {
                return Err(RpcError::conflict(format!(
                    "todo {} cannot go before itself",
                    p.id
                )));
            }
        }
        if store.successor(p.id)? == p.before {
            return reply(&todo);
        }
        let todo = store.reorder(p.id, p.before)?;
        ctx.touch(Verb::Wrote, &item(p.id))?;
        ctx.emit(EventData::TodoUpdated(todo.clone().into()));
        reply(&todo)
    }

    fn store(&self) -> Result<std::sync::MutexGuard<'_, Store>, RpcError> {
        self.store
            .lock()
            .map_err(|_| RpcError::internal("todo store poisoned"))
    }
}

/// Emit `todo.unblocked` for every Todo that was blocked before and is not now.
fn emit_unblocked(ctx: &Ctx, before: &BTreeSet<u32>, after: &BTreeSet<u32>) {
    for id in before.difference(after) {
        ctx.emit(EventData::TodoUnblocked(TodoId { id: *id }));
    }
}

/// T29: an estimate is 1 to 1440 whole minutes.
fn valid_estimate(minutes: Option<u32>) -> Result<Option<u32>, RpcError> {
    match minutes {
        Some(0 | 1441..) => Err(RpcError::new(
            rpc::code::INVALID_PARAMS,
            "estimate_minutes is 1 to 1440",
        )),
        _ => Ok(minutes),
    }
}

fn item(id: u32) -> String {
    format!("todo:{id}")
}

#[async_trait]
impl Module for Todos {
    fn namespaces(&self) -> &'static [&'static str] {
        &["todo"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        match method {
            "todo.create" => self.create(ctx, params(value)?),
            "todo.list" => reply(&self.store()?.list()?),
            "todo.listHanded" => reply(&self.store()?.list_handed()?),
            "todo.get" => self.get(ctx, params(value)?),
            "todo.getHistory" => self.get_history(ctx, params(value)?),
            "todo.readHistory" => self.read_history(ctx, params(value)?),
            "todo.update" => self.update(ctx, params(value)?),
            "todo.complete" => self.complete(ctx, params(value)?),
            "todo.reopen" => self.reopen(ctx, params(value)?),
            "todo.setBlockers" => self.set_blockers(ctx, params(value)?),
            "todo.reorder" => self.reorder(ctx, params(value)?),
            "todo.assign" => self.assign(ctx, params(value)?),
            "todo.hand" => self.hand(ctx, params(value)?),
            "todo.move" => self.move_to(ctx, params(value)?),
            "todo.delete" => self.delete(ctx, params(value)?),
            "todo.comment" => self.comment(ctx, params(value)?),
            "todo.comments" => self.comments(params(value)?),
            "todo.addRef" => self.add_ref(ctx, params(value)?),
            "todo.removeRef" => self.remove_ref(ctx, params(value)?),
            "todo.unread" => self.unread(),
            "todo.markCommentsRead" => self.mark_comments_read(ctx, params(value)?),
            _ => Err(RpcError::method_not_found(method)),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use contracts::{Actor, ActorKind, Event};
    use provenance::Touches;
    use rpc::code;
    use serde_json::json;
    use tokio::sync::broadcast::Receiver;

    use super::*;

    mod comments;
    mod estimate;
    mod history;
    mod ordering;
    mod values;

    struct Harness {
        todos: Todos,
        ctx: Ctx,
        events: Receiver<Event>,
    }

    impl Harness {
        fn new(dir: &Path) -> Self {
            let bus = Bus::new();
            let events = bus.subscribe();
            let ctx = Ctx {
                actor: Actor::user(),
                bus: bus.clone(),
                touches: Arc::new(Touches::in_memory().unwrap()),
            };
            Self {
                todos: Todos::open(dir, bus).unwrap(),
                ctx,
                events,
            }
        }

        async fn call(&self, method: &str, params: Value) -> Result<Value, RpcError> {
            self.todos.call(&self.ctx, method, params).await
        }

        async fn call_as(
            &self,
            actor: Actor,
            method: &str,
            params: Value,
        ) -> Result<Value, RpcError> {
            let ctx = Ctx {
                actor,
                bus: self.ctx.bus.clone(),
                touches: self.ctx.touches.clone(),
            };
            self.todos.call(&ctx, method, params).await
        }

        /// `"<name> <id>"` for each event, oldest first.
        fn events(&mut self) -> Vec<String> {
            let mut seen = Vec::new();
            while let Ok(event) = self.events.try_recv() {
                let event = serde_json::to_value(&event.data).unwrap();
                seen.push(format!(
                    "{} {}",
                    event["name"].as_str().unwrap(),
                    event["data"]["id"]
                ));
            }
            seen
        }

        /// The `data` of the next event, for asserting on a field beyond `id`.
        fn event_data(&mut self) -> Value {
            let event = self.events.try_recv().unwrap();
            serde_json::to_value(&event.data).unwrap()["data"].clone()
        }

        fn touches(&self, id: u32) -> Vec<(Verb, String)> {
            self.ctx
                .touches
                .history(&item(id))
                .unwrap()
                .into_iter()
                .map(|t| (t.verb, t.actor.id))
                .collect()
        }
    }

    async fn changes(h: &Harness, id: u32) -> Value {
        h.call("todo.getHistory", json!({"id": id})).await.unwrap()
    }

    fn agent(id: &str) -> Actor {
        Actor {
            kind: ActorKind::Agent,
            id: id.into(),
            parent: None,
        }
    }

    fn ext(id: &str, parent: &str) -> Actor {
        Actor {
            kind: ActorKind::Ext,
            id: id.into(),
            parent: Some(parent.into()),
        }
    }

    async fn get_home(h: &Harness, id: u32) -> Value {
        h.call("todo.get", json!({"id": id})).await.unwrap()["home"].clone()
    }

    #[tokio::test]
    async fn t12_every_caller_creates_a_todo_at_the_project_root() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        for (id, actor) in [
            Actor::user(),
            Actor {
                kind: ActorKind::Agent,
                id: "a1".into(),
                parent: None,
            },
            Actor {
                kind: ActorKind::Ext,
                id: "x".into(),
                parent: None,
            },
        ]
        .into_iter()
        .enumerate()
        {
            let made = h
                .call_as(actor, "todo.create", json!({"title": "t", "home": "r1"}))
                .await
                .unwrap();
            assert_eq!(made["home"], Value::Null);
            assert_eq!(
                get_home(&h, u32::try_from(id + 1).unwrap()).await,
                Value::Null
            );
        }
        assert_eq!(h.event_data()["home"], Value::Null);
        let listed = h.call("todo.list", json!(null)).await.unwrap();
        assert!(
            listed
                .as_array()
                .unwrap()
                .iter()
                .all(|t| t["home"].is_null())
        );
    }

    #[tokio::test]
    async fn t12_home_survives_reopen_and_other_writes() {
        let dir = tempfile::tempdir().unwrap();
        {
            let h = Harness::new(dir.path());
            h.call("todo.create", json!({"title": "a"})).await.unwrap();
            h.call("todo.move", json!({"id": 1, "home": "r1"}))
                .await
                .unwrap();
            h.call("todo.update", json!({"id": 1, "title": "b"}))
                .await
                .unwrap();
            h.call("todo.complete", json!({"id": 1})).await.unwrap();
            h.call("todo.setBlockers", json!({"id": 1, "blockers": []}))
                .await
                .unwrap();
        }
        let h = Harness::new(dir.path());
        assert_eq!(get_home(&h, 1).await, "r1");
    }

    #[tokio::test]
    async fn t12_blockers_cross_homes() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.call("todo.create", json!({"title": "b"})).await.unwrap();
        h.call("todo.move", json!({"id": 1, "home": "r1"}))
            .await
            .unwrap();
        h.call("todo.move", json!({"id": 2, "home": "r2"}))
            .await
            .unwrap();
        let blocked = h
            .call("todo.setBlockers", json!({"id": 2, "blockers": [1]}))
            .await
            .unwrap();
        assert_eq!(blocked["blocked"], true);
    }

    #[tokio::test]
    async fn t13_a_move_changes_only_the_home_and_back() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.call("todo.create", json!({"title": "b", "blockers": [1]}))
            .await
            .unwrap();
        let before = h.call("todo.get", json!({"id": 2})).await.unwrap();
        let moved = h
            .call_as(
                Actor {
                    kind: ActorKind::Ext,
                    id: "x".into(),
                    parent: None,
                },
                "todo.move",
                json!({"id": 2, "home": "r1"}),
            )
            .await
            .unwrap();
        let mut expected = before.clone();
        expected["home"] = json!("r1");
        assert_eq!(moved, expected);
        assert_eq!(get_home(&h, 2).await, "r1");
        h.call("todo.move", json!({"id": 2, "home": null}))
            .await
            .unwrap();
        assert_eq!(h.call("todo.get", json!({"id": 2})).await.unwrap(), before);
    }

    #[tokio::test]
    async fn t13_a_move_logs_one_touch_by_the_caller() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        let agent = Actor {
            kind: ActorKind::Agent,
            id: "a1".into(),
            parent: None,
        };
        h.call_as(agent, "todo.move", json!({"id": 1, "home": "r1"}))
            .await
            .unwrap();
        assert_eq!(
            h.touches(1),
            [
                (Verb::Wrote, "you".to_owned()),
                (Verb::Wrote, "a1".to_owned())
            ]
        );
    }

    #[tokio::test]
    async fn t13_a_move_emits_one_event() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.events();
        h.call("todo.move", json!({"id": 1, "home": "r1"}))
            .await
            .unwrap();
        assert_eq!(h.events(), ["todo.updated 1"]);
    }

    #[tokio::test]
    async fn t13_moving_to_the_home_it_has_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        h.call("todo.create", json!({"title": "a"})).await.unwrap();
        h.events();
        let same = h
            .call("todo.move", json!({"id": 1, "home": null}))
            .await
            .unwrap();
        assert_eq!(same["id"], 1);
        assert!(h.events().is_empty());
        assert_eq!(h.touches(1).len(), 1);
    }

    #[tokio::test]
    async fn t13_an_unknown_todo_is_not_found_and_leaves_no_trace() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        let err = h
            .call("todo.move", json!({"id": 9, "home": "r1"}))
            .await
            .unwrap_err();
        assert_eq!(err.code, code::NOT_FOUND);
        assert!(h.events().is_empty());
        assert!(h.touches(9).is_empty());
    }

    #[tokio::test]
    async fn t13_a_move_of_a_todo_made_by_an_agent_or_an_extension_is_the_same() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        for (n, creator) in [(1, agent("a")), (2, ext("x", "a"))] {
            h.call_as(creator.clone(), "todo.create", json!({"title": "t"}))
                .await
                .unwrap();
            h.events();
            let moved = h
                .call("todo.move", json!({"id": n, "home": "r1"}))
                .await
                .unwrap();
            assert_eq!(moved["home"], "r1");
            assert_eq!(moved["creator"], serde_json::to_value(&creator).unwrap());
            assert_eq!(h.events(), [format!("todo.updated {n}")]);
            h.call("todo.move", json!({"id": n, "home": null}))
                .await
                .unwrap();
            assert_eq!(get_home(&h, n).await, Value::Null);
        }
    }

    fn owner_of(actor: &Actor) -> Value {
        serde_json::to_value(actor).unwrap()
    }

    async fn made(h: &Harness, params: Value) -> Value {
        h.call("todo.create", params).await.unwrap()
    }

    #[tokio::test]
    async fn t16_a_new_todo_is_unassigned() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        for actor in [Actor::user(), agent("a")] {
            let todo = h
                .call_as(actor, "todo.create", json!({"title": "t"}))
                .await
                .unwrap();
            assert_eq!(todo["owner"], Value::Null);
        }
        made(&h, json!({"title": "t", "owner": null})).await;
        assert!(
            h.call("todo.list", json!(null))
                .await
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .all(|t| t["owner"].is_null())
        );
        assert_eq!(h.event_data()["owner"], Value::Null);
    }

    #[tokio::test]
    async fn t16_create_with_an_owner() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        for actor in [Actor::user(), agent("a")] {
            let todo = made(&h, json!({"title": "t", "owner": owner_of(&actor)})).await;
            assert_eq!(todo["owner"], owner_of(&actor));
            assert_eq!(h.event_data()["owner"], owner_of(&actor));
            let got = h.call("todo.get", json!({"id": todo["id"]})).await.unwrap();
            assert_eq!(got["owner"], owner_of(&actor));
        }
    }

    #[tokio::test]
    async fn t16_owner_persists_and_old_databases_read_null() {
        let dir = tempfile::tempdir().unwrap();
        {
            let h = Harness::new(dir.path());
            made(&h, json!({"title": "t", "owner": owner_of(&agent("a"))})).await;
        }
        let h = Harness::new(dir.path());
        assert_eq!(
            h.call("todo.get", json!({"id": 1})).await.unwrap()["owner"],
            owner_of(&agent("a"))
        );
        // A database written by the first migration alone, before `owner` existed.
        let old = tempfile::tempdir().unwrap();
        let db = rusqlite::Connection::open(old.path().join("todos.db")).unwrap();
        db.execute_batch(include_str!("../migrations/001/up.sql"))
            .unwrap();
        db.pragma_update(None, "user_version", 1).unwrap();
        db.execute(
            "INSERT INTO todos (title, body, created_at) VALUES ('old', '', 1)",
            [],
        )
        .unwrap();
        drop(db);
        let h = Harness::new(old.path());
        let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
        assert_eq!(todo["owner"], Value::Null);
    }

    #[tokio::test]
    async fn t16_other_calls_never_change_the_owner() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path());
        made(&h, json!({"title": "t", "owner": owner_of(&agent("a"))})).await;
        made(&h, json!({"title": "u"})).await;
        for (method, params) in [
            ("todo.update", json!({"id": 1, "title": "x"})),
            ("todo.setBlockers", json!({"id": 1, "blockers": [2]})),
            ("todo.move", json!({"id": 1, "home": "r1"})),
            ("todo.reorder", json!({"id": 1, "before": null})),
            ("todo.complete", json!({"id": 1})),
        ] {
            h.call_as(Actor::user(), method, params).await.unwrap();
            assert_eq!(
                h.call("todo.get", json!({"id": 1})).await.unwrap()["owner"],
                owner_of(&agent("a")),
                "{method}"
            );
        }
    }

    #[tokio::test]
    async fn t17_assign_changes_only_the_owner() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        made(&h, json!({"title": "t"})).await;
        h.events();
        let before = h.call("todo.get", json!({"id": 1})).await.unwrap();
        h.touches(1);
        let caller = agent("a");
        let assigned = h
            .call_as(
                caller,
                "todo.assign",
                json!({"id": 1, "owner": owner_of(&agent("b"))}),
            )
            .await
            .unwrap();
        let mut expected = before;
        expected["owner"] = owner_of(&agent("b"));
        assert_eq!(assigned, expected);
        assert_eq!(h.events(), ["todo.updated 1"]);
        assert_eq!(h.touches(1).last(), Some(&(Verb::Wrote, "a".to_string())));
        assert_eq!(
            h.call("todo.get", json!({"id": 1})).await.unwrap(),
            expected
        );
    }

    #[tokio::test]
    async fn t17_history_records_owner_change() {
        let dir = tempfile::tempdir().unwrap();
        let h = Harness::new(dir.path());
        made(&h, json!({"title": "t"})).await;
        let me = owner_of(&Actor::user());
        h.call("todo.assign", json!({"id": 1, "owner": me}))
            .await
            .unwrap();
        let history = changes(&h, 1).await["changes"].clone();
        let last = history.as_array().unwrap().last().unwrap().clone();
        assert_eq!(history.as_array().unwrap().len(), 2);
        assert_eq!(last["before"]["owner"], Value::Null);
        assert_eq!(last["after"]["owner"], me);
        assert_eq!(last["after"]["title"], "t");
    }

    #[tokio::test]
    async fn t17_stale_expected_change_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        made(&h, json!({"title": "t"})).await;
        h.events();
        let err = h
            .call(
                "todo.assign",
                json!({"id": 1, "owner": owner_of(&Actor::user()), "expected_change": 9}),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, code::CONFLICT);
        assert_eq!(
            h.call("todo.get", json!({"id": 1})).await.unwrap()["owner"],
            Value::Null
        );
        assert!(h.events().is_empty());
        h.call(
            "todo.assign",
            json!({"id": 1, "owner": owner_of(&Actor::user()), "expected_change": 1}),
        )
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn t17_same_owner_is_a_noop() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        made(&h, json!({"title": "t", "owner": owner_of(&agent("a"))})).await;
        h.events();
        let touches = h.touches(1);
        let history = changes(&h, 1).await;
        h.call(
            "todo.assign",
            json!({"id": 1, "owner": owner_of(&agent("a"))}),
        )
        .await
        .unwrap();
        assert!(h.events().is_empty());
        assert_eq!(h.touches(1), touches);
        assert_eq!(changes(&h, 1).await, history);
        let missing = h
            .call("todo.assign", json!({"id": 9, "owner": null}))
            .await
            .unwrap_err();
        assert_eq!(missing.code, code::NOT_FOUND);
    }

    const NOTES: &str = "roundup://pad/notes?project=k";

    #[tokio::test]
    async fn t27_refs_keep_order_and_one_per_target() {
        let dir = tempfile::tempdir().unwrap();
        let mut h = Harness::new(dir.path());
        made(&h, json!({"title": "t"})).await;
        h.events();
        let plan = format!("{NOTES}#Plan");
        for url in [&plan, &NOTES.to_string(), &format!("{NOTES}#plan")] {
            h.call_as(agent("a"), "todo.addRef", json!({"id": 1, "url": url}))
                .await
                .unwrap();
        }
        let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
        assert_eq!(todo["refs"], json!([plan, NOTES]));
        assert_eq!(h.events(), ["todo.refAdded 1", "todo.refAdded 1"]);
        // A ref is no Change: History keeps its creation entry and the Todo does not update.
        let history = h.call("todo.getHistory", json!({"id": 1})).await.unwrap();
        assert_eq!(history["changes"].as_array().unwrap().len(), 1);
        let by_a = h.touches(1).into_iter().filter(|(_, who)| who == "a");
        assert_eq!(
            by_a.collect::<Vec<_>>(),
            vec![(Verb::Wrote, "a".to_string()); 2]
        );
        h.call(
            "todo.removeRef",
            json!({"id": 1, "url": format!("{NOTES}#PLAN")}),
        )
        .await
        .unwrap();
        h.call(
            "todo.removeRef",
            json!({"id": 1, "url": format!("{NOTES}#PLAN")}),
        )
        .await
        .unwrap();
        let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
        assert_eq!(todo["refs"], json!([NOTES]));
        assert_eq!(h.events(), ["todo.refRemoved 1"]);
    }

    #[tokio::test]
    async fn t27_refs_persist_old_databases_read_none_and_delete_clears_them() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = rusqlite::Connection::open(dir.path().join("todos.db")).unwrap();
        rusqlite_migration::Migrations::new(vec![
            rusqlite_migration::M::up(include_str!("../migrations/001/up.sql")),
            rusqlite_migration::M::up(include_str!("../migrations/002/up.sql")),
            rusqlite_migration::M::up(include_str!("../migrations/003/up.sql")),
            rusqlite_migration::M::up(include_str!("../migrations/004/up.sql")),
            rusqlite_migration::M::up(include_str!("../migrations/005/up.sql")),
        ])
        .to_latest(&mut db)
        .unwrap();
        db.execute_batch("INSERT INTO todos (title,body,created_at) VALUES ('old','',0);")
            .unwrap();
        drop(db);
        {
            let h = Harness::new(dir.path());
            let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
            assert_eq!(todo["refs"], json!([]));
            h.call("todo.addRef", json!({"id": 1, "url": NOTES}))
                .await
                .unwrap();
        }
        let h = Harness::new(dir.path());
        let todo = h.call("todo.get", json!({"id": 1})).await.unwrap();
        assert_eq!(todo["refs"], json!([NOTES]));
        h.call("todo.delete", json!({"id": 1})).await.unwrap();
        let rows: i64 = rusqlite::Connection::open(dir.path().join("todos.db"))
            .unwrap()
            .query_row("SELECT count(*) FROM todo_refs", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }
}
