//! Todos: items with blockers, in SQLite. Owner: todos Builder.

mod comments;
mod cycle;
mod deletion;
mod dispatch;
mod error;
mod handoff;
mod history;
mod placement;
mod references;
#[doc(hidden)]
mod store;
mod values;

use std::path::Path;
use std::sync::Mutex;

use async_trait::async_trait;
use contracts::EventData;
pub use error::Error;
use rpc::{Bus, Ctx, Module, OpenError, RpcError};
use serde_json::Value;
use store::{Store, item};

pub struct Todos {
    store: Mutex<Store>,
    /// T7708b: when each Todo's linked PR was last read, for `todo.checkPrs`' rate limit.
    pr_reads: Mutex<std::collections::HashMap<u32, std::time::Instant>>,
}

/// T7708b: `todo.checkPrs` reads at most this many Todos per call, and none read this recently.
pub const PR_READS_PER_CALL: usize = 20;
const PR_READ_GAP: std::time::Duration = std::time::Duration::from_secs(60);

impl Todos {
    /// `dir` is the Project's data folder (N1). `bus` is for events no call caused.
    pub fn open(dir: &Path, _bus: Bus) -> Result<Self, OpenError> {
        Self::open_store(dir)
    }

    /// A34: apply this Workstream's Todos through the coordinator's Project transaction.
    /// Events are returned for publication only after every store and the Rail commit.
    pub fn remove_workstream(
        &self,
        db: &rusqlite::Connection,
        id: &str,
        actor: &contracts::Actor,
        removal: &mut contracts::agent::Removal,
        scope: contracts::agent::RemoveScope,
    ) -> Result<Vec<EventData>, Error> {
        self.store()?
            .remove_workstream(db, id, actor, removal, scope)
    }

    /// Every Todo in id order, as `todo.list` replies. It logs no Touch.
    pub fn list_all(&self) -> Result<Vec<contracts::todo::Todo>, RpcError> {
        Ok(self.store()?.list()?)
    }

    /// `todo.get`: the Todo, and `ctx.actor` has read its History to here.
    pub async fn read(&self, ctx: &Ctx, id: u32) -> Result<contracts::todo::Todo, RpcError> {
        Ok(self.get(ctx, contracts::todo::TodoId { id }).await?)
    }

    /// `todo.move`: the Daemon has checked `home` against the Rail (T13).
    pub async fn set_home(
        &self,
        ctx: &Ctx,
        id: u32,
        home: Option<String>,
    ) -> Result<contracts::todo::Todo, RpcError> {
        Ok(self
            .move_to(ctx, contracts::todo::MoveParams { id, home })
            .await?)
    }

    /// `todo.assign`, unconditionally: the Daemon has checked the owner against the Rail (T17).
    pub async fn set_owner(
        &self,
        ctx: &Ctx,
        id: u32,
        owner: Option<contracts::Actor>,
    ) -> Result<contracts::todo::Todo, RpcError> {
        let assign = contracts::todo::AssignParams {
            id,
            owner: owner.map(contracts::common::Owner::Actor),
            expected_change: None,
        };
        Ok(self.assign(ctx, assign).await?)
    }

    /// T7708b: the PR a Todo links, for a read the caller starts; no link is `CONFLICT`. It logs no Touch.
    pub fn pr_to_read(&self, id: u32) -> Result<u32, RpcError> {
        let todo = self.store()?.get(id)?;
        let pr = todo
            .pr
            .ok_or_else(|| RpcError::conflict(format!("todo {id} links no pull request")))?;
        self.stamp_pr_read(id)?;
        Ok(pr)
    }

    /// T7708b: the open linked Todos in the Todo order whose PR was not read in the last 60 seconds,
    /// at most `PR_READS_PER_CALL`, as `(id, pr)`; each is marked read now.
    pub fn prs_to_read(&self) -> Result<Vec<(u32, u32)>, RpcError> {
        let now = std::time::Instant::now();
        let due: Vec<(u32, u32)> = {
            let reads = self
                .pr_reads
                .lock()
                .map_err(|_| Error::internal("poisoned"))?;
            self.store()?
                .list()?
                .into_iter()
                .filter(|todo| !todo.done)
                .filter_map(|todo| todo.pr.map(|pr| (todo.id, pr)))
                .filter(|(id, _)| {
                    reads
                        .get(id)
                        .is_none_or(|at| now.duration_since(*at) >= PR_READ_GAP)
                })
                .take(PR_READS_PER_CALL)
                .collect()
        };
        for (id, _) in &due {
            self.stamp_pr_read(*id)?;
        }
        Ok(due)
    }

    fn stamp_pr_read(&self, id: u32) -> Result<(), Error> {
        self.pr_reads
            .lock()
            .map_err(|_| Error::internal("poisoned"))?
            .insert(id, std::time::Instant::now());
        Ok(())
    }

    /// T7708c: completes the Todo as `ctx.actor` for the merge of PR `pr` at `merged_at`; `None` when the
    /// Todo is done, no longer links `pr`, or this merge already closed it once.
    pub async fn complete_merged(
        &self,
        ctx: &Ctx,
        id: u32,
        pr: u32,
        merged_at: &str,
    ) -> Result<Option<contracts::todo::Todo>, RpcError> {
        Ok(self.complete_by_merge(ctx, id, pr, merged_at).await?)
    }

    /// T27: the links of a Todo as added, for the Daemon to read their state. It logs no Touch.
    pub fn refs(&self, id: u32) -> Result<Vec<String>, Error> {
        self.read_refs(id)
    }
}

#[async_trait]
impl Module for Todos {
    fn namespaces(&self) -> &'static [&'static str] {
        &["todo"]
    }

    async fn call(&self, ctx: &Ctx, method: &str, value: Value) -> Result<Value, RpcError> {
        self.dispatch(ctx, method, value).await
    }
}

#[cfg(test)]
mod tests;
