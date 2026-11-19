//! T7708b, T7708c: the Daemon reads a Todo's linked pull request through A5168a's `pr_now` (the
//! owner's own `gh`) and completes the Todo when it merged. Nothing here writes to GitHub.

use contracts::github::State;
use contracts::todo::{PrCheck, PrState, TodoId};
use contracts::{Actor, EventData};
use rpc::RpcError;

use crate::{Conn, Daemon};

fn check(id: u32, pr: u32, state: PrState, cause: Option<String>) -> PrCheck {
    PrCheck {
        id,
        pr,
        state,
        cause,
    }
}

impl Daemon {
    /// What GitHub holds of `pr` now, and the `mergedAt` of a merge. Every failure is `unknown` with its cause.
    async fn read_todo_pr(&self, id: u32, pr: u32) -> (PrCheck, Option<String>) {
        let read = match i32::try_from(pr) {
            Ok(number) => self.pr_now(&number.to_string()).await,
            Err(_) => Err(RpcError::not_found(format!("pull request {pr}"))),
        };
        let unknown = |cause: String| (check(id, pr, PrState::Unknown, Some(cause)), None);
        match read {
            Err(err) => unknown(err.message),
            Ok(found) => match (found.state, found.merged_at) {
                (State::Merged, Some(at)) => (check(id, pr, PrState::Merged, None), Some(at)),
                (State::Merged, None) => unknown(format!("pull request {pr} merged with no mergedAt")),
                (State::Closed, _) => (check(id, pr, PrState::Closed, None), None),
                (State::Open, _) if found.draft => (check(id, pr, PrState::Draft, None), None),
                (State::Open, _) => (check(id, pr, PrState::Open, None), None),
            },
        }
    }

    /// Reads one Todo's PR, completes the Todo as the Daemon on a merge, and tells subscribers.
    async fn check_todo_pr(&self, id: u32, pr: u32) -> Result<PrCheck, RpcError> {
        let (read, merged_at) = self.read_todo_pr(id, pr).await;
        let ctx = self.ctx(Actor::daemon());
        if let Some(at) = merged_at {
            self.todos.complete_merged(&ctx, id, pr, &at).await?;
        }
        ctx.emit(EventData::TodoPrChecked(read.clone()));
        Ok(read)
    }

    /// `todo.checkPr`: a Todo with no link is `CONFLICT` and runs no `gh`.
    pub(crate) async fn todo_check_pr(
        &self,
        _conn: &mut Conn,
        TodoId { id }: TodoId,
    ) -> Result<PrCheck, RpcError> {
        let pr = self.todos.pr_to_read(id)?;
        self.check_todo_pr(id, pr).await
    }

    /// `todo.checkPrs`: the open linked Todos not read in the last minute, at most 20.
    pub(crate) async fn todo_check_prs(&self, _conn: &mut Conn) -> Result<Vec<PrCheck>, RpcError> {
        let mut checks = Vec::new();
        for (id, pr) in self.todos.prs_to_read()? {
            checks.push(self.check_todo_pr(id, pr).await?);
        }
        Ok(checks)
    }
}
