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
                (State::Merged, None) => {
                    unknown(format!("pull request {pr} merged with no mergedAt"))
                }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github::tests::{FAKE, fake_gh};
    use serde_json::{Value, json};

    const AT: &str = "2026-11-19T10:00:00Z";

    fn view(state: &str, draft: bool, merged_at: Option<&str>) -> String {
        json!({"number": 7, "url": "u", "title": "T", "body": "", "state": state, "isDraft": draft,
            "autoMergeRequest": null, "headRefOid": "abc", "mergedAt": merged_at})
        .to_string()
    }

    /// A Daemon in a fresh Project whose `gh` prints `body`; the fake's folder holds its argv.
    fn setup(body: &str) -> (tempfile::TempDir, tempfile::TempDir, Daemon) {
        let bin = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        FAKE.with(|f| *f.borrow_mut() = Some(fake_gh(bin.path(), body)));
        let daemon = Daemon::open(project.path()).unwrap().0;
        (bin, project, daemon)
    }

    fn prints(json: &str) -> String {
        format!("echo '{json}'")
    }

    async fn call(daemon: &Daemon, method: &str, params: Value) -> Result<Value, RpcError> {
        let (events, _) = tokio::sync::mpsc::unbounded_channel();
        let mut conn = Conn {
            actor: Actor::user(),
            peer: None,
            events,
            output: None,
        };
        daemon.route(&mut conn, method, params).await
    }

    async fn make(daemon: &Daemon, params: Value) {
        call(daemon, "todo.create", params).await.unwrap();
    }

    async fn done(daemon: &Daemon, id: u32) -> bool {
        call(daemon, "todo.get", json!({"id": id})).await.unwrap()["done"] == true
    }

    fn reads(bin: &tempfile::TempDir) -> usize {
        std::fs::read_to_string(bin.path().join("gh.argv")).map_or(0, |text| text.lines().count())
    }

    #[tokio::test]
    async fn t7708b_a_merged_pr_completes_the_todo_once() {
        let (bin, _project, daemon) = setup(&prints(&view("MERGED", false, Some(AT))));
        make(&daemon, json!({"title": "t", "pr": 7})).await;
        let read = call(&daemon, "todo.checkPr", json!({"id": 1}))
            .await
            .unwrap();
        assert_eq!(read["state"], "merged");
        assert_eq!(read["cause"], Value::Null);
        assert!(done(&daemon, 1).await);
        call(&daemon, "todo.checkPr", json!({"id": 1}))
            .await
            .unwrap();
        let history = call(&daemon, "todo.getHistory", json!({"id": 1}))
            .await
            .unwrap();
        assert_eq!(history["changes"].as_array().unwrap().len(), 2);
        assert_eq!(history["changes"][1]["actor"]["id"], "rupd");
        assert!(
            std::fs::read_to_string(bin.path().join("gh.argv"))
                .unwrap()
                .starts_with("pr view 7")
        );
    }

    #[tokio::test]
    async fn t7708b_open_draft_closed_unknown_and_failures_leave_it_open() {
        let cases = [
            (prints(&view("OPEN", false, None)), "open"),
            (prints(&view("OPEN", true, None)), "draft"),
            (prints(&view("CLOSED", false, None)), "closed"),
            (prints(&view("MERGED", false, None)), "unknown"),
            (
                "echo 'no pull requests found' >&2; exit 1".into(),
                "unknown",
            ),
            ("echo not json".into(), "unknown"),
            ("echo 'gh auth login' >&2; exit 4".into(), "unknown"),
        ];
        for (body, state) in cases {
            let (_bin, _project, daemon) = setup(&body);
            make(&daemon, json!({"title": "t", "pr": 7})).await;
            let read = call(&daemon, "todo.checkPr", json!({"id": 1}))
                .await
                .unwrap();
            assert_eq!(read["state"], state, "{body}");
            assert_eq!(read["cause"].is_string(), state == "unknown", "{body}");
            assert!(!done(&daemon, 1).await, "{body}");
        }
    }

    #[tokio::test]
    async fn t7708b_a_failure_carries_its_cause_and_no_token() {
        let (_bin, _project, daemon) =
            setup("echo 'Authorization: token ghp_secret123' >&2; exit 1");
        make(&daemon, json!({"title": "t", "pr": 7})).await;
        let mut events = daemon.bus.subscribe();
        let read = call(&daemon, "todo.checkPr", json!({"id": 1}))
            .await
            .unwrap();
        let cause = read["cause"].as_str().unwrap();
        assert!(cause.starts_with("gh:"), "{cause}");
        assert!(!cause.contains("ghp_secret123"));
        let event = serde_json::to_value(&events.try_recv().unwrap().data).unwrap();
        assert_eq!(event["name"], "todo.prChecked");
        assert_eq!(event["data"]["cause"], read["cause"]);
    }

    #[tokio::test]
    async fn t7708b_an_unlinked_todo_makes_no_gh_call() {
        let (bin, _project, daemon) = setup(&prints(&view("OPEN", false, None)));
        make(&daemon, json!({"title": "t"})).await;
        let err = call(&daemon, "todo.checkPr", json!({"id": 1}))
            .await
            .unwrap_err();
        assert_eq!(err.code, rpc::code::CONFLICT);
        assert_eq!(
            call(&daemon, "todo.checkPrs", Value::Null).await.unwrap(),
            json!([])
        );
        assert_eq!(reads(&bin), 0);
    }

    #[tokio::test]
    async fn t7708b_check_prs_reads_open_linked_todos_only_and_rate_limits() {
        let (bin, _project, daemon) = setup(&prints(&view("OPEN", false, None)));
        make(&daemon, json!({"title": "done", "pr": 3})).await;
        call(&daemon, "todo.complete", json!({"id": 1}))
            .await
            .unwrap();
        make(&daemon, json!({"title": "unlinked"})).await;
        for _ in 0..22 {
            make(&daemon, json!({"title": "linked", "pr": 7})).await;
        }
        let first = call(&daemon, "todo.checkPrs", Value::Null).await.unwrap();
        let ids: Vec<u64> = first
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["id"].as_u64().unwrap())
            .collect();
        assert_eq!(ids, (3..=22).collect::<Vec<_>>());
        assert_eq!(reads(&bin), 20);
        // Within 60 seconds only the two not yet read are due.
        let second = call(&daemon, "todo.checkPrs", Value::Null).await.unwrap();
        assert_eq!(second.as_array().unwrap().len(), 2);
        assert_eq!(reads(&bin), 22);
        let third = call(&daemon, "todo.checkPrs", Value::Null).await.unwrap();
        assert_eq!(third, json!([]));
        assert_eq!(reads(&bin), 22);
    }

    #[tokio::test]
    async fn t7708b_dependents_are_unblocked_after_updated() {
        let (_bin, _project, daemon) = setup(&prints(&view("MERGED", false, Some(AT))));
        make(&daemon, json!({"title": "a", "pr": 7})).await;
        make(&daemon, json!({"title": "b", "blockers": [1]})).await;
        let mut events = daemon.bus.subscribe();
        call(&daemon, "todo.checkPr", json!({"id": 1}))
            .await
            .unwrap();
        let mut seen = Vec::new();
        while let Ok(event) = events.try_recv() {
            let event = serde_json::to_value(&event.data).unwrap();
            seen.push(format!(
                "{} {}",
                event["name"].as_str().unwrap(),
                event["data"]["id"]
            ));
        }
        assert_eq!(
            seen,
            ["todo.updated 1", "todo.unblocked 2", "todo.prChecked 1"]
        );
    }

    #[tokio::test]
    async fn t7708b_two_reads_complete_once() {
        let (_bin, _project, daemon) = setup(&prints(&view("MERGED", false, Some(AT))));
        make(&daemon, json!({"title": "t", "pr": 7})).await;
        let mut events = daemon.bus.subscribe();
        let (a, b) = tokio::join!(
            call(&daemon, "todo.checkPr", json!({"id": 1})),
            call(&daemon, "todo.checkPr", json!({"id": 1}))
        );
        a.unwrap();
        b.unwrap();
        let mut updated = 0;
        while let Ok(event) = events.try_recv() {
            updated +=
                usize::from(serde_json::to_value(&event.data).unwrap()["name"] == "todo.updated");
        }
        assert_eq!(updated, 1);
    }
}
